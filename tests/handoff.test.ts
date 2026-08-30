import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { provision } from '../src/main/db/provision';
import { nowIso, localDate } from '../src/main/db/clock';
import { registerPatient } from '../src/main/patients/register';
import { registerArrival, setVisitStatus } from '../src/main/queue/register';
import { todaysQueue } from '../src/main/queue/queue';
import { deskSignal } from '../src/main/queue/deskSignal';
import { recordHandoff, openHandoffs, answerHandoff, HandoffError } from '../src/main/queue/handoff';
import { addStaff } from '../src/main/auth/staff';
import { recentAudit } from '../src/main/db/audit';
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
const send = (c: ReturnType<typeof chamber>, visitId: string, reason?: 'ordinary' | 'priority') =>
  recordHandoff(c.db, {
    deskRef: `h-${++n}`, visitId, sentBy: c.deskId, sentAt: nowIso(), reason,
  });
const statusOf = (c: ReturnType<typeof chamber>, visitId: string) =>
  todaysQueue(c.db, 'popular', TODAY).find((e) => e.visitId === visitId)?.status;

describe('the desk hands the patient over, and the chamber answers', () => {
  test('sending changes NOTHING until somebody at the chamber answers', () => {
    const c = chamber();
    const before = todaysQueue(c.db, 'popular', TODAY);
    send(c, c.visits[0]!);
    const after = todaysQueue(c.db, 'popular', TODAY);
    assert.deepEqual(after.map((e) => e.status), before.map((e) => e.status),
      'a tap at the desk changed a visit on its own');
    assert.deepEqual(after.map((e) => e.serialNo), before.map((e) => e.serialNo));
    c.cleanup();
  });

  test('it waits on the doctor’s screen, with who sent it', () => {
    const c = chamber();
    send(c, c.visits[0]!);
    const open = openHandoffs(c.db, 'popular', TODAY);
    assert.equal(open.length, 1);
    assert.equal(open[0]!.serialNo, 1);
    assert.equal(open[0]!.sentByName, 'Biplob');
    assert.equal(open[0]!.reason, 'ordinary');
    assert.equal(open[0]!.roomBusy, false);
    c.cleanup();
  });

  test('accepting is what puts them in the room', () => {
    const c = chamber();
    const { id } = send(c, c.visits[0]!);
    assert.equal(statusOf(c, c.visits[0]!), 'waiting');
    answerHandoff(c.db, id, 'accepted', c.doctor);
    assert.equal(statusOf(c, c.visits[0]!), 'in_chamber');
    assert.equal(openHandoffs(c.db, 'popular', TODAY).length, 0, 'an answered question was asked again');
    c.cleanup();
  });

  // "Not now" must be completely inert. A doctor who is mid-sentence
  // has to be able to dismiss the question without wondering whether he
  // just cost somebody their place.
  test('declining changes nothing at all', () => {
    const c = chamber();
    const { id } = send(c, c.visits[1]!);
    const before = todaysQueue(c.db, 'popular', TODAY);
    answerHandoff(c.db, id, 'declined', c.doctor);
    const after = todaysQueue(c.db, 'popular', TODAY);
    assert.deepEqual(after.map((e) => [e.serialNo, e.status]), before.map((e) => [e.serialNo, e.status]));
    assert.equal(openHandoffs(c.db, 'popular', TODAY).length, 0, 'the question came back after being answered');
    c.cleanup();
  });

  test('the same tap sent twice is one hand-off, not two', () => {
    const c = chamber();
    const ref = `h-same-${++n}`;
    const one = recordHandoff(c.db, { deskRef: ref, visitId: c.visits[0]!, sentBy: c.deskId, sentAt: nowIso() });
    const two = recordHandoff(c.db, { deskRef: ref, visitId: c.visits[0]!, sentBy: c.deskId, sentAt: nowIso() });
    assert.equal(one.alreadyHad, false);
    assert.equal(two.alreadyHad, true);
    assert.equal(two.id, one.id);
    assert.equal(openHandoffs(c.db, 'popular', TODAY).length, 1);
    c.cleanup();
  });

  test('answering twice is not an error and does not move anybody twice', () => {
    const c = chamber();
    const { id } = send(c, c.visits[0]!);
    answerHandoff(c.db, id, 'accepted', c.doctor);
    answerHandoff(c.db, id, 'declined', c.doctor);
    assert.equal(statusOf(c, c.visits[0]!), 'in_chamber', 'a second answer undid the first');
    c.cleanup();
  });

  test('a hand-off nobody made cannot be answered', () => {
    const c = chamber();
    assert.throws(() => answerHandoff(c.db, 'not-a-handoff', 'accepted', c.doctor), HandoffError);
    c.cleanup();
  });

  test('it must carry the name of a real person at the desk', () => {
    const c = chamber();
    assert.throws(() => recordHandoff(c.db, {
      deskRef: `h-${++n}`, visitId: c.visits[0]!, sentBy: 'nobody', sentAt: nowIso(),
    }), HandoffError);
    assert.throws(() => recordHandoff(c.db, {
      deskRef: `h-${++n}`, visitId: 'no-such-visit', sentBy: c.deskId, sentAt: nowIso(),
    }), HandoffError);
    c.cleanup();
  });

  // The doctor called them in himself while the tablet's tap was still
  // in the outbox. Asking him about a patient already in front of him
  // is a puzzle, not a question.
  test('a hand-off for somebody no longer waiting is not asked about', () => {
    const c = chamber();
    send(c, c.visits[0]!);
    setVisitStatus(c.db, c.visits[0]!, 'in_chamber', c.doctor);
    assert.equal(openHandoffs(c.db, 'popular', TODAY).length, 0);
    c.cleanup();
  });

  test('nor for somebody the desk has since marked as gone home', () => {
    const c = chamber();
    send(c, c.visits[2]!);
    setVisitStatus(c.db, c.visits[2]!, 'left', c.doctor);
    assert.equal(openHandoffs(c.db, 'popular', TODAY).length, 0);
    c.cleanup();
  });

  test('the doctor is told when accepting would put two in the room', () => {
    const c = chamber();
    setVisitStatus(c.db, c.visits[0]!, 'in_chamber', c.doctor);
    send(c, c.visits[1]!);
    assert.equal(openHandoffs(c.db, 'popular', TODAY)[0]!.roomBusy, true);
    c.cleanup();
  });

  test('a priority hand-off says so, so the doctor knows a person asked', () => {
    const c = chamber();
    send(c, c.visits[2]!, 'priority');
    assert.equal(openHandoffs(c.db, 'popular', TODAY)[0]!.reason, 'priority');
    c.cleanup();
  });

  test('every one of them is in the audit trail, under a name', () => {
    const c = chamber();
    const { id } = send(c, c.visits[0]!, 'priority');
    answerHandoff(c.db, id, 'accepted', c.doctor);
    const actions = recentAudit(c.db, 40).map((r) => r.action);
    assert.ok(actions.includes('desk_sent_patient_in'), 'the desk’s tap was not recorded');
    assert.ok(actions.includes('desk_handoff_accepted'), 'the doctor’s answer was not recorded');
    const sent = recentAudit(c.db, 40).find((r) => r.action === 'desk_sent_patient_in');
    assert.equal(sent?.actor_id, c.deskId, 'the desk’s tap was recorded against the wrong person');
    assert.equal(sent?.actor_role, 'front_desk');
    c.cleanup();
  });

  test('declining is recorded too, so a patient who waited can be accounted for', () => {
    const c = chamber();
    const { id } = send(c, c.visits[1]!);
    answerHandoff(c.db, id, 'declined', c.doctor);
    assert.ok(recentAudit(c.db, 40).map((r) => r.action).includes('desk_handoff_declined'));
    c.cleanup();
  });
});

