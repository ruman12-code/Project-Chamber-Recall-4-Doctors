import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { provision } from '../src/main/db/provision';
import type { Db } from '../src/main/db/open';
import { newId } from '../src/main/db/ids';
import { nowIso, localDate } from '../src/main/db/clock';
import { registerArrival } from '../src/main/queue/register';
import {
  receiveDeskArrival, unresolvedSerialClashes, acknowledgeSerialClash, DeskArrivalError,
  type DeskArrival,
} from '../src/main/queue/deskArrival';
import { registerPatient } from '../src/main/patients/register';
import { addStaff } from '../src/main/auth/staff';
import { tempDir } from './helpers';

const SYSTEM = { id: null, role: 'system' as const };
const TODAY = localDate();

function chamberWith(db: Db, name: string): string {
  const id = newId();
  db.prepare('INSERT INTO chamber (id, name, created_at) VALUES (?, ?, ?)').run(id, name, nowIso());
  return id;
}

function fresh() {
  const t = tempDir();
  const { db } = provision(t.dir, 'the pilot passphrase', 'demo');
  const popular = chamberWith(db, 'Popular');
  const biplob = addStaff(db, { displayName: 'Biplob', role: 'front_desk', pin: '6172' }, SYSTEM);
  return { db, popular, biplob, cleanup: t.cleanup };
}

function arrival(chamberId: string, serial: number, takenBy: string,
  over: Partial<DeskArrival> = {}): DeskArrival {
  return {
    deskRef: newId(), chamberId, takenBy, arrivedAt: nowIso(), visitDate: TODAY,
    serialAnnounced: serial,
    newPatient: { fullNameBn: 'রহিমা বেগম', fullNameEn: null, phone: '01711000001',
      dob: null, approxAgeYears: 40, sex: 'female', addressFreeText: null, deskRef: newId() },
    ...over,
  };
}

describe('an arrival taken at the desk with no laptop', () => {
  let c: ReturnType<typeof fresh>;
  before(() => { c = fresh(); });
  after(() => { c.db.close(); c.cleanup(); });

  test('a new patient registered at the desk lands with the number they were told', () => {
    const got = receiveDeskArrival(c.db, arrival(c.popular, 1, c.biplob), SYSTEM);
    assert.equal(got.serialNo, 1);
    assert.equal(got.serialAnnounced, null, 'nobody has to be told anything');
    assert.equal(got.alreadyHad, false);
  });

  test('the patient really is in the records afterwards', () => {
    const n = c.db.prepare('SELECT count(*) AS n FROM patient WHERE deleted_at IS NULL').get() as { n: number };
    assert.equal(n.n, 1);
  });

  test('sending the same arrival again changes nothing', () => {
    const one = arrival(c.popular, 2, c.biplob);
    const first = receiveDeskArrival(c.db, one, SYSTEM);
    const second = receiveDeskArrival(c.db, one, SYSTEM);
    assert.equal(second.visitId, first.visitId);
    assert.equal(second.serialNo, first.serialNo);
    assert.equal(second.alreadyHad, true);
    const visits = c.db.prepare('SELECT count(*) AS n FROM visit').get() as { n: number };
    assert.equal(visits.n, 2, 'a repeat must never make a second place in the queue');
  });

  test('the record carries the name of whoever was at the desk, not who received it', () => {
    const row = c.db.prepare(
      'SELECT created_by AS by FROM visit ORDER BY rowid LIMIT 1',
    ).get() as { by: string };
    assert.equal(row.by, c.biplob,
      'a registration taken two hours ago belongs to the person who took it');
  });

  test('and never makes a second patient out of the same person', () => {
    const n = c.db.prepare('SELECT count(*) AS n FROM patient WHERE deleted_at IS NULL').get() as { n: number };
    assert.equal(n.n, 2, 'two arrivals so far, each a different person, and no duplicates');
  });
});

