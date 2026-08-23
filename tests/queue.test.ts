import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { provision } from '../src/main/db/provision';
import { newId } from '../src/main/db/ids';
import { nowIso } from '../src/main/db/clock';
import type { Db } from '../src/main/db/open';
import { registerPatient } from '../src/main/patients/register';
import { mergePatients } from '../src/main/patients/merge';
import { registerArrival, setVisitStatus, RegisterRefusedError } from '../src/main/queue/register';
import { todaysQueue, moveInQueue, activeChamberId, setActiveChamber, chambers } from '../src/main/queue/queue';
import { loadRulebook } from '../src/main/redflags/rulebook';
import { screenIntake } from '../src/main/redflags/store';
import { tempDir } from './helpers';

const DESK = { id: 'user-desk', role: 'front_desk' as const };
const TODAY = '2026-08-22';
const AS_OF = new Date('2026-08-22T18:30:00Z');

const rulebook = loadRulebook(`
approved_by: "Dr Test"
approved_on: "2026-09-01"
rules:
  - id: fires_on_severe
    version: 1
    status: approved
    message: { bn: "এখনই ডাক্তারকে জানান।", en: "Tell the doctor now." }
    when: { question: severity, equals: severe }
`, 'test.yaml').rulebook!;

function newChamber() {
  const t = tempDir();
  const db = provision(t.dir, 'passphrase', 'demo').db;
  db.prepare('INSERT INTO app_user (id, display_name, role, is_active, created_at) VALUES (?, ?, ?, 1, ?)')
    .run(DESK.id, 'Jahid', 'front_desk', nowIso());
  db.prepare('INSERT INTO chamber (id, name, created_at) VALUES (?, ?, ?)').run('ch-a', 'Green Life', nowIso());
  db.prepare('INSERT INTO chamber (id, name, created_at) VALUES (?, ?, ?)').run('ch-b', 'Al-Shifa', nowIso());
  return { db, cleanup: t.cleanup };
}

let n = 0;
function addPatient(db: Db, name = `Patient ${++n}`) {
  return registerPatient(db, { fullNameBn: null, fullNameEn: name, phone: null, dob: null,
    approxAgeYears: 40, sex: 'male', addressFreeText: null }, DESK);
}

function arriveAt(db: Db, patientId: string, minutesPast: number) {
  const arrivedAt = new Date(AS_OF.getTime() - minutesPast * 60000).toISOString();
  return registerArrival(db, patientId, 'ch-a', DESK, { visitDate: TODAY, arrivedAt });
}

function giveIntake(db: Db, visitId: string, severity: string) {
  const intakeId = newId();
  db.prepare(`INSERT INTO intake (id, visit_id, recorded_by, started_at, completed_at, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)`).run(intakeId, visitId, DESK.id, nowIso(), nowIso(), nowIso(), nowIso());
  db.prepare(`INSERT INTO intake_answer (id, intake_id, question_key, answer_value, was_skipped, created_at, updated_at)
              VALUES (?, ?, 'severity', ?, 0, ?, ?)`).run(newId(), intakeId, severity, nowIso(), nowIso());
  screenIntake(db, rulebook, intakeId, DESK);
  return intakeId;
}

