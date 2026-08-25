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
// So next is: the waiting patient called the FEWEST times with no
// answer, and among those, the one furthest up the queue. The desk
// walks down the room, everybody gets a second call before anybody
// gets a third, and somebody who was outside on the phone comes back
// round rather than being dropped.
import type { Db } from '../db/open';
import { noAnswerCounts } from './noAnswer';

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
  /** Changes whenever anything above changes, so the tablet can tell a
   *  new call from the same one it has already announced. */
  at: string;
}

export function deskSignal(db: Db, chamberId: string, visitDate: string): DeskSignal {
  const rows = db.prepare(
    `SELECT v.id AS visitId, v.serial_no AS serialNo, v.status,
            COALESCE(v.queue_position, v.serial_no) AS pos,
            p.full_name_bn AS nameBn, p.full_name_en AS nameEn
       FROM visit v JOIN patient p ON p.id = v.patient_id
      WHERE v.chamber_id = ? AND v.visit_date = ? AND v.deleted_at IS NULL
      ORDER BY pos`,
  ).all(chamberId, visitDate) as Array<{
    visitId: string; serialNo: number; status: string; pos: number;
    nameBn: string | null; nameEn: string | null;
  }>;

  const waiting = rows.filter((r) => r.status === 'waiting');
  const called = rows.find((r) => r.status === 'in_chamber') ?? null;

  // Fewest unanswered calls first, then queue order. Nobody is moved
  // and nothing is skipped: this is only which of the people already
  // waiting the desk should shout for next.
  const noAnswer = noAnswerCounts(db, chamberId, visitDate);
  const upNext = [...waiting].sort((a, b) => {
    const byCalls = (noAnswer.get(a.visitId) ?? 0) - (noAnswer.get(b.visitId) ?? 0);
    return byCalls !== 0 ? byCalls : a.pos - b.pos;
  })[0] ?? null;

  return {
    inChamber: called === null ? null : {
      visitId: called.visitId,
      serialNo: called.serialNo,
      nameBn: called.nameBn,
      nameEn: called.nameEn,
      outOfTurn: waiting.some((w) => w.pos < called.pos),
    },
    nextWaiting: upNext === null ? null : {
      visitId: upNext.visitId,
      serialNo: upNext.serialNo,
      nameBn: upNext.nameBn,
      nameEn: upNext.nameEn,
      noAnswer: noAnswer.get(upNext.visitId) ?? 0,
      onlyOneWaiting: waiting.length === 1,
    },
    waiting: waiting.length,
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
      String(upNext === null ? 0 : noAnswer.get(upNext.visitId) ?? 0),
    ].join('|'),
  };
}