describe('gone home, and back again', () => {
  test('a patient who left keeps their serial and their place', () => {
    const c = chamber();
    const before = todaysQueue(c.db, 'popular', TODAY).find((e) => e.visitId === c.visits[1]);
    setVisitStatus(c.db, c.visits[1]!, 'left', c.doctor);
    setVisitStatus(c.db, c.visits[1]!, 'waiting', c.doctor);
    const after = todaysQueue(c.db, 'popular', TODAY).find((e) => e.visitId === c.visits[1]);
    assert.equal(after?.serialNo, before?.serialNo);
    assert.equal(after?.status, 'waiting');
    c.cleanup();
  });

  test('nothing is deleted by leaving', () => {
    const c = chamber();
    setVisitStatus(c.db, c.visits[0]!, 'left', c.doctor);
    assert.equal(
      (c.db.prepare('SELECT count(*) AS n FROM visit WHERE deleted_at IS NOT NULL').get() as { n: number }).n,
      0,
    );
    assert.equal(todaysQueue(c.db, 'popular', TODAY).length, 3, 'a patient vanished from the list');
    c.cleanup();
  });
});

/**
 * The desk has walked them to the door already.
 *
 * A patient sent in is still 'waiting' until the doctor answers, so
 * "who is next" still points at them. Without the signal saying a
 * question is outstanding, the tablet puts their number across the
 * screen again and the assistant calls out somebody who is standing in
 * the doorway.
 */
describe('the tablet is not told to call somebody it has already sent in', () => {
  test('while the question is unanswered, the signal says so', () => {
    const c = chamber();
    const before = deskSignal(c.db, 'popular', TODAY);
    assert.equal(before.handoffPendingVisitId, null);
    send(c, before.nextWaiting!.visitId);
    const after = deskSignal(c.db, 'popular', TODAY);
    assert.equal(after.handoffPendingVisitId, before.nextWaiting!.visitId);
    assert.notEqual(after.at, before.at, 'the tablet had no way to notice');
    c.cleanup();
  });

  test('accepting clears it, and they are in the room', () => {
    const c = chamber();
    const who = deskSignal(c.db, 'popular', TODAY).nextWaiting!.visitId;
    const { id } = send(c, who);
    answerHandoff(c.db, id, 'accepted', c.doctor);
    const sig = deskSignal(c.db, 'popular', TODAY);
    assert.equal(sig.handoffPendingVisitId, null);
    assert.equal(sig.inChamber?.visitId, who);
    c.cleanup();
  });

  // "Not now" must put them back in front of the desk. A patient the
  // doctor declined who then never came up again would be a patient
  // waiting all evening for a number that is never called.
  test('declining clears it, and their number comes up again', () => {
    const c = chamber();
    const who = deskSignal(c.db, 'popular', TODAY).nextWaiting!.visitId;
    const { id } = send(c, who);
    answerHandoff(c.db, id, 'declined', c.doctor);
    const sig = deskSignal(c.db, 'popular', TODAY);
    assert.equal(sig.handoffPendingVisitId, null);
    assert.equal(sig.nextWaiting?.visitId, who, 'a declined patient dropped out of the calling order');
    assert.equal(sig.inChamber, null);
    c.cleanup();
  });

  test('a hand-off for somebody who then goes home stops being pending', () => {
    const c = chamber();
    const who = deskSignal(c.db, 'popular', TODAY).nextWaiting!.visitId;
    send(c, who);
    setVisitStatus(c.db, who, 'left', c.doctor);
    assert.equal(deskSignal(c.db, 'popular', TODAY).handoffPendingVisitId, null);
    c.cleanup();
  });
});
