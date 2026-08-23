import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { provision } from '../src/main/db/provision';
import { newId } from '../src/main/db/ids';
import { nowIso } from '../src/main/db/clock';
import type { Db } from '../src/main/db/open';
import { buildRecallCard } from '../src/main/recall/card';
import { loadRulebook } from '../src/main/redflags/rulebook';
import {
  confirmIntake, unconfirmIntake, correctIntakeAnswer, correctionsFor, ConfirmRefusedError,
} from '../src/main/intake/confirm';
import { laptopRole, setLaptopRole, laptopActor, UNASSIGNED_USER } from '../src/main/db/users';
import { tempDir } from './helpers';

/**
 * Milestone 8. The moment a report from a desk becomes part of a
 * medical record.
 *
 * Two things are being defended here. The first is that only a doctor
 * can make that happen. The second, and the one that matters more, is
 * that a correction never destroys what the patient actually said: the
 * original answer stays exactly as recorded, for ever, and the
 * doctor's version sits beside it.
 */

const DOCTOR = 'user-doctor';
const ASSISTANT = 'user-assistant';
const DESK = 'user-desk';
const CHAMBER = 'chamber-a';
const TODAY = '2026-08-22';

const doctor = { id: DOCTOR, role: 'doctor' as const };
const assistant = { id: ASSISTANT, role: 'clinical_assistant' as const };
const desk = { id: DESK, role: 'front_desk' as const };

const rulebook = loadRulebook(`
approved_by: "Dr Test"
approved_on: "2026-09-01"
rules:
  - id: fires_on_severe
    version: 1
    status: approved
    message: { bn: "খ", en: "Tell the doctor now." }
    when: { question: severity, equals: severe }
`, 'test.yaml').rulebook!;

function newChamber() {
  const t = tempDir();
  const db = provision(t.dir, 'passphrase', 'demo').db;
  const user = (id: string, name: string, role: string) =>
    db.prepare('INSERT INTO app_user (id, display_name, role, is_active, created_at) VALUES (?, ?, ?, 1, ?)')
      .run(id, name, role, nowIso());
  user(DOCTOR, 'Dr Ashraful', 'doctor');
  user(ASSISTANT, 'Rumi', 'clinical_assistant');
  user(DESK, 'Jahid', 'front_desk');
  db.prepare('INSERT INTO chamber (id, name, created_at) VALUES (?, ?, ?)').run(CHAMBER, 'Chamber A', nowIso());
  return { db, cleanup: t.cleanup };
}