describe('the number the patient was already told', () => {
  let c: ReturnType<typeof fresh>;
  before(() => { c = fresh(); });
  after(() => { c.db.close(); c.cleanup(); });

  test('when the laptop has taken that number, the patient keeps their place', () => {
    // The laptop added a walk-in as serial 1 while the tablet was away.
    const atLaptop = { id: c.biplob, role: 'front_desk' as const };
    const walkIn = registerPatient(c.db, {
      fullNameBn: 'হাঁটা রোগী', fullNameEn: null, phone: null, dob: null,
      approxAgeYears: 30, sex: 'male', addressFreeText: null,
    }, atLaptop);
    registerArrival(c.db, walkIn, c.popular, atLaptop);

    // The desk announced 1 to somebody else, two hours ago.
    const got = receiveDeskArrival(c.db, arrival(c.popular, 1, c.biplob), SYSTEM);
    assert.notEqual(got.serialNo, 1, 'two people cannot both be number one');
    assert.equal(got.serialAnnounced, 1, 'what they were told is written down');
  });

  test('and the laptop says so until somebody has told them', () => {
    const clashes = unresolvedSerialClashes(c.db, c.popular, TODAY);
    assert.equal(clashes.length, 1);
    assert.equal(clashes[0]!.serialAnnounced, 1);
    assert.notEqual(clashes[0]!.serialNo, 1);
    assert.equal(clashes[0]!.nameBn, 'রহিমা বেগম');
  });

  test('it stops being shown once somebody says they have', () => {
    const clash = unresolvedSerialClashes(c.db, c.popular, TODAY)[0]!;
    acknowledgeSerialClash(c.db, clash.visitId, SYSTEM);
    assert.equal(unresolvedSerialClashes(c.db, c.popular, TODAY).length, 0);
  });

  test('an ordinary arrival never raises one', () => {
    receiveDeskArrival(c.db, arrival(c.popular, 9, c.biplob), SYSTEM);
    assert.equal(unresolvedSerialClashes(c.db, c.popular, TODAY).length, 0);
  });
});

describe('an arrival that cannot be taken', () => {
  let c: ReturnType<typeof fresh>;
  before(() => { c = fresh(); });
  after(() => { c.db.close(); c.cleanup(); });

  test('a chamber that is not here is refused, and says what to do', () => {
    assert.throws(
      () => receiveDeskArrival(c.db, arrival('no-such-chamber', 1, c.biplob), SYSTEM),
      (e: unknown) => e instanceof DeskArrivalError && /by hand/.test((e as DeskArrivalError).whatToDo),
    );
  });

  test('an arrival naming nobody at all is refused rather than filed against nobody', () => {
    const empty = { ...arrival(c.popular, 1, c.biplob), newPatient: undefined, patientId: null };
    assert.throws(() => receiveDeskArrival(c.db, empty, SYSTEM), DeskArrivalError);
  });

  test('a patient record that has gone is refused rather than guessed at', () => {
    const bad = { ...arrival(c.popular, 1, c.biplob), newPatient: undefined, patientId: 'nobody-at-all' };
    assert.throws(() => receiveDeskArrival(c.db, bad, SYSTEM), DeskArrivalError);
  });

  test('an arrival taken by somebody who is not here is refused, not filed under nobody', () => {
    const ghost = { ...arrival(c.popular, 1, c.biplob), takenBy: 'a-person-who-left' };
    assert.throws(() => receiveDeskArrival(c.db, ghost, SYSTEM), DeskArrivalError);
  });

  test('nothing was half-written by any of those', () => {
    const visits = c.db.prepare('SELECT count(*) AS n FROM visit').get() as { n: number };
    const people = c.db.prepare('SELECT count(*) AS n FROM patient').get() as { n: number };
    assert.equal(visits.n, 0);
    assert.equal(people.n, 0, 'a refused arrival must not leave a patient behind');
  });
});

describe('a whole evening arriving at once', () => {
  test('ten arrivals keep their order and their numbers', () => {
    const c = fresh();
    const refs: DeskArrival[] = [];
    for (let i = 1; i <= 10; i++) {
      refs.push(arrival(c.popular, i, c.biplob, {
        newPatient: { fullNameBn: `রোগী ${i}`, fullNameEn: null, phone: `017110000${i}`,
          dob: null, approxAgeYears: 20 + i, sex: 'female', addressFreeText: null, deskRef: newId() },
      }));
    }
    for (const one of refs) receiveDeskArrival(c.db, one, SYSTEM);

    const rows = c.db.prepare(
      'SELECT serial_no AS s FROM visit WHERE chamber_id = ? ORDER BY serial_no',
    ).all(c.popular) as Array<{ s: number }>;
    assert.deepEqual(rows.map((r) => r.s), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    assert.equal(unresolvedSerialClashes(c.db, c.popular, TODAY).length, 0);

    // And sending the whole evening a second time changes nothing.
    for (const one of refs) receiveDeskArrival(c.db, one, SYSTEM);
    const after = c.db.prepare('SELECT count(*) AS n FROM visit').get() as { n: number };
    assert.equal(after.n, 10);
    c.db.close(); c.cleanup();
  });
});
