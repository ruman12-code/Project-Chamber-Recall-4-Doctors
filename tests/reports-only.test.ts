import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { provision } from '../src/main/db/provision';
import type { Db } from '../src/main/db/open';
import { newId } from '../src/main/db/ids';
import { nowIso, localDate } from '../src/main/db/clock';
import { registerPatient } from '../src/main/patients/register';
import { registerArrival } from '../src/main/queue/register';
import { todaysQueue } from '../src/main/queue/queue';
import { receiveDeskArrival } from '../src/main/queue/deskArrival';
import { addStaff } from '../src/main/auth/staff';
import { tempDir } from './helpers';

const SYSTEM = { id: null, role: 'system' as const };
const TODAY = localDate();

function chamber() {
  const t = tempDir();
  const { db } = provision(t.dir, 'the pilot passphrase', 'demo');
  db.prepare('INSERT INTO chamber (id, name, created_at) VALUES (?, ?, ?)')
    .run('popular', 'Popular', nowIso());
  const doctor = addStaff(db, { displayName: 'Dr Test', role: 'doctor', pin: '4021' }, SYSTEM);
  const biplob = addStaff(db, { displayName: 'Biplob', role: 'front_desk', pin: '6172' },
    { id: doctor, role: 'doctor' });
  const desk = { id: biplob, role: 'front_desk' as const };
  return { db, biplob, desk, cleanup: t.cleanup };
}

function somebody(db: Db, name: string, desk: { id: string; role: 'front_desk' }) {
  return registerPatient(db, {
    fullNameBn: name, fullNameEn: null, phone: null, dob: null,
    approxAgeYears: 40, sex: 'female', addressFreeText: null,
  }, desk);
}

describe('the patient who came only to show a test report', () => {
  let c: ReturnType<typeof chamber>;
  before(() => { c = chamber(); });
  after(() => { c.db.close(); c.cleanup(); });

  test('every visit that already existed is an ordinary consultation', () => {
    const id = somebody(c.db, 'সাধারণ রোগী', c.desk);
    const visit = registerArrival(c.db, id, 'popular', c.desk);
    const row = c.db.prepare('SELECT visit_kind AS k FROM visit WHERE id = ?').get(visit.visitId) as { k: string };
    assert.equal(row.k, 'consultation', 'nothing already in a chamber changes meaning');
  });

  test('the desk can mark one as here for reports', () => {
    const id = somebody(c.db, 'রিপোর্ট রোগী', c.desk);
    const visit = registerArrival(c.db, id, 'popular', c.desk, { visitKind: 'reports_only' });
    const row = c.db.prepare('SELECT visit_kind AS k FROM visit WHERE id = ?').get(visit.visitId) as { k: string };
    assert.equal(row.k, 'reports_only');
  });

  test('and so can a tablet with no laptop in the room', () => {
    receiveDeskArrival(c.db, {
      deskRef: newId(), chamberId: 'popular', takenBy: c.biplob,
      arrivedAt: nowIso(), visitDate: TODAY, serialAnnounced: 3,
      visitKind: 'reports_only',
      newPatient: {
        deskRef: newId(), fullNameBn: 'অফলাইন রিপোর্ট', fullNameEn: null, phone: null,
        dob: null, approxAgeYears: 33, sex: 'male', addressFreeText: null,
      },
    }, SYSTEM);
    const row = c.db.prepare(
      `SELECT visit_kind AS k FROM visit WHERE serial_no = 3 AND chamber_id = 'popular'`,
    ).get() as { k: string };
    assert.equal(row.k, 'reports_only');
  });

  test('today\'s list says which is which', () => {
    const queue = todaysQueue(c.db, 'popular', TODAY);
    assert.deepEqual(queue.map((e) => e.visitKind),
      ['consultation', 'reports_only', 'reports_only']);
  });

  test('IT DOES NOT CHANGE ANYBODY\'S PLACE IN THE QUEUE', () => {
    // The doctor has not been asked yet whether he wants these
    // interleaved. Until he says so, they sit exactly where they
    // arrived. This test exists so that a later change to the ordering
    // cannot happen by accident.
    const queue = todaysQueue(c.db, 'popular', TODAY);
    assert.deepEqual(queue.map((e) => e.serialNo), [1, 2, 3],
      'serial order, first come first served, whatever anybody came for');
  });

  test('nothing anywhere is refused to them for being here about a report', () => {
    // Not a lighter kind of patient. Everything a consultation can do,
    // this can do: they may be called in, seen, and recorded against.
    const queue = todaysQueue(c.db, 'popular', TODAY);
    const reports = queue.find((e) => e.visitKind === 'reports_only')!;
    assert.equal(reports.status, 'waiting');
    assert.ok(reports.visitId);
  });

  test('a kind the program has never heard of cannot be written at all', () => {
    assert.throws(() => c.db.prepare(
      `UPDATE visit SET visit_kind = 'something_else' WHERE serial_no = 1`,
    ).run(), /CHECK constraint failed/);
  });
});
