// ===================================================================
// Who is actually walking in next.
// ===================================================================
// "The first person waiting" is the right answer right up until the
// desk calls a number and nobody stands up. After that it is wrong on
// both screens at once, and wrong in the worst way: the doctor sits
// waiting for serial 1 while the desk is already walking serial 2 in.
//
// So there is ONE rule, in ONE place, and both screens read it:
//
//   A patient a rule flagged comes before one it did not. Then
//   whoever has been called the FEWEST times with no answer. Then
//   whoever is furthest up the queue.
//
// THE FLAG COMES FIRST, AND IT IS NOT NEGOTIABLE
//
// The doctor's list already sorts flagged patients above unflagged
// ones and says there is no control anywhere that reverses it. The
// first version of this rule sorted only by calls and position, which
// quietly did reverse it: the desk would call serial 9 across the
// waiting room while three SEE SOONER patients sat there. That is the
// one thing this whole program is built not to do, and it did it in
// the one place nobody was looking -- the order a number is shouted
// in. So the flag is the outer key here, exactly as it is on the
// doctor's list, and the two orderings agree all the way down.
//
// The desk's tablet uses it to decide whose number to put on the
// screen. The doctor's list uses it to say, at the top, who is coming
// in. They cannot disagree, because there is nothing to disagree with.
//
// WHAT THIS IS NOT
//
// It is not an ordering of the queue. Nobody's serial changes, nobody's
// queue_position changes, nobody is moved down and nobody is dropped.
// Serial 1 is still waiting, still in the same place, still going to be
// seen -- the doctor can call them in at any moment and the list is
// unchanged underneath. This only answers "who next", and it answers it
// the same way for everybody looking.
import type { Db } from '../db/open';
import { noAnswerCounts } from './noAnswer';

export interface UpNext {
  visitId: string;
  serialNo: number;
  nameBn: string | null;
  nameEn: string | null;
  /** Times this number has been called with nobody coming. */
  noAnswer: number;
  /** Nobody else is waiting, so there is nobody to move on to. */
  onlyOneWaiting: boolean;
  /** A rule flagged this patient. The desk is calling them first. */
  flagged: boolean;
  /**
   * Every waiting patient a rule flagged has been called without an
   * answer. The desk cannot move past them -- a flagged patient is
   * never called after an unflagged one -- so this is a person's
   * problem, not the tablet's, and the tablet says so instead of
   * quietly dropping the flag.
   */
  allFlaggedUnanswered: boolean;
}

export interface WaitingRow {
  visitId: string;
  serialNo: number;
  pos: number;
  nameBn: string | null;
  nameEn: string | null;
  /** A screening rule fired on this patient. Never optional: a row
   *  that forgot to say would be treated as unflagged, which is the
   *  failure this rule exists to prevent. */
  flagged: boolean;
}

/** The rule itself, over rows somebody has already read. */
export function pickUpNext(
  waiting: WaitingRow[], calls: Map<string, number>,
): UpNext | null {
  const rank = (r: WaitingRow) => (r.flagged ? 0 : 1);
  const chosen = [...waiting].sort((a, b) => {
    // The escalation, first and above everything else.
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    const byCalls = (calls.get(a.visitId) ?? 0) - (calls.get(b.visitId) ?? 0);
    return byCalls !== 0 ? byCalls : a.pos - b.pos;
  })[0];
  if (chosen === undefined) return null;
  const flaggedWaiting = waiting.filter((r) => r.flagged);
  return {
    visitId: chosen.visitId,
    serialNo: chosen.serialNo,
    nameBn: chosen.nameBn,
    nameEn: chosen.nameEn,
    noAnswer: calls.get(chosen.visitId) ?? 0,
    onlyOneWaiting: waiting.length === 1,
    flagged: chosen.flagged,
    allFlaggedUnanswered: flaggedWaiting.length > 0
      && flaggedWaiting.every((r) => (calls.get(r.visitId) ?? 0) > 0),
  };
}

/** The same rule, reading the chamber's day for itself. */
export function upNextInChamber(db: Db, chamberId: string, visitDate: string): UpNext | null {
  const waiting = (db.prepare(
    `SELECT v.id AS visitId, v.serial_no AS serialNo,
            COALESCE(v.queue_position, v.serial_no) AS pos,
            p.full_name_bn AS nameBn, p.full_name_en AS nameEn,
            EXISTS (SELECT 1 FROM intake i
                      JOIN red_flag_event e ON e.intake_id = i.id
                     WHERE i.visit_id = v.id) AS flaggedInt
       FROM visit v JOIN patient p ON p.id = v.patient_id
      WHERE v.chamber_id = ? AND v.visit_date = ? AND v.deleted_at IS NULL
        AND v.status = 'waiting'`,
  ).all(chamberId, visitDate) as Array<Omit<WaitingRow, 'flagged'> & { flaggedInt: number }>)
    .map((r) => ({ ...r, flagged: r.flaggedInt === 1 }));
  return pickUpNext(waiting, noAnswerCounts(db, chamberId, visitDate));
}