describe('giving out serial numbers', () => {
  let db: Db; let cleanup: () => void;
  before(() => { const c = newChamber(); db = c.db; cleanup = c.cleanup; });
  after(() => { db.close(); cleanup(); });

  test('the first patient of the evening is number one, and they count up', () => {
    assert.equal(arriveAt(db, addPatient(db), 60).serialNo, 1);
    assert.equal(arriveAt(db, addPatient(db), 55).serialNo, 2);
    assert.equal(arriveAt(db, addPatient(db), 50).serialNo, 3);
  });

  test('each chamber counts on its own', () => {
    const result = registerArrival(db, addPatient(db), 'ch-b', DESK, { visitDate: TODAY });
    assert.equal(result.serialNo, 1);
  });

  test('a patient who left still used up their number', () => {
    // A crossed-out line in a paper register does not free the number
    // either, and an assistant who saw "4" called must never hear it
    // called again for somebody else.
    const leaver = arriveAt(db, addPatient(db), 45);
    setVisitStatus(db, leaver.visitId, 'left', DESK);
    assert.equal(arriveAt(db, addPatient(db), 40).serialNo, leaver.serialNo + 1);
  });

  test('adding the same patient twice reports it instead of doing it', () => {
    const patientId = addPatient(db);
    const first = arriveAt(db, patientId, 30);
    const second = arriveAt(db, patientId, 29);
    assert.equal(second.alreadyOnListVisitId, first.visitId);
    assert.equal(second.serialNo, 0, 'no second number was given out');
  });

  test('but a genuine second visit in one evening is allowed when confirmed', () => {
    const patientId = addPatient(db);
    const first = registerArrival(db, patientId, 'ch-a', DESK, { visitDate: TODAY });
    const second = registerArrival(db, patientId, 'ch-a', DESK, { visitDate: TODAY, allowSecondVisitToday: true });
    assert.equal(second.alreadyOnListVisitId, null);
    assert.equal(second.serialNo, first.serialNo + 1);
  });

  test('a patient picked from a merged record is put under the record in use', () => {
    const keep = addPatient(db, 'Kept Record');
    const duplicate = addPatient(db, 'Duplicate Record');
    mergePatients(db, keep, duplicate, DESK);

    const result = registerArrival(db, duplicate, 'ch-a', DESK, { visitDate: TODAY });
    const row = db.prepare('SELECT patient_id FROM visit WHERE id = ?').get(result.visitId) as { patient_id: string };
    assert.equal(row.patient_id, keep);
  });

  test('registering is audited and counted for the pilot report', () => {
    const audit = db.prepare(`SELECT count(*) AS n FROM audit_log WHERE action = 'visit_registered'`).get() as { n: number };
    const usage = db.prepare(`SELECT count(*) AS n FROM usage_event WHERE event_type = 'visit_registered'`).get() as { n: number };
    assert.ok(audit.n > 0);
    assert.ok(usage.n > 0);
  });

  test('registering into a chamber that does not exist is refused clearly', () => {
    assert.throws(() => registerArrival(db, addPatient(db), 'no-such-chamber', DESK, { visitDate: TODAY }),
      RegisterRefusedError);
  });
});

describe('moving a patient through the evening', () => {
  let db: Db; let cleanup: () => void; let visitId: string;
  before(() => {
    const c = newChamber(); db = c.db; cleanup = c.cleanup;
    visitId = arriveAt(db, addPatient(db), 40).visitId;
  });
  after(() => { db.close(); cleanup(); });

  test('waiting, then in the chamber, then seen', () => {
    setVisitStatus(db, visitId, 'in_chamber', DESK, '2026-08-22T18:00:00.000Z');
    setVisitStatus(db, visitId, 'done', DESK);
    const row = db.prepare('SELECT status, seen_at FROM visit WHERE id = ?').get(visitId) as { status: string; seen_at: string };
    assert.equal(row.status, 'done');
    assert.equal(row.seen_at, '2026-08-22T18:00:00.000Z');
  });

  test('a wrong tap can be undone', () => {
    setVisitStatus(db, visitId, 'in_chamber', DESK, '2026-08-22T19:00:00.000Z');
    assert.equal((db.prepare('SELECT status FROM visit WHERE id = ?').get(visitId) as { status: string }).status, 'in_chamber');
  });

  test('the time they were first called in is never rewritten', () => {
    // It is the answer to "how long did this person wait", and a second
    // trip into the chamber must not erase the first one's timing.
    const row = db.prepare('SELECT seen_at FROM visit WHERE id = ?').get(visitId) as { seen_at: string };
    assert.equal(row.seen_at, '2026-08-22T18:00:00.000Z');
  });

  test('a nonsensical jump is refused, in plain words', () => {
    const other = arriveAt(db, addPatient(db), 20).visitId;
    try {
      setVisitStatus(db, other, 'done', DESK);
      assert.fail('expected a refusal');
    } catch (error) {
      assert.ok(error instanceof RegisterRefusedError);
      assert.match(error.whatToDo, /one step at a time/);
    }
  });

  test('every move is audited', () => {
    const row = db.prepare(`SELECT count(*) AS n FROM audit_log WHERE action = 'visit_status_changed'`).get() as { n: number };
    assert.ok(row.n >= 3);
  });
});

