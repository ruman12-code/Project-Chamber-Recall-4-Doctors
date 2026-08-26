import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { provision } from '../src/main/db/provision';
import { nowIso, localDate } from '../src/main/db/clock';
import { registerPatient } from '../src/main/patients/register';
import { registerArrival, setVisitStatus } from '../src/main/queue/register';
import { todaysQueue, moveInQueue } from '../src/main/queue/queue';
import { deskSignal } from '../src/main/queue/deskSignal';
import { upNextInChamber } from '../src/main/queue/upNext';
import { recordNoAnswer } from '../src/main/queue/noAnswer';
import { addStaff, deskSignInList, signInList } from '../src/main/auth/staff';
import { tempDir } from './helpers';

const SYSTEM = { id: null, role: 'system' as const };
const TODAY = localDate();

function chamber() {
  const t = tempDir();
  const { db } = provision(t.dir, 'the pilot passphrase', 'demo');
  db.prepare('INSERT INTO chamber (id, name, created_at) VALUES (?, ?, ?)')
    .run('popular', 'Popular', nowIso());
  const doctorId = addStaff(db, { displayName: 'Dr Test', role: 'doctor', pin: '4021' }, SYSTEM);
  const doctor = { id: doctorId, role: 'doctor' as const };
  const deskId = addStaff(db, { displayName: 'Biplob', role: 'front_desk', pin: '6172' }, doctor);
  addStaff(db, { displayName: 'Nusrat', role: 'clinical_assistant', pin: '5390' }, doctor);
  const visits: string[] = [];
  for (let i = 1; i <= 3; i++) {
    const p = registerPatient(db, {
      fullNameBn: `রোগী ${i}`, fullNameEn: null, phone: null, dob: null,
      approxAgeYears: 30 + i, sex: 'female', addressFreeText: null,
    }, doctor);
    visits.push(registerArrival(db, p, 'popular', doctor).visitId);
  }
  return { db, doctor, deskId, visits, cleanup: () => { db.close(); t.cleanup(); } };
}

let n = 0;
function nobodyCame(c: ReturnType<typeof chamber>, visitId: string) {
  return recordNoAnswer(c.db, {
    deskRef: `r-${++n}`, visitId, calledBy: c.deskId, calledAt: nowIso(),
  });
}

describe('the desk and the doctor are told the same thing', () => {
  let c: ReturnType<typeof chamber>;
  before(() => { c = chamber(); });
  after(() => { c.cleanup(); });

  test('before anybody is called, both say serial 1', () => {
    assert.equal(deskSignal(c.db, 'popular', TODAY).nextWaiting?.serialNo, 1);
    assert.equal(upNextInChamber(c.db, 'popular', TODAY)?.serialNo, 1);
  });

  test('the desk calls 1, nobody comes, and BOTH move to 2', () => {
    nobodyCame(c, c.visits[0]!);
    const desk = deskSignal(c.db, 'popular', TODAY).nextWaiting;
    const laptop = upNextInChamber(c.db, 'popular', TODAY);
    assert.equal(desk?.serialNo, 2);
    assert.equal(laptop?.serialNo, 2, 'the doctor was still waiting for serial 1');
    // The whole point: one rule, one answer.
    assert.equal(desk?.visitId, laptop?.visitId);
  });

  test('and serial 1 has not moved, been dropped, or been marked gone', () => {
    const one = todaysQueue(c.db, 'popular', TODAY).find((e) => e.visitId === c.visits[0]);
    assert.equal(one?.status, 'waiting');
    assert.equal(one?.serialNo, 1);
    assert.equal(one?.calledNoAnswer, 1);
    assert.equal(todaysQueue(c.db, 'popular', TODAY).filter((e) => e.status === 'waiting').length, 3);
  });

  test('the doctor can still call serial 1 in, and the list is unchanged', () => {
    setVisitStatus(c.db, c.visits[0]!, 'in_chamber', c.doctor);
    assert.equal(deskSignal(c.db, 'popular', TODAY).inChamber?.serialNo, 1);
    setVisitStatus(c.db, c.visits[0]!, 'done', c.doctor);
  });

  test('an escalated patient still wins a tie', () => {
    const c2 = chamber();
    nobodyCame(c2, c2.visits[0]!);
    nobodyCame(c2, c2.visits[1]!);
    nobodyCame(c2, c2.visits[2]!);
    moveInQueue(c2.db, c2.visits[2]!, 'up', c2.doctor);
    moveInQueue(c2.db, c2.visits[2]!, 'up', c2.doctor);
    assert.equal(upNextInChamber(c2.db, 'popular', TODAY)?.serialNo, 3);
    assert.equal(deskSignal(c2.db, 'popular', TODAY).nextWaiting?.serialNo, 3);
    c2.cleanup();
  });

  test('nobody waiting means nobody is next, on both screens', () => {
    const c2 = chamber();
    for (const v of c2.visits) {
      setVisitStatus(c2.db, v, 'in_chamber', c2.doctor);
      setVisitStatus(c2.db, v, 'done', c2.doctor);
    }
    assert.equal(upNextInChamber(c2.db, 'popular', TODAY), null);
    assert.equal(deskSignal(c2.db, 'popular', TODAY).nextWaiting, null);
    c2.cleanup();
  });
});

