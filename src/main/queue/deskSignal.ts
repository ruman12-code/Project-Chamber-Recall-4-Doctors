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
import type { Db } from '../db/open';

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
  nextWaiting: { visitId: string; serialNo: number; nameBn: string | null; nameEn: string | null } | null;
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

  return {
    inChamber: called === null ? null : {
      visitId: called.visitId,
      serialNo: called.serialNo,
      nameBn: called.nameBn,
      nameEn: called.nameEn,
      outOfTurn: waiting.some((w) => w.pos < called.pos),
    },
    nextWaiting: waiting.length === 0 ? null : {
      visitId: waiting[0]!.visitId,
      serialNo: waiting[0]!.serialNo,
      nameBn: waiting[0]!.nameBn,
      nameEn: waiting[0]!.nameEn,
    },
    waiting: waiting.length,
    // Not a clock reading: a fingerprint of the answer. Two identical
    // situations give the same string, so the tablet announces a change
    // rather than announcing every few seconds.
    at: [
      called?.visitId ?? 'none',
      called === null ? '' : String(waiting.some((w) => w.pos < called.pos)),
      waiting[0]?.visitId ?? 'none',
    ].join('|'),
  };
}