describe('the live queue', () => {
  let db: Db; let cleanup: () => void;
  let first: string; let second: string; let third: string; let inChamber: string; let seen: string;

  before(() => {
    const c = newChamber(); db = c.db; cleanup = c.cleanup;
    first = arriveAt(db, addPatient(db, 'First Waiting'), 50).visitId;
    second = arriveAt(db, addPatient(db, 'Second Waiting'), 40).visitId;
    third = arriveAt(db, addPatient(db, 'Third Waiting'), 30).visitId;
    inChamber = arriveAt(db, addPatient(db, 'With The Doctor'), 70).visitId;
    seen = arriveAt(db, addPatient(db, 'Already Seen'), 90).visitId;

    setVisitStatus(db, inChamber, 'in_chamber', DESK);
    setVisitStatus(db, seen, 'in_chamber', DESK, new Date(AS_OF.getTime() - 60 * 60000).toISOString());
    setVisitStatus(db, seen, 'done', DESK);
  });
  after(() => { db.close(); cleanup(); });

  test('the patient with the doctor is at the top, then those waiting, then those seen', () => {
    const queue = todaysQueue(db, 'ch-a', TODAY, AS_OF);
    assert.deepEqual(queue.map((e) => e.status), ['in_chamber', 'waiting', 'waiting', 'waiting', 'done']);
    assert.equal(queue[0]!.visitId, inChamber);
  });

  test('those waiting are in the order they arrived', () => {
    const waiting = todaysQueue(db, 'ch-a', TODAY, AS_OF).filter((e) => e.status === 'waiting');
    assert.deepEqual(waiting.map((e) => e.nameEn), ['First Waiting', 'Second Waiting', 'Third Waiting']);
  });

  test('waiting time counts up for those still waiting', () => {
    const entry = todaysQueue(db, 'ch-a', TODAY, AS_OF).find((e) => e.visitId === first)!;
    assert.equal(entry.waitedMinutes, 50);
  });

  test('waiting time stops for those already called in', () => {
    const entry = todaysQueue(db, 'ch-a', TODAY, AS_OF).find((e) => e.visitId === seen)!;
    assert.equal(entry.waitedMinutes, 30, 'arrived 90 minutes ago, called in 60 minutes ago');
  });

  test('a patient with no intake is shown as not screened at all', () => {
    // Answered as question G: the absence has to be as visible as an
    // alert, or nobody knows this patient was never asked anything.
    const entry = todaysQueue(db, 'ch-a', TODAY, AS_OF).find((e) => e.visitId === first)!;
    assert.equal(entry.intakeStarted, false);
    assert.equal(entry.screeningRan, false);
    assert.deepEqual(entry.redFlags, []);
  });

  test('a first-time patient is distinguishable from a returning one', () => {
    const entry = todaysQueue(db, 'ch-a', TODAY, AS_OF).find((e) => e.visitId === first)!;
    assert.equal(entry.previousVisits, 0);
    assert.equal(entry.lastVisitDate, null);
  });
});

