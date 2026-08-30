// ===================================================================
// The desk hands the patient over to the chamber.
// ===================================================================
// The corridor between the waiting room and the chamber is the one
// part of the evening neither screen can see. The desk knows the
// patient stood up and walked in; the laptop knows nothing until the
// doctor presses something. So the desk says it, and the chamber
// answers.
//
// IT IS A REQUEST, NOT A STATUS CHANGE
//
// This never puts a patient in front of the doctor by itself. It
// records that somebody at the desk sent them, and the person at the
// chamber accepts or declines it. Accepting is what makes the visit
// in_chamber. Declining leaves the patient exactly where they were --
// waiting, same serial, same place.
//
// That division is deliberate. The desk is in another room. If a tap
// out there could change what is on the doctor's screen mid-sentence,
// then a mis-tap out there could too, and the doctor would be looking
// at the wrong patient's history without having done anything.
//
// TWO WAYS IN, ONE MECHANISM
//
// 'ordinary' is the desk working down the calling order: the tablet
// showed the serial card, the assistant called it, the patient walked
// in.
//
// 'priority' is a person at the desk deciding this patient goes in
// NOW -- somebody who has come in badly, or whose screening raised a
// warning. It is a human judgement and it is marked as one, so the
// doctor sees which kind of hand-off he is accepting.
//
// Both are the same row and the same answer. What differs is what the
// doctor is told before he answers.
import { ChamberRecallError } from '../../shared/errors';
import { recordAudit, type Actor } from '../db/audit';
import { nowIso } from '../db/clock';
import { newId } from '../db/ids';
import type { Db } from '../db/open';
import { setVisitStatus } from './register';

export class HandoffError extends ChamberRecallError {}

export type HandoffReason = 'ordinary' | 'priority';

export interface HandoffReport {
  /** Made up by the tablet. The same one twice is the same hand-off. */
  deskRef: string;
  visitId: string;
  /** The assistant who actually sent the patient in. */
  sentBy: string;
  /** When they were sent, not when this arrived at the laptop. */
  sentAt: string;
  reason?: HandoffReason;
}

export interface OpenHandoff {
  id: string;
  visitId: string;
  serialNo: number;
  nameBn: string | null;
  nameEn: string | null;
  reason: HandoffReason;
  sentAt: string;
  sentByName: string;
  /** A screening rule fired on this patient. */
  flagged: boolean;
  /** Somebody is already with the doctor, so this one cannot go in yet. */
  roomBusy: boolean;
}

