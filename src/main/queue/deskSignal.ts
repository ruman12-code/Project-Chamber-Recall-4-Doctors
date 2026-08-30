// ===================================================================
// What the front desk needs to know, right now, in a few bytes.
// ===================================================================
// The doctor finishes with a patient and the next one has to be walked
// in. Until now the desk found that out by looking at the tablet's
// list, which refreshes every twenty seconds -- an age with a room full
// of people, and no use at all if nobody happens to be looking.
//
// So this: the smallest possible answer to "has anything changed",
// cheap enough for the tablet to ask every few seconds over the
// chamber's own wifi.
//
// OUT OF TURN, WORKED OUT RATHER THAN RECORDED
//
// A patient is being seen out of turn when somebody who was AHEAD of
// them is still waiting. That is computed here from queue_position
// rather than stored, which means it stays true if the doctor reorders
// the list afterwards.
//
// It deliberately uses queue_position and not the serial number. A
// patient moved up by a red flag rule has a low position and a high
// serial, and calling them first is the system working exactly as it
// should -- not something to announce as irregular.
//
// WHO IS NEXT, WHEN SOMEBODY DID NOT ANSWER
//
// The desk calls a number and nobody stands up. Nothing about that
// patient changes -- see src/main/queue/noAnswer.ts for why that is the
// whole point -- so they are still waiting, still in the same place,
// and asking for "the first person waiting" would hand the desk the
// same empty chair for the rest of the evening.
//
// The rule itself lives in src/main/queue/upNext.ts and the DOCTOR's
// list reads the very same function. That is deliberate: the one thing
// worse than the desk calling the wrong number is the desk and the
// doctor each being told a different number.
import type { Db } from '../db/open';
import { noAnswerCounts, bypassedVisits } from './noAnswer';
import { pickUpNext } from './upNext';

export interface DeskSignal {
  /** Who is with the doctor now. Null between patients. */
  inChamber: {
    visitId: string;
    serialNo: number;
    nameBn: string | null;
    nameEn: string | null;
    /** Somebody ahead of them is still waiting. */
    outOfTurn: boolean;
  } | null;
  /** Who the desk should have ready next. */
  nextWaiting: {
    visitId: string; serialNo: number; nameBn: string | null; nameEn: string | null;
    /** How many times this number has been called with nobody coming.
     *  Zero the first time, which is nearly always. */
    noAnswer: number;
    /** Nobody else is waiting, so calling this number again is the only
     *  thing left to do. The tablet has to say that rather than look
     *  like it ignored the tap. */
    onlyOneWaiting: boolean;
  } | null;
  waiting: number;
  /**
   * A patient this desk has sent in, whom nobody at the chamber has
   * answered about yet.
   *
   * The desk has already walked them to the door. Until the doctor
   * accepts, that patient is still 'waiting', which means "who is
   * next" still points at them -- and without this the tablet would
   * put their number across the screen again and the assistant would
   * call out somebody standing in the doorway. So while this is set,
   * the tablet says nothing and shows the list.
   *
   * It clears the moment the question is answered, either way. If the
   * doctor says "not now", the patient goes back into the calling
   * order and their number comes up again, which is exactly right.
   */
  handoffPendingVisitId: string | null;
  /** Changes whenever anything above changes, so the tablet can tell a
   *  new call from the same one it has already announced. */
  at: string;
}

export function deskSignal(db: Db, chamberId: string, visitDate: string): DeskSignal {
  const rows = db.prepare(
    `SELECT v.id AS visitId, v.serial_no AS serialNo, v.status,
            COALESCE(v.queue_position, v.serial_no) AS pos,
            p.full_name_bn AS nameBn, p.full_name_en AS nameEn,
            EXISTS (SELECT 1 FROM intake i
                      JOIN red_flag_event e ON e.intake_id = i.id
                     WHERE i.visit_id = v.id) AS flaggedInt
       FROM visit v JOIN patient p ON p.id = v.patient_id
      WHERE v.chamber_id = ? AND v.visit_date = ? AND v.deleted_at IS NULL
      ORDER BY pos`,
  ).all(chamberId, visitDate) as Array<{
    visitId: string; serialNo: number; status: string; pos: number;
    nameBn: string | null; nameEn: string | null; flaggedInt: number;
  }>;

  const bypassed = bypassedVisits(db, chamberId, visitDate);
  const waiting = rows.filter((r) => r.status === 'waiting')
    .map((r) => ({ ...r, flagged: r.flaggedInt === 1, bypassed: bypassed.has(r.visitId) }));
  const called = rows.find((r) => r.status === 'in_chamber') ?? null;

  // The shared rule -- see upNext.ts. Nobody is moved and nothing is
  // skipped: this is only which of the people already waiting the desk
  // should shout for next, and the doctor's screen is told the same.
  const noAnswer = noAnswerCounts(db, chamberId, visitDate);
  const upNext = pickUpNext(waiting, noAnswer);

  // Sent in from the desk, not yet answered at the chamber. Only for
  // somebody still waiting: once they are in the room the answer has
  // been given, and once they have gone home there is nothing to ask.
  const pending = db.prepare(
    `SELECT h.visit_id AS visitId
       FROM desk_handoff h JOIN visit v ON v.id = h.visit_id
      WHERE h.decision IS NULL
        AND v.chamber_id = ? AND v.visit_date = ?
        AND v.deleted_at IS NULL AND v.status = 'waiting'
      ORDER BY h.sent_at DESC LIMIT 1`,
  ).get(chamberId, visitDate) as { visitId: string } | undefined;

  return {
    inChamber: called === null ? null : {
      visitId: called.visitId,
      serialNo: called.serialNo,
      nameBn: called.nameBn,
      nameEn: called.nameEn,
      outOfTurn: waiting.some((w) => w.pos < called.pos),
    },
    nextWaiting: upNext,
    waiting: waiting.length,
    handoffPendingVisitId: pending?.visitId ?? null,
    // Not a clock reading: a fingerprint of the answer. Two identical
    // situations give the same string, so the tablet announces a change
    // rather than announcing every few seconds.
    at: [
      called?.visitId ?? 'none',
      called === null ? '' : String(waiting.some((w) => w.pos < called.pos)),
      upNext?.visitId ?? 'none',
      // A second unanswered call on the same person IS news -- it is
      // what moves the screen on -- so the count is part of the
      // fingerprint even though the name has not changed.
      String(upNext?.noAnswer ?? 0),
      // Answered or not is news in its own right: it is what turns the
      // tablet's silence back into a number on the screen.
      pending?.visitId ?? 'none',
    ].join('|'),
  };
}
