// ===================================================================
// The doctor accepting, or correcting, the front desk's history.
// ===================================================================
import type { Db } from '../db/open';
import { newId } from '../db/ids';
import { nowIso } from '../db/clock';
import { recordAudit, type Actor } from '../db/audit';
import { recordUsage } from '../db/usage';
import { ChamberRecallError } from '../../shared/errors';
import { mayConfirmEncounter } from '../../shared/roles';

export class ConfirmRefusedError extends ChamberRecallError {}

export interface CorrectionInput {
  questionKey: string;
  correctedValue?: string | null;
  correctedFreeText?: string | null;
  markedWrong?: boolean;
  note?: string | null;
}

function requireDoctor(actor: Actor, what: string): void {
  if (actor.role === 'system') return;
  if (!mayConfirmEncounter(actor.role)) {
    throw new ConfirmRefusedError(
      `Only the doctor can ${what}.`,
      'This turns what the patient told the front desk into part of their medical record, so it is the doctor\'s to accept. Switch to the doctor at the top of the screen.',
    );
  }
  if (actor.id === null) {
    throw new ConfirmRefusedError(
      'This cannot be recorded without knowing who did it.',
      'That is a fault in the software rather than anything you did. Report it before carrying on.',
    );
  }
}

/**
 * Records a correction. The front desk answer is left exactly as it
 * was: it is evidence of what a patient said to somebody, and the
 * doctor's version sits alongside rather than on top of it.
 */
export function correctIntakeAnswer(db: Db, intakeId: string, correction: CorrectionInput, actor: Actor, at: string = nowIso()): string {
  requireDoctor(actor, 'correct what the front desk recorded');

  const intake = db.prepare('SELECT id FROM intake WHERE id = ? AND deleted_at IS NULL').get(intakeId);
  if (intake === undefined) {
    throw new ConfirmRefusedError('That intake no longer exists.', 'Reopen the patient and try again.');
  }
  const asked = db.prepare('SELECT id FROM intake_answer WHERE intake_id = ? AND question_key = ?')
    .get(intakeId, correction.questionKey);
  if (asked === undefined) {
    throw new ConfirmRefusedError(
      'That question was never put to this patient, so there is nothing to correct.',
      'Ask them directly and record it in your own notes instead.',
    );
  }

  const id = newId();
  const write = db.transaction(() => {
    db.prepare(
      `INSERT INTO intake_correction (id, intake_id, question_key, corrected_value, corrected_free_text,
         marked_wrong, corrected_by, corrected_at, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, intakeId, correction.questionKey,
      correction.correctedValue ?? null, correction.correctedFreeText ?? null,
      correction.markedWrong === true ? 1 : 0, actor.id, at, correction.note ?? null);

    recordAudit(db, {
      actor, action: 'intake_answer_corrected', entity: 'intake', entityId: intakeId,
      details: { question_key: correction.questionKey, marked_wrong: correction.markedWrong === true },
    });
  });
  write();
  return id;
}

/**
 * The doctor accepting the history as his own.
 *
 * Before this, the Recall Card shows the intake behind a label saying
 * it is a report from the front desk and not verified. After it, it is
 * part of the record, with his name and the time on it.
 */
export function confirmIntake(db: Db, intakeId: string, actor: Actor, at: string = nowIso()): void {
  requireDoctor(actor, 'confirm the history');

  const intake = db.prepare(
    'SELECT visit_id AS visitId, started_at AS startedAt, doctor_confirmed_at AS confirmedAt FROM intake WHERE id = ? AND deleted_at IS NULL',
  ).get(intakeId) as { visitId: string; startedAt: string; confirmedAt: string | null } | undefined;
  if (intake === undefined) {
    throw new ConfirmRefusedError('That intake no longer exists.', 'Reopen the patient and try again.');
  }
  // Confirming twice is not an error, but the first confirmation is the
  // one that counts and its time is never moved.
  if (intake.confirmedAt !== null) return;

  const write = db.transaction(() => {
    db.prepare('UPDATE intake SET doctor_confirmed_by = ?, doctor_confirmed_at = ?, updated_at = ? WHERE id = ?')
      .run(actor.id, at, at, intakeId);
    recordAudit(db, {
      actor, action: 'intake_confirmed', entity: 'intake', entityId: intakeId,
      details: { visit_id: intake.visitId },
    });
  });
  write();

  recordUsage(db, { eventType: 'intake_confirmed', actorId: actor.id, visitId: intake.visitId, timestamp: at });
}

/**
 * Undoing a confirmation.
 *
 * A doctor who confirms the wrong patient's history needs a way back,
 * and the way back is another recorded event rather than an erasure:
 * the confirmation is cleared and the audit log keeps both.
 */
export function unconfirmIntake(db: Db, intakeId: string, actor: Actor, at: string = nowIso()): void {
  requireDoctor(actor, 'undo a confirmation');
  const intake = db.prepare('SELECT doctor_confirmed_at AS confirmedAt FROM intake WHERE id = ? AND deleted_at IS NULL')
    .get(intakeId) as { confirmedAt: string | null } | undefined;
  if (intake === undefined || intake.confirmedAt === null) return;

  const write = db.transaction(() => {
    db.prepare('UPDATE intake SET doctor_confirmed_by = NULL, doctor_confirmed_at = NULL, updated_at = ? WHERE id = ?')
      .run(at, intakeId);
    recordAudit(db, {
      actor, action: 'intake_confirmation_undone', entity: 'intake', entityId: intakeId,
      details: { was_confirmed_at: intake.confirmedAt },
    });
  });
  write();
}

export interface AppliedCorrection {
  questionKey: string;
  correctedValue: string | null;
  correctedFreeText: string | null;
  markedWrong: boolean;
  correctedByName: string | null;
  correctedAt: string;
  note: string | null;
}

/** The latest correction for each question, if any. */
export function correctionsFor(db: Db, intakeId: string): AppliedCorrection[] {
  return db.prepare(
    `SELECT c.question_key AS questionKey, c.corrected_value AS correctedValue,
            c.corrected_free_text AS correctedFreeText, c.marked_wrong AS markedWrong,
            u.display_name AS correctedByName, c.corrected_at AS correctedAt, c.note
     FROM intake_correction c
     LEFT JOIN app_user u ON u.id = c.corrected_by
     WHERE c.intake_id = ?
       -- The newest correction for each question, and exactly one of
       -- them. Picking by timestamp alone returns two rows when a
       -- question is corrected twice inside the same millisecond,
       -- which would show the doctor his own correction twice.
       AND c.rowid = (SELECT c2.rowid FROM intake_correction c2
                        WHERE c2.intake_id = c.intake_id AND c2.question_key = c.question_key
                        ORDER BY c2.corrected_at DESC, c2.rowid DESC LIMIT 1)
     ORDER BY c.question_key`,
  ).all(intakeId).map((row) => {
    const r = row as Record<string, unknown>;
    return {
      questionKey: String(r.questionKey),
      correctedValue: r.correctedValue as string | null,
      correctedFreeText: r.correctedFreeText as string | null,
      markedWrong: r.markedWrong === 1,
      correctedByName: r.correctedByName as string | null,
      correctedAt: String(r.correctedAt),
      note: r.note as string | null,
    };
  });
}