describe('reordering who is seen next', () => {
  let db: Db; let cleanup: () => void;
  let a: string; let b: string; let c: string;

  before(() => {
    const chamber = newChamber(); db = chamber.db; cleanup = chamber.cleanup;
    a = arriveAt(db, addPatient(db, 'Arrived First'), 60).visitId;
    b = arriveAt(db, addPatient(db, 'Arrived Second'), 50).visitId;
    c = arriveAt(db, addPatient(db, 'Arrived Third'), 40).visitId;
  });
  after(() => { db.close(); cleanup(); });

  const order = () => todaysQueue(db, 'ch-a', TODAY, AS_OF).filter((e) => e.status === 'waiting').map((e) => e.nameEn);

  test('a patient can be moved up', () => {
    moveInQueue(db, c, 'up', DESK);
    assert.deepEqual(order(), ['Arrived First', 'Arrived Third', 'Arrived Second']);
  });

  test('and back down again', () => {
    moveInQueue(db, c, 'down', DESK);
    assert.deepEqual(order(), ['Arrived First', 'Arrived Second', 'Arrived Third']);
  });

  test('moving past the ends does nothing rather than failing', () => {
    moveInQueue(db, a, 'up', DESK);
    moveInQueue(db, c, 'down', DESK);
    assert.deepEqual(order(), ['Arrived First', 'Arrived Second', 'Arrived Third']);
  });

  test('their serial numbers do not change when the order does', () => {
    // The serial is what the patient was told and what gets called out.
    // Reordering who is seen next must never renumber anybody.
    const before = db.prepare('SELECT id, serial_no FROM visit ORDER BY serial_no').all();
    moveInQueue(db, c, 'up', DESK);
    moveInQueue(db, c, 'up', DESK);
    const after = db.prepare('SELECT id, serial_no FROM visit ORDER BY serial_no').all();
    assert.deepEqual(after, before);
    moveInQueue(db, c, 'down', DESK);
    moveInQueue(db, c, 'down', DESK);
  });

  test('reordering is audited', () => {
    const row = db.prepare(`SELECT count(*) AS n FROM audit_log WHERE action = 'queue_reordered'`).get() as { n: number };
    assert.ok(row.n > 0);
  });

  test('somebody already with the doctor cannot be shuffled', () => {
    setVisitStatus(db, a, 'in_chamber', DESK);
    assert.throws(() => moveInQueue(db, a, 'down', DESK), RegisterRefusedError);
    setVisitStatus(db, a, 'waiting', DESK);
  });
});

// =====================================================================
// The escalation rule.
// =====================================================================
describe('a flagged patient is moved up and can never be moved back down', () => {
  let db: Db; let cleanup: () => void;
  let ordinary1: string; let ordinary2: string; let flagged: string; let flagged2: string;

  before(() => {
    const chamber = newChamber(); db = chamber.db; cleanup = chamber.cleanup;
    ordinary1 = arriveAt(db, addPatient(db, 'Ordinary One'), 90).visitId;
    ordinary2 = arriveAt(db, addPatient(db, 'Ordinary Two'), 80).visitId;
    flagged = arriveAt(db, addPatient(db, 'Flagged Late Arrival'), 10).visitId;
    flagged2 = arriveAt(db, addPatient(db, 'Flagged Later Still'), 5).visitId;

    giveIntake(db, ordinary1, 'mild');
    giveIntake(db, ordinary2, 'moderate');
    giveIntake(db, flagged, 'severe');
    giveIntake(db, flagged2, 'severe');
  });
  after(() => { db.close(); cleanup(); });

  const order = () => todaysQueue(db, 'ch-a', TODAY, AS_OF).filter((e) => e.status === 'waiting').map((e) => e.nameEn);

  test('the flagged patients sort above everyone else, however late they arrived', () => {
    assert.deepEqual(order(), ['Flagged Late Arrival', 'Flagged Later Still', 'Ordinary One', 'Ordinary Two']);
  });

  test('the queue says which patients carry a flag', () => {
    const entry = todaysQueue(db, 'ch-a', TODAY, AS_OF).find((e) => e.visitId === flagged)!;
    assert.equal(entry.redFlags.length, 1);
    assert.equal(entry.redFlags[0]!.ruleId, 'fires_on_severe');
    assert.equal(entry.redFlags[0]!.acknowledgedAt, null);
  });

  test('an ordinary patient cannot be moved above a flagged one', () => {
    try {
      moveInQueue(db, ordinary1, 'up', DESK);
      assert.fail('expected a refusal');
    } catch (error) {
      assert.ok(error instanceof RegisterRefusedError);
      assert.match(error.whatToDo, /always stays ahead/);
    }
    assert.deepEqual(order(), ['Flagged Late Arrival', 'Flagged Later Still', 'Ordinary One', 'Ordinary Two']);
  });

  test('a flagged patient cannot be moved down behind an ordinary one', () => {
    // This is the de-escalation the software must have no way to do,
    // by any sequence of taps, deliberate or accidental.
    assert.throws(() => moveInQueue(db, flagged2, 'down', DESK), RegisterRefusedError);
    assert.deepEqual(order(), ['Flagged Late Arrival', 'Flagged Later Still', 'Ordinary One', 'Ordinary Two']);
  });

  test('flagged patients can still be ordered among themselves', () => {
    moveInQueue(db, flagged2, 'up', DESK);
    assert.deepEqual(order(), ['Flagged Later Still', 'Flagged Late Arrival', 'Ordinary One', 'Ordinary Two']);
    moveInQueue(db, flagged2, 'down', DESK);
  });

  test('ordinary patients can still be ordered among themselves', () => {
    moveInQueue(db, ordinary2, 'up', DESK);
    assert.deepEqual(order(), ['Flagged Late Arrival', 'Flagged Later Still', 'Ordinary Two', 'Ordinary One']);
  });

  test('the only way out of the flagged group is being seen', () => {
    setVisitStatus(db, flagged, 'in_chamber', DESK);
    const queue = todaysQueue(db, 'ch-a', TODAY, AS_OF);
    assert.equal(queue[0]!.visitId, flagged, 'now with the doctor, which is where the alert was driving them');
    assert.equal(queue.filter((e) => e.status === 'waiting')[0]!.nameEn, 'Flagged Later Still');
  });
});