describe('a flagged patient is never called after an unflagged one', () => {
  /** What the red flag layer actually writes when a rule fires. */
  function flag(c: ReturnType<typeof chamber>, visitId: string) {
    const intakeId = `i-${visitId}`;
    c.db.prepare(
      `INSERT INTO intake (id, visit_id, recorded_by, started_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(intakeId, visitId, c.deskId, nowIso(), nowIso(), nowIso());
    c.db.prepare(
      `INSERT INTO red_flag_event (id, intake_id, rule_id, rule_version, fired_at)
       VALUES (?, ?, 'r', '1', ?)`,
    ).run(`f-${visitId}`, intakeId, nowIso());
  }

  test('the flag beats the serial, on the tablet as on the laptop', () => {
    const c = chamber();
    // Serial 3 is flagged. 1 and 2 are not.
    flag(c, c.visits[2]!);
    assert.equal(upNextInChamber(c.db, 'popular', TODAY)?.serialNo, 3);
    assert.equal(deskSignal(c.db, 'popular', TODAY).nextWaiting?.serialNo, 3);
    assert.equal(upNextInChamber(c.db, 'popular', TODAY)?.flagged, true);
    // And the doctor's own list agrees, which is the point.
    const listed = todaysQueue(c.db, 'popular', TODAY).filter((e) => e.status === 'waiting');
    assert.equal(listed[0]?.serialNo, 3);
    c.cleanup();
  });

  test('the flag beats an unanswered call too -- no answer never demotes', () => {
    const c = chamber();
    flag(c, c.visits[2]!);
    // Serial 3 is flagged and did not answer. An unflagged patient with
    // no calls against them must NOT jump ahead: that is de-escalation.
    nobodyCame(c, c.visits[2]!);
    assert.equal(upNextInChamber(c.db, 'popular', TODAY)?.serialNo, 3);
    assert.equal(deskSignal(c.db, 'popular', TODAY).nextWaiting?.serialNo, 3);
    c.cleanup();
  });

  test('among flagged patients it still rotates', () => {
    const c = chamber();
    flag(c, c.visits[1]!);
    flag(c, c.visits[2]!);
    assert.equal(upNextInChamber(c.db, 'popular', TODAY)?.serialNo, 2);
    nobodyCame(c, c.visits[1]!);
    assert.equal(upNextInChamber(c.db, 'popular', TODAY)?.serialNo, 3);
    c.cleanup();
  });

  test('every flagged patient called and none answering is said out loud', () => {
    const c = chamber();
    flag(c, c.visits[1]!);
    assert.equal(upNextInChamber(c.db, 'popular', TODAY)?.allFlaggedUnanswered, false);
    nobodyCame(c, c.visits[1]!);
    const next = upNextInChamber(c.db, 'popular', TODAY);
    // Still serial 2 -- the desk cannot move past a flagged patient --
    // and the tablet is told why so it can say so rather than looking
    // like it ignored the tap.
    assert.equal(next?.serialNo, 2);
    assert.equal(next?.allFlaggedUnanswered, true);
    c.cleanup();
  });

  test('with nobody flagged, that is false and the ordinary rule runs', () => {
    const c = chamber();
    assert.equal(upNextInChamber(c.db, 'popular', TODAY)?.allFlaggedUnanswered, false);
    assert.equal(upNextInChamber(c.db, 'popular', TODAY)?.flagged, false);
    c.cleanup();
  });
});

describe('who the tablet offers to sign in', () => {
  test('the front desk, and nobody else', () => {
    const c = chamber();
    assert.deepEqual(deskSignInList(c.db).map((p) => p.displayName), ['Biplob']);
    // The laptop still offers everybody -- that screen is in the chamber.
    assert.deepEqual(
      signInList(c.db).map((p) => p.displayName).sort(),
      ['Biplob', 'Dr Test', 'Nusrat'],
    );
    c.cleanup();
  });

  test('a front desk person switched off stops being offered', () => {
    const c = chamber();
    c.db.prepare('UPDATE app_user SET is_active = 0 WHERE display_name = ?').run('Biplob');
    assert.deepEqual(deskSignInList(c.db), []);
    c.cleanup();
  });
});

describe('paper the patient brought, counted for both screens', () => {
  test('counted per visit, and only what is not deleted', () => {
    const c = chamber();
    const before_ = todaysQueue(c.db, 'popular', TODAY).find((e) => e.visitId === c.visits[0]);
    assert.equal(before_?.attachmentCount, 0);

    const patientId = c.db.prepare('SELECT patient_id AS p FROM visit WHERE id = ?')
      .get(c.visits[0]!) as { p: string };
    const add = (id: string, deleted: string | null) => c.db.prepare(
      `INSERT INTO attachment (id, patient_id, visit_id, kind, captured_at, content,
                               content_type, byte_size, sha256, created_at, created_by, deleted_at)
       VALUES (?, ?, ?, 'report', ?, ?, 'image/jpeg', 1, 'x', ?, ?, ?)`,
    ).run(id, patientId.p, c.visits[0]!, nowIso(), Buffer.from([1]), nowIso(), c.deskId, deleted);
    add('a1', null);
    add('a2', null);
    add('a3', nowIso());

    const after_ = todaysQueue(c.db, 'popular', TODAY).find((e) => e.visitId === c.visits[0]);
    assert.equal(after_?.attachmentCount, 2, 'a deleted photograph was still counted');
    const other = todaysQueue(c.db, 'popular', TODAY).find((e) => e.visitId === c.visits[1]);
    assert.equal(other?.attachmentCount, 0);
    c.cleanup();
  });
});
