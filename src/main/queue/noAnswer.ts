// ===================================================================
// The number was called and nobody came.
// ===================================================================
// The tablet puts the next serial across the whole screen, the
// assistant calls it out, and sometimes the waiting room does not
// answer. The desk has to be able to move on to the next person
// without waiting for anybody's permission.
//
// WHAT THIS DOES NOT DO, AND WHY THAT MATTERS MORE THAN WHAT IT DOES
//
// It does not change the visit. Not its status, not its position in the
// queue, not its serial number. The patient is still waiting, still in
// the same place on the doctor's list, still going to be seen.
//
// "Nobody answered when I called" is not the same fact as "they have
// gone home", and only a person can turn the first into the second.
// The laptop has a button for that and it belongs to the doctor. This
// system moves people up the queue and never down it, and a desk that
// could quietly drop somebody for being in the toilet would be moving
// them down it by another name.
//
// So all that happens is a row: this number was called at this time by
// this person, and nobody came. Never deleted, like everything else.
//
// WHAT IT IS FOR
//
// Two things. The tablet shows whoever has been called the FEWEST
// times, so the desk walks down the room rather than shouting the same
// number at an empty chair -- and comes back round to them, because
// somebody who was outside on the phone is usually back two minutes
// later.
//
// And the doctor can see it. "Called twice, no answer" beside serial 7
// tells him something that a status of 'waiting' never could. What he
// does about it is his decision, made with that in front of him.
import { ChamberRecallError } from '../../shared/errors';
import { recordAudit, type Actor } from '../db/audit';
import { nowIso } from '../db/clock';
import { newId } from '../db/ids';
import type { Db } from '../db/open';

export class NoAnswerError extends ChamberRecallError {}

export interface NoAnswerReport {
  /** Made up by the tablet. The same one twice is the same call. */
  deskRef: string;
  visitId: string;
  /**
   * The assistant who called the number out -- not whoever is signed in
   * by the time this reaches the laptop.
   */
  calledBy: string;
  /** When it was called out, not when this arrived. */
  calledAt: string;
}

export interface NoAnswerRecorded {
  /** How many times this number has now been called with no answer. */
  times: number;
  /** True when this exact report had already been received. */
  alreadyHad: boolean;
}

export function recordNoAnswer(db: Db, report: NoAnswerReport): NoAnswerRecorded {
  const already = db.prepare(
    'SELECT visit_id AS visitId FROM call_no_answer WHERE desk_ref = ?',
  ).get(report.deskRef) as { visitId: string } | undefined;
  if (already !== undefined) {
    return { times: timesCalled(db, already.visitId), alreadyHad: true };
  }

  const visit = db.prepare(
    `SELECT id, status FROM visit WHERE id = ? AND deleted_at IS NULL`,
  ).get(report.visitId) as { id: string; status: string } | undefined;
  if (visit === undefined) {
    throw new NoAnswerError(
      'That patient is not on today\'s list.',
      'The list may have been changed on the laptop. Look at it and call the next number from there.',
    );
  }

  // Whoever called it out has to be somebody. A record of a person
  // doing something without the person is not a record.
  const caller = db.prepare(
    `SELECT id, role FROM app_user WHERE id = ? AND deleted_at IS NULL`,
  ).get(report.calledBy) as { id: string; role: string } | undefined;
  if (caller === undefined) {
    throw new NoAnswerError(
      'That name is not in this installation.',
      'Sign in on the tablet again so this is recorded against somebody.',
    );
  }

  const at = nowIso();
  const write = db.transaction(() => {
    db.prepare(
      `INSERT INTO call_no_answer (id, visit_id, desk_ref, called_at, called_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(newId(), report.visitId, report.deskRef, report.calledAt, report.calledBy, at);
    recordAudit(db, {
      actor: { id: caller.id, role: caller.role } as Actor,
      action: 'called_no_answer', entity: 'visit', entityId: report.visitId,
      // Written down so that what did NOT happen is as legible as what
      // did: the visit came out of this untouched.
      details: { called_at: report.calledAt, status_unchanged: visit.status },
    });
  });
  write();

  return { times: timesCalled(db, report.visitId), alreadyHad: false };
}

export function timesCalled(db: Db, visitId: string): number {
  return (db.prepare(
    'SELECT count(*) AS n FROM call_no_answer WHERE visit_id = ?',
  ).get(visitId) as { n: number }).n;
}

/** For one chamber's list today, so the doctor's screen can say so. */
export function noAnswerCounts(db: Db, chamberId: string, visitDate: string): Map<string, number> {
  const rows = db.prepare(
    `SELECT c.visit_id AS visitId, count(*) AS n
       FROM call_no_answer c
       JOIN visit v ON v.id = c.visit_id
      WHERE v.chamber_id = ? AND v.visit_date = ? AND v.deleted_at IS NULL
      GROUP BY c.visit_id`,
  ).all(chamberId, visitDate) as Array<{ visitId: string; n: number }>;
  return new Map(rows.map((r) => [r.visitId, r.n]));
}
