import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { provision } from '../src/main/db/provision';
import type { Db } from '../src/main/db/open';
import { nowIso, localDate } from '../src/main/db/clock';
import { registerPatient } from '../src/main/patients/register';
import { registerArrival, setVisitStatus } from '../src/main/queue/register';
import { moveInQueue } from '../src/main/queue/queue';
import { deskSignal } from '../src/main/queue/deskSignal';
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
  const desk = { id: doctor, role: 'doctor' as const };
  const visits: string[] = [];
  for (let i = 1; i <= 4; i++) {
    const p = registerPatient(db, {
      fullNameBn: `রোগী ${i}`, fullNameEn: null, phone: null, dob: null,
      approxAgeYears: 30 + i, sex: 'female', addressFreeText: null,
    }, desk);
    visits.push(registerArrival(db, p, 'popular', desk).visitId);
  }
  return { db, desk, visits, cleanup: t.cleanup };
}

describe('telling the front desk what the doctor just did', () => {
  let c: ReturnType<typeof chamber>;
  before(() => { c = chamber(); });
  after(() => { c.db.close(); c.cleanup(); });

  test('between patients it says who is next', () => {
    const signal = deskSignal(c.db, 'popular', TODAY);
    assert.equal(signal.inChamber, null);
    assert.equal(signal.nextWaiting?.serialNo, 1);
    assert.equal(signal.waiting, 4);
  });

  test('calling the first patient in is not out of turn', () => {
    setVisitStatus(c.db, c.visits[0]!, 'in_chamber', c.desk);
    const signal = deskSignal(c.db, 'popular', TODAY);
    assert.equal(signal.inChamber?.serialNo, 1);
    assert.equal(signal.inChamber?.outOfTurn, false);
    assert.equal(signal.nextWaiting?.serialNo, 2);
    assert.equal(signal.waiting, 3);
  });

  test('finishing with them empties the room and moves the next one up', () => {
    setVisitStatus(c.db, c.visits[0]!, 'done', c.desk);
    const signal = deskSignal(c.db, 'popular', TODAY);
    assert.equal(signal.inChamber, null);
    assert.equal(signal.nextWaiting?.serialNo, 2);
  });

  test('calling somebody from further down IS out of turn', () => {
    setVisitStatus(c.db, c.visits[3]!, 'in_chamber', c.desk);
    const signal = deskSignal(c.db, 'popular', TODAY);
    assert.equal(signal.inChamber?.serialNo, 4);
    assert.equal(signal.inChamber?.outOfTurn, true,
      'people ahead of them are still waiting, and the desk has to know');
    setVisitStatus(c.db, c.visits[3]!, 'waiting', c.desk);
  });

  test('a patient MOVED UP the list is then not out of turn', () => {
    // This is the case that matters. A red flag rule, or the doctor,
    // puts somebody at the front. Calling them is the system working
    // exactly as intended, and announcing it as irregular would teach
    // the desk to ignore the warning.
    moveInQueue(c.db, c.visits[3]!, 'up', c.desk);
    moveInQueue(c.db, c.visits[3]!, 'up', c.desk);
    moveInQueue(c.db, c.visits[3]!, 'up', c.desk);
    setVisitStatus(c.db, c.visits[3]!, 'in_chamber', c.desk);
    const signal = deskSignal(c.db, 'popular', TODAY);
    assert.equal(signal.inChamber?.serialNo, 4);
    assert.equal(signal.inChamber?.outOfTurn, false,
      'they were moved to the front, so calling them is in turn');
  });

  test('the fingerprint changes when the room changes, and only then', () => {
    const a = deskSignal(c.db, 'popular', TODAY).at;
    const b = deskSignal(c.db, 'popular', TODAY).at;
    assert.equal(a, b, 'asking twice about the same room must not ring the bell twice');
    setVisitStatus(c.db, c.visits[3]!, 'done', c.desk);
    assert.notEqual(deskSignal(c.db, 'popular', TODAY).at, a);
  });

  test('an empty evening says so rather than failing', () => {
    const t = tempDir();
    const { db } = provision(t.dir, 'passphrase', 'demo');
    db.prepare('INSERT INTO chamber (id, name, created_at) VALUES (?, ?, ?)')
      .run('empty', 'Empty', nowIso());
    const signal = deskSignal(db, 'empty', TODAY);
    assert.deepEqual(
      { inChamber: signal.inChamber, nextWaiting: signal.nextWaiting, waiting: signal.waiting },
      { inChamber: null, nextWaiting: null, waiting: 0 },
    );
    db.close(); t.cleanup();
  });
});