/** The desk says a patient has been sent in. Nothing changes yet. */
export function recordHandoff(db: Db, report: HandoffReport): { id: string; alreadyHad: boolean } {
  const already = db.prepare(
    'SELECT id FROM desk_handoff WHERE desk_ref = ?',
  ).get(report.deskRef) as { id: string } | undefined;
  if (already !== undefined) return { id: already.id, alreadyHad: true };

  const visit = db.prepare(
    'SELECT id, status FROM visit WHERE id = ? AND deleted_at IS NULL',
  ).get(report.visitId) as { id: string; status: string } | undefined;
  if (visit === undefined) {
    throw new HandoffError(
      'That patient is not on today’s list.',
      'Look at the list again. Nothing was sent to the doctor.',
    );
  }

  // Whoever sent them has to be somebody. A record of a person doing
  // something without the person is not a record.
  const desk = db.prepare(
    'SELECT id, role FROM app_user WHERE id = ? AND deleted_at IS NULL',
  ).get(report.sentBy) as { id: string; role: string } | undefined;
  if (desk === undefined) {
    throw new HandoffError(
      'That name is not in this installation.',
      'Sign in on the tablet again so this is recorded against somebody.',
    );
  }

  const id = newId();
  const at = nowIso();
  const reason: HandoffReason = report.reason === 'priority' ? 'priority' : 'ordinary';
  db.transaction(() => {
    db.prepare(
      `INSERT INTO desk_handoff (id, visit_id, desk_ref, reason, sent_at, sent_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, report.visitId, report.deskRef, reason, report.sentAt, report.sentBy, at);
    recordAudit(db, {
      actor: { id: desk.id, role: desk.role } as Actor,
      action: 'desk_sent_patient_in', entity: 'visit', entityId: report.visitId,
      // What did NOT happen, written down as plainly as what did.
      details: { reason, sent_at: report.sentAt, status_unchanged: visit.status },
    });
  })();
  return { id, alreadyHad: false };
}

/**
 * What the chamber has not answered yet, oldest first.
 *
 * A hand-off for a patient who is no longer waiting is not shown: the
 * doctor called them in himself in the meantime, or they were marked
 * as having left. There is nothing left to accept, and a popup asking
 * about it would be a puzzle rather than a question.
 */
export function openHandoffs(db: Db, chamberId: string, visitDate: string): OpenHandoff[] {
  const busy = db.prepare(
    `SELECT count(*) AS n FROM visit
      WHERE chamber_id = ? AND visit_date = ? AND deleted_at IS NULL AND status = 'in_chamber'`,
  ).get(chamberId, visitDate) as { n: number };
  return (db.prepare(
    `SELECT h.id, h.visit_id AS visitId, v.serial_no AS serialNo,
            p.full_name_bn AS nameBn, p.full_name_en AS nameEn,
            h.reason, h.sent_at AS sentAt,
            COALESCE(u.display_name, '') AS sentByName,
            EXISTS (SELECT 1 FROM intake i
                      JOIN red_flag_event e ON e.intake_id = i.id
                     WHERE i.visit_id = v.id) AS flaggedInt
       FROM desk_handoff h
       JOIN visit v ON v.id = h.visit_id
       JOIN patient p ON p.id = v.patient_id
       LEFT JOIN app_user u ON u.id = h.sent_by
      WHERE h.decision IS NULL
        AND v.chamber_id = ? AND v.visit_date = ?
        AND v.deleted_at IS NULL AND v.status = 'waiting'
      ORDER BY h.sent_at`,
  ).all(chamberId, visitDate) as Array<Omit<OpenHandoff, 'flagged' | 'roomBusy'>
    & { flaggedInt: number }>)
    .map(({ flaggedInt, ...row }) => ({
      ...row,
      reason: row.reason === 'priority' ? 'priority' as const : 'ordinary' as const,
      flagged: flaggedInt === 1,
      roomBusy: busy.n > 0,
    }));
}

/**
 * The chamber answers.
 *
 * Accepting is the ONLY thing in this file that changes a visit, and
 * it changes it through setVisitStatus like every other status change,
 * so the same rules and the same audit trail apply. Declining changes
 * nothing at all -- it only closes the question, so the doctor is not
 * asked it again every three seconds.
 */
export function answerHandoff(
  db: Db, handoffId: string, decision: 'accepted' | 'declined', actor: Actor,
): { visitId: string } {
  const row = db.prepare(
    'SELECT id, visit_id AS visitId, decision FROM desk_handoff WHERE id = ?',
  ).get(handoffId) as { id: string; visitId: string; decision: string | null } | undefined;
  if (row === undefined) {
    throw new HandoffError(
      'That message from the front desk is not here any more.',
      'Look at today’s list and call the patient in from there.',
    );
  }
  if (row.decision !== null) {
    // Answered already -- by the other person at this laptop, or by a
    // second press. Not an error worth stopping for.
    return { visitId: row.visitId };
  }

  const at = nowIso();
  db.transaction(() => {
    db.prepare(
      'UPDATE desk_handoff SET decision = ?, decided_at = ?, decided_by = ? WHERE id = ?',
    ).run(decision, at, actor.id, handoffId);
    recordAudit(db, {
      actor, action: `desk_handoff_${decision}`, entity: 'visit', entityId: row.visitId,
      details: { handoff_id: handoffId },
    });
    if (decision === 'accepted') setVisitStatus(db, row.visitId, 'in_chamber', actor);
  })();
  return { visitId: row.visitId };
}
