// ===================================================================
// Taking an intake.
// ===================================================================
// Every operation here is safe to repeat. The tablet buffers what it
// cannot send and sends it again later, sometimes twice, so "save this
// answer" arriving a second time must change nothing.
import type { Db } from '../db/open';
import { newId } from '../db/ids';
import { nowIso } from '../db/clock';
import { recordAudit, type Actor } from '../db/audit';
import { recordUsage } from '../db/usage';
import { patientAgeYears } from '../db/age';
import { ChamberRecallError } from '../../shared/errors';
import type { Facts } from '../rules/facts';

export class IntakeRefusedError extends ChamberRecallError {}

export interface AnswerInput {
  questionKey: string;
  value: string | null;
  freeText: string | null;
  skipped: boolean;
}

/**
 * Starts an intake for a visit, or returns the one already started.
 *
 * Idempotent on purpose: the tablet may ask twice after a dropped
 * connection, and a patient must never end up with two intakes.
 */
export function startIntake(db: Db, visitId: string, actor: Actor, at: string = nowIso()): string {
  const visit = db.prepare('SELECT id FROM visit WHERE id = ? AND deleted_at IS NULL').get(visitId);
  if (visit === undefined) {
    throw new IntakeRefusedError('That patient is no longer on today\'s list.', 'Go back and choose the patient again.');
  }

  const existing = db.prepare('SELECT id FROM intake WHERE visit_id = ? AND deleted_at IS NULL').get(visitId) as
    { id: string } | undefined;
  if (existing !== undefined) return existing.id;

  const id = newId();
  const write = db.transaction(() => {
    db.prepare(
      `INSERT INTO intake (id, visit_id, recorded_by, started_at, was_skipped, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, ?)`,
    ).run(id, visitId, actor.id, at, at, at);
    recordAudit(db, { actor, action: 'intake_started', entity: 'intake', entityId: id, details: { visit_id: visitId } });
  });
  write();
  recordUsage(db, { eventType: 'intake_started', actorId: actor.id, visitId, timestamp: at });
  return id;
}

/**
 * Writes answers down. An answer arriving twice overwrites itself with
 * the same thing, so a resent buffer is harmless.
 *
 * A skipped question is stored as a row, not as an absent one: "asked
 * and skipped" and "never asked" are different facts and the doctor's
 * screen has to be able to tell them apart.
 */
export function saveAnswers(db: Db, intakeId: string, answers: AnswerInput[], at: string = nowIso()): void {
  const intake = db.prepare('SELECT id FROM intake WHERE id = ? AND deleted_at IS NULL').get(intakeId);
  if (intake === undefined) {
    throw new IntakeRefusedError('That intake is no longer open.', 'Go back to the patient list and start again.');
  }

  const write = db.transaction(() => {
    const upsert = db.prepare(
      `INSERT INTO intake_answer (id, intake_id, question_key, answer_value, answer_free_text, was_skipped, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(intake_id, question_key) DO UPDATE SET
         answer_value = excluded.answer_value,
         answer_free_text = excluded.answer_free_text,
         was_skipped = excluded.was_skipped,
         updated_at = excluded.updated_at`,
    );
    for (const answer of answers) {
      upsert.run(newId(), intakeId, answer.questionKey,
        answer.skipped ? null : answer.value,
        answer.skipped ? null : answer.freeText,
        answer.skipped ? 1 : 0, at, at);
    }
    db.prepare('UPDATE intake SET updated_at = ? WHERE id = ?').run(at, intakeId);
  });
  write();
}

export function finishIntake(db: Db, intakeId: string, actor: Actor, at: string = nowIso()): void {
  const intake = db.prepare(
    'SELECT visit_id AS visitId, started_at AS startedAt, completed_at AS completedAt FROM intake WHERE id = ? AND deleted_at IS NULL',
  ).get(intakeId) as { visitId: string; startedAt: string; completedAt: string | null } | undefined;
  if (intake === undefined) {
    throw new IntakeRefusedError('That intake is no longer open.', 'Go back to the patient list and start again.');
  }
  if (intake.completedAt !== null) return;

  const write = db.transaction(() => {
    db.prepare('UPDATE intake SET completed_at = ?, updated_at = ? WHERE id = ?').run(at, at, intakeId);
    recordAudit(db, { actor, action: 'intake_completed', entity: 'intake', entityId: intakeId, details: null });
  });
  write();

  recordUsage(db, {
    eventType: 'intake_completed', actorId: actor.id, visitId: intake.visitId, timestamp: at,
    durationMs: Math.max(0, new Date(at).getTime() - new Date(intake.startedAt).getTime()),
  });
}

export interface IntakeState {
  intakeId: string;
  visitId: string;
  startedAt: string;
  completedAt: string | null;
  answers: Record<string, { value: string | null; freeText: string | null; skipped: boolean }>;
  presented: string[];
  patient: { ageYears: number | null; sex: string | null };
}

/** Everything the tablet needs to carry on where it left off. */
export function intakeState(db: Db, intakeId: string, asOf: Date = new Date()): IntakeState | null {
  const intake = db.prepare(
    `SELECT i.id, i.visit_id AS visitId, i.started_at AS startedAt, i.completed_at AS completedAt,
            p.dob, p.approx_age_years, p.approx_age_recorded_on, p.sex
     FROM intake i JOIN visit v ON v.id = i.visit_id JOIN patient p ON p.id = v.patient_id
     WHERE i.id = ? AND i.deleted_at IS NULL`,
  ).get(intakeId) as {
    id: string; visitId: string; startedAt: string; completedAt: string | null;
    dob: string | null; approx_age_years: number | null; approx_age_recorded_on: string | null; sex: string | null;
  } | undefined;
  if (intake === undefined) return null;

  const rows = db.prepare(
    `SELECT question_key AS key, answer_value AS value, answer_free_text AS freeText, was_skipped AS skipped
     FROM intake_answer WHERE intake_id = ? ORDER BY created_at`,
  ).all(intakeId) as Array<{ key: string; value: string | null; freeText: string | null; skipped: number }>;

  const answers: IntakeState['answers'] = {};
  for (const row of rows) {
    answers[row.key] = { value: row.value, freeText: row.freeText, skipped: row.skipped === 1 };
  }

  return {
    intakeId: intake.id,
    visitId: intake.visitId,
    startedAt: intake.startedAt,
    completedAt: intake.completedAt,
    answers,
    presented: rows.map((r) => r.key),
    patient: { ageYears: patientAgeYears(intake, asOf), sex: intake.sex },
  };
}

export function factsFor(state: IntakeState): Facts {
  return { answers: state.answers, patient: state.patient };
}