let serial = 0;
function newVisitWithIntake(db: Db) {
  const patientId = newId();
  db.prepare(`INSERT INTO patient (id, full_name_bn, full_name_en, search_name_en, phone,
                approx_age_years, approx_age_recorded_on, sex, created_at, created_by, updated_at)
              VALUES (?, 'পরীক্ষা', 'Test Patient', 'test patient', '01711000000', 40, ?, 'female', ?, ?, ?)`)
    .run(patientId, TODAY, nowIso(), DESK, nowIso());

  serial += 1;
  const visitId = newId();
  db.prepare(`INSERT INTO visit (id, patient_id, chamber_id, visit_date, serial_no, arrived_at, status,
                created_at, created_by, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, 'in_chamber', ?, ?, ?)`)
    .run(visitId, patientId, CHAMBER, TODAY, serial, `${TODAY}T17:00:00.000Z`, nowIso(), DESK, nowIso());

  const intakeId = newId();
  db.prepare(`INSERT INTO intake (id, visit_id, recorded_by, started_at, completed_at, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(intakeId, visitId, DESK, nowIso(), nowIso(), nowIso(), nowIso());
  const answer = (key: string, value: string | null, freeText: string | null = null) =>
    db.prepare(`INSERT INTO intake_answer (id, intake_id, question_key, answer_value, answer_free_text,
                  was_skipped, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, 0, ?, ?)`)
      .run(newId(), intakeId, key, value, freeText, nowIso(), nowIso());
  answer('presenting_complaint', null, 'বুকে ব্যথা');
  answer('severity', 'severe');
  answer('duration', 'days');

  return { patientId, visitId, intakeId };
}

describe('confirming a history', () => {
  let db: Db; let cleanup: () => void;
  before(() => { const c = newChamber(); db = c.db; cleanup = c.cleanup; });
  after(() => { db.close(); cleanup(); });

  test('an unconfirmed intake is not part of the record', () => {
    const { visitId } = newVisitWithIntake(db);
    const card = buildRecallCard(db, visitId, new Date(`${TODAY}T18:00:00Z`), rulebook);
    assert.equal(card.today.intake!.confirmedAt, null);
    assert.equal(card.today.intake!.confirmedByName, null);
  });

  test('the doctor confirming stamps his name and the time', () => {
    const { visitId, intakeId } = newVisitWithIntake(db);
    confirmIntake(db, intakeId, doctor, '2026-08-22T18:05:00.000Z');
    const card = buildRecallCard(db, visitId, new Date(`${TODAY}T18:10:00Z`), rulebook);
    assert.equal(card.today.intake!.confirmedAt, '2026-08-22T18:05:00.000Z');
    assert.equal(card.today.intake!.confirmedByName, 'Dr Ashraful');
  });

  test('confirming twice never moves the time of the first confirmation', () => {
    const { intakeId } = newVisitWithIntake(db);
    confirmIntake(db, intakeId, doctor, '2026-08-22T18:05:00.000Z');
    confirmIntake(db, intakeId, doctor, '2026-08-22T19:00:00.000Z');
    const row = db.prepare('SELECT doctor_confirmed_at AS at FROM intake WHERE id = ?').get(intakeId) as { at: string };
    assert.equal(row.at, '2026-08-22T18:05:00.000Z');
  });

  test('a clinical assistant cannot confirm a history', () => {
    const { intakeId } = newVisitWithIntake(db);
    assert.throws(() => confirmIntake(db, intakeId, assistant), ConfirmRefusedError);
    const row = db.prepare('SELECT doctor_confirmed_at AS at FROM intake WHERE id = ?').get(intakeId) as { at: string | null };
    assert.equal(row.at, null);
  });

  test('the front desk cannot confirm a history', () => {
    const { intakeId } = newVisitWithIntake(db);
    assert.throws(() => confirmIntake(db, intakeId, desk), ConfirmRefusedError);
  });

  test('the refusal says what to do about it rather than only that it failed', () => {
    const { intakeId } = newVisitWithIntake(db);
    try {
      confirmIntake(db, intakeId, desk);
      assert.fail('the front desk was allowed to confirm a history');
    } catch (error) {
      assert.ok(error instanceof ConfirmRefusedError);
      assert.match(error.userMessage, /only the doctor/i);
      assert.ok(error.whatToDo.length > 20);
    }
  });

  test('confirming is recorded in the audit log and in the usage log', () => {
    const { visitId, intakeId } = newVisitWithIntake(db);
    confirmIntake(db, intakeId, doctor);
    const audit = db.prepare(
      `SELECT actor_id AS actorId FROM audit_log WHERE action = 'intake_confirmed' AND entity_id = ?`,
    ).get(intakeId) as { actorId: string } | undefined;
    assert.equal(audit?.actorId, DOCTOR);
    const usage = db.prepare(
      `SELECT count(*) AS n FROM usage_event WHERE event_type = 'intake_confirmed' AND visit_id = ?`,
    ).get(visitId) as { n: number };
    assert.equal(usage.n, 1);
  });

  test('undoing a confirmation clears it and leaves both events in the audit log', () => {
    const { intakeId } = newVisitWithIntake(db);
    confirmIntake(db, intakeId, doctor);
    unconfirmIntake(db, intakeId, doctor);
    const row = db.prepare('SELECT doctor_confirmed_at AS at, doctor_confirmed_by AS by FROM intake WHERE id = ?')
      .get(intakeId) as { at: string | null; by: string | null };
    assert.equal(row.at, null);
    assert.equal(row.by, null);
    const actions = db.prepare(
      `SELECT action FROM audit_log WHERE entity_id = ? ORDER BY timestamp, id`,
    ).all(intakeId).map((r) => (r as { action: string }).action);
    assert.ok(actions.includes('intake_confirmed'));
    assert.ok(actions.includes('intake_confirmation_undone'));
  });

  test('only the doctor can undo a confirmation', () => {
    const { intakeId } = newVisitWithIntake(db);
    confirmIntake(db, intakeId, doctor);
    assert.throws(() => unconfirmIntake(db, intakeId, assistant), ConfirmRefusedError);
    const row = db.prepare('SELECT doctor_confirmed_at AS at FROM intake WHERE id = ?').get(intakeId) as { at: string | null };
    assert.notEqual(row.at, null);
  });

  test('confirming an intake that does not exist fails loudly rather than silently', () => {
    assert.throws(() => confirmIntake(db, 'no-such-intake', doctor), ConfirmRefusedError);
  });
});

describe('correcting what the front desk wrote down', () => {
  let db: Db; let cleanup: () => void;
  before(() => { const c = newChamber(); db = c.db; cleanup = c.cleanup; });
  after(() => { db.close(); cleanup(); });

  test('the original answer is never touched', () => {
    const { intakeId } = newVisitWithIntake(db);
    correctIntakeAnswer(db, intakeId, { questionKey: 'presenting_complaint', correctedFreeText: 'বুকে চাপ' }, doctor);
    const original = db.prepare(
      `SELECT answer_free_text AS text FROM intake_answer WHERE intake_id = ? AND question_key = 'presenting_complaint'`,
    ).get(intakeId) as { text: string };
    assert.equal(original.text, 'বুকে ব্যথা');
  });

  test('the correction is readable beside the answer, with who made it', () => {
    const { intakeId } = newVisitWithIntake(db);
    correctIntakeAnswer(db, intakeId, { questionKey: 'severity', correctedValue: 'moderate' }, doctor, '2026-08-22T18:20:00.000Z');
    const [correction] = correctionsFor(db, intakeId);
    assert.equal(correction!.questionKey, 'severity');
    assert.equal(correction!.correctedValue, 'moderate');
    assert.equal(correction!.correctedByName, 'Dr Ashraful');
    assert.equal(correction!.correctedAt, '2026-08-22T18:20:00.000Z');
  });

  test('a second correction of the same question is shown, and the first is still there', () => {
    const { intakeId } = newVisitWithIntake(db);
    correctIntakeAnswer(db, intakeId, { questionKey: 'duration', correctedValue: 'weeks' }, doctor, '2026-08-22T18:20:00.000Z');
    correctIntakeAnswer(db, intakeId, { questionKey: 'duration', correctedValue: 'months' }, doctor, '2026-08-22T18:25:00.000Z');

    const shown = correctionsFor(db, intakeId);
    assert.equal(shown.length, 1);
    assert.equal(shown[0]!.correctedValue, 'months');

    const kept = db.prepare('SELECT count(*) AS n FROM intake_correction WHERE intake_id = ?').get(intakeId) as { n: number };
    assert.equal(kept.n, 2);
  });

  test('two corrections in the same millisecond still show exactly one answer', () => {
    const { intakeId } = newVisitWithIntake(db);
    correctIntakeAnswer(db, intakeId, { questionKey: 'duration', correctedValue: 'weeks' }, doctor, '2026-08-22T18:20:00.000Z');
    correctIntakeAnswer(db, intakeId, { questionKey: 'duration', correctedValue: 'months' }, doctor, '2026-08-22T18:20:00.000Z');
    const shown = correctionsFor(db, intakeId);
    assert.equal(shown.length, 1);
    assert.equal(shown[0]!.correctedValue, 'months');
  });

  test('the doctor can mark an answer wrong without offering another one', () => {
    const { intakeId } = newVisitWithIntake(db);
    correctIntakeAnswer(db, intakeId, { questionKey: 'severity', markedWrong: true, note: 'she did not say that' }, doctor);
    const [correction] = correctionsFor(db, intakeId);
    assert.equal(correction!.markedWrong, true);
    assert.equal(correction!.correctedValue, null);
    assert.equal(correction!.note, 'she did not say that');
  });

  test('a question that was never asked cannot be corrected', () => {
    const { intakeId } = newVisitWithIntake(db);
    assert.throws(
      () => correctIntakeAnswer(db, intakeId, { questionKey: 'allergies', correctedValue: 'none' }, doctor),
      ConfirmRefusedError,
    );
  });

  test('a clinical assistant cannot correct an answer', () => {
    const { intakeId } = newVisitWithIntake(db);
    assert.throws(
      () => correctIntakeAnswer(db, intakeId, { questionKey: 'severity', correctedValue: 'mild' }, assistant),
      ConfirmRefusedError,
    );
    assert.equal(correctionsFor(db, intakeId).length, 0);
  });

  test('a correction cannot be edited afterwards', () => {
    const { intakeId } = newVisitWithIntake(db);
    const id = correctIntakeAnswer(db, intakeId, { questionKey: 'severity', correctedValue: 'mild' }, doctor);
    assert.throws(
      () => db.prepare('UPDATE intake_correction SET corrected_value = ? WHERE id = ?').run('severe', id),
      /append-only/,
    );
  });

  test('a correction cannot be deleted', () => {
    const { intakeId } = newVisitWithIntake(db);
    const id = correctIntakeAnswer(db, intakeId, { questionKey: 'severity', correctedValue: 'mild' }, doctor);
    assert.throws(() => db.prepare('DELETE FROM intake_correction WHERE id = ?').run(id), /append-only/);
  });

  test('every correction is in the audit log', () => {
    const { intakeId } = newVisitWithIntake(db);
    correctIntakeAnswer(db, intakeId, { questionKey: 'severity', correctedValue: 'mild' }, doctor);
    correctIntakeAnswer(db, intakeId, { questionKey: 'duration', correctedValue: 'weeks' }, doctor);
    const n = db.prepare(
      `SELECT count(*) AS n FROM audit_log WHERE action = 'intake_answer_corrected' AND entity_id = ?`,
    ).get(intakeId) as { n: number };
    assert.equal(n.n, 2);
  });

  test('the Recall Card carries the corrections along with the answers', () => {
    const { visitId, intakeId } = newVisitWithIntake(db);
    correctIntakeAnswer(db, intakeId, { questionKey: 'severity', correctedValue: 'moderate' }, doctor);
    const card = buildRecallCard(db, visitId, new Date(`${TODAY}T18:30:00Z`), rulebook);
    assert.equal(card.today.intake!.corrections.length, 1);
    assert.equal(card.today.intake!.corrections[0]!.correctedValue, 'moderate');
    // The answer itself still says what the patient said.
    const severity = card.today.intake!.answers.find((a) => a.questionKey === 'severity');
    assert.equal(severity!.value, 'severe');
  });

  test('correcting an answer does not confirm the history by itself', () => {
    const { intakeId } = newVisitWithIntake(db);
    correctIntakeAnswer(db, intakeId, { questionKey: 'severity', correctedValue: 'mild' }, doctor);
    const row = db.prepare('SELECT doctor_confirmed_at AS at FROM intake WHERE id = ?').get(intakeId) as { at: string | null };
    assert.equal(row.at, null);
  });
});

describe('who the laptop is speaking for', () => {
  let db: Db; let cleanup: () => void;
  before(() => { const c = newChamber(); db = c.db; cleanup = c.cleanup; });
  after(() => { db.close(); cleanup(); });

  test('it is the doctor until somebody says otherwise, because it is the doctor\'s laptop', () => {
    assert.equal(laptopRole(db), 'doctor');
  });

  test('the setting is remembered', () => {
    setLaptopRole(db, 'front_desk');
    assert.equal(laptopRole(db), 'front_desk');
    setLaptopRole(db, 'doctor');
    assert.equal(laptopRole(db), 'doctor');
  });

  test('the actor it produces is a real user row, so nothing is ever recorded against nobody', () => {
    setLaptopRole(db, 'clinical_assistant');
    const actor = laptopActor(db);
    assert.equal(actor.id, UNASSIGNED_USER.clinical_assistant);
    const user = db.prepare('SELECT display_name AS name, role FROM app_user WHERE id = ?').get(actor.id) as
      { name: string; role: string } | undefined;
    assert.notEqual(user, undefined);
    assert.equal(user!.role, 'clinical_assistant');
  });

  test('with the laptop set to the front desk, confirming is refused end to end', () => {
    setLaptopRole(db, 'front_desk');
    const { intakeId } = newVisitWithIntake(db);
    assert.throws(() => confirmIntake(db, intakeId, laptopActor(db)), ConfirmRefusedError);
    setLaptopRole(db, 'doctor');
    confirmIntake(db, intakeId, laptopActor(db));
    const row = db.prepare('SELECT doctor_confirmed_by AS by FROM intake WHERE id = ?').get(intakeId) as { by: string };
    assert.equal(row.by, UNASSIGNED_USER.doctor);
  });
});