describe('choosing which chamber the register is for', () => {
  test('it defaults to the first chamber and remembers a choice', () => {
    const c = newChamber();
    assert.equal(activeChamberId(c.db), 'ch-a');
    setActiveChamber(c.db, 'ch-b');
    assert.equal(activeChamberId(c.db), 'ch-b');
    assert.deepEqual(chambers(c.db).map((x) => x.name), ['Green Life', 'Al-Shifa']);
    c.db.close(); c.cleanup();
  });

  test('a chamber that has been removed falls back rather than breaking the screen', () => {
    const c = newChamber();
    setActiveChamber(c.db, 'ch-b');
    c.db.prepare('UPDATE chamber SET deleted_at = ? WHERE id = ?').run(nowIso(), 'ch-b');
    assert.equal(activeChamberId(c.db), 'ch-a');
    c.db.close(); c.cleanup();
  });
});

describe('a flagged patient leaving without being seen', () => {
  // The one path that takes a flagged patient out of the queue without
  // the doctor ever seeing them. The software cannot stop a patient
  // walking out; it can refuse to let it happen quietly.
  let db: Db; let cleanup: () => void; let flagged: string; let ordinary: string;

  before(() => {
    const chamber = newChamber(); db = chamber.db; cleanup = chamber.cleanup;
    flagged = arriveAt(db, addPatient(db, 'Flagged Leaver'), 30).visitId;
    ordinary = arriveAt(db, addPatient(db, 'Ordinary Leaver'), 25).visitId;
    giveIntake(db, flagged, 'severe');
    giveIntake(db, ordinary, 'mild');
  });
  after(() => { db.close(); cleanup(); });

  test('it is allowed, because a patient really can walk out', () => {
    setVisitStatus(db, flagged, 'left', DESK);
    assert.equal((db.prepare('SELECT status FROM visit WHERE id = ?').get(flagged) as { status: string }).status, 'left');
  });

  test('and it is recorded as its own event, findable without reading every status change', () => {
    const row = db.prepare(
      `SELECT entity_id, details_json FROM audit_log WHERE action = 'flagged_patient_left_unseen'`).get() as
      { entity_id: string; details_json: string };
    assert.equal(row.entity_id, flagged);
    assert.equal(JSON.parse(row.details_json).red_flags, 1);
  });

  test('an ordinary patient leaving does not raise that event', () => {
    setVisitStatus(db, ordinary, 'left', DESK);
    const row = db.prepare(
      `SELECT count(*) AS n FROM audit_log WHERE action = 'flagged_patient_left_unseen'`).get() as { n: number };
    assert.equal(row.n, 1);
  });

  test('the ordinary departure is still in the log like everything else', () => {
    const row = db.prepare(
      `SELECT details_json FROM audit_log WHERE action = 'visit_status_changed' AND entity_id = ?
       ORDER BY id DESC LIMIT 1`).get(ordinary) as { details_json: string };
    assert.deepEqual(JSON.parse(row.details_json), { from: 'waiting', to: 'left', red_flags: 0 });
  });

  test('they can be put back if they come back', () => {
    setVisitStatus(db, flagged, 'waiting', DESK);
    const queue = todaysQueue(db, 'ch-a', TODAY, AS_OF);
    assert.equal(queue[0]!.visitId, flagged, 'and the flag still puts them at the front');
  });
});
