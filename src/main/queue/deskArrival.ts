// ===================================================================
// An arrival that happened before the laptop heard about it.
// ===================================================================
// The front desk at Popular works for two hours with the laptop at
// Lubana. Patients arrive, are found or registered, and are given a
// serial number out loud. None of that has reached the database yet.
//
// When the doctor walks in and opens the laptop, all of it arrives at
// once, in the order it happened. This is what receives it.
//
// TWO THINGS MAKE THIS SAFE TO SEND TWICE
//
// Every arrival carries a deskRef the tablet made up, and every patient
// registered at the desk carries one too. Both are unique in the
// database. A message sent twice - because the reply was lost, or the
// wifi came back mid-send - finds the first one already there and
// returns it unchanged rather than making a second patient or a second
// place in the queue.
//
// THE SERIAL THE PATIENT WAS ALREADY TOLD
//
// The tablet gives out numbers from its own count for its own chamber,
// which is safe because exactly one tablet does that for one chamber.
// What is NOT impossible is the laptop giving out a number for the same
// chamber while the tablet was away - a walk-in added from the queue
// screen. So the number the desk announced can be taken by the time it
// arrives.
//
// When that happens the patient keeps their PLACE - they were here
// first and their arrival time proves it - and takes the next free
// number. The number they were told is written down beside it, and the
// laptop says so on today's list until somebody says they have told
// them. A patient who was called seven and is now twelve has to hear
// that from a person, not discover it when somebody else is called.
import { ChamberRecallError } from '../../shared/errors';
import { recordAudit, type Actor } from '../db/audit';
import { nowIso, sessionDate } from '../db/clock';
import { newId } from '../db/ids';
import { recordUsage } from '../db/usage';
import type { Db } from '../db/open';
import { registerPatient } from '../patients/register';
import { resolveToSurvivingPatient } from '../patients/search';
import type { RegisterPatientInput } from '../../shared/patients';
import type { VisitKind } from '../../shared/queue';

export class DeskArrivalError extends ChamberRecallError {}

export interface DeskArrival {
  /** Made up by the tablet. The same one twice means the same arrival. */
  deskRef: string;
  chamberId: string;
  /**
   * The assistant who was at the desk when this happened - not whoever
   * is signed in two hours later when it finally reaches the laptop.
   * A record carries the name of the person who made it, and that has
   * to survive the gap between the desk and the database.
   */
  takenBy: string;
  /** When the patient actually stood at the desk, not when this arrived. */
  arrivedAt: string;
  visitDate: string;
  /** The number said out loud at the desk. */
  serialAnnounced: number;
  /** One of these two. An existing patient, or somebody new. */
  patientId?: string | null;
  newPatient?: RegisterPatientInput & { deskRef: string };
  /** Why they came. Defaults to an ordinary consultation. */
  visitKind?: VisitKind;
}

export interface DeskArrivalResult {
  visitId: string;
  patientId: string;
  serialNo: number;
  /** Set only when the announced number could not be kept. */
  serialAnnounced: number | null;
  alreadyHad: boolean;
}

/** A patient registered at the desk, keyed so a repeat is harmless. */
function patientForArrival(db: Db, arrival: DeskArrival, actor: Actor): string {
  if (arrival.patientId !== undefined && arrival.patientId !== null && arrival.patientId !== '') {
    const real = resolveToSurvivingPatient(db, arrival.patientId);
    const exists = db.prepare('SELECT id FROM patient WHERE id = ? AND deleted_at IS NULL').get(real);
    if (exists === undefined) {
      throw new DeskArrivalError(
        'The desk gave a serial to a patient record that is no longer here.',
        'Find the patient on the laptop and add them to today\'s list by hand.',
      );
    }
    return real;
  }

  const fresh = arrival.newPatient;
  if (fresh === undefined) {
    throw new DeskArrivalError(
      'That arrival names no patient at all.',
      'Add the patient to today\'s list on the laptop by hand.',
    );
  }

  const already = db.prepare('SELECT id FROM patient WHERE desk_ref = ?').get(fresh.deskRef) as
    { id: string } | undefined;
  if (already !== undefined) return already.id;

  const id = registerPatient(db, fresh, actor);
  db.prepare('UPDATE patient SET desk_ref = ? WHERE id = ?').run(fresh.deskRef, id);
  return id;
}

/**
 * Take one arrival from the desk into the record.
 *
 * The whole thing is one transaction: either the patient, the visit and
 * the serial are all there, or none of them are and the tablet still
 * holds it to send again.
 */
export function receiveDeskArrival(db: Db, arrival: DeskArrival, receivedBy: Actor): DeskArrivalResult {
  const existing = db.prepare(
    `SELECT id, patient_id AS patientId, serial_no AS serialNo, serial_announced AS serialAnnounced
       FROM visit WHERE desk_ref = ?`,
  ).get(arrival.deskRef) as
    { id: string; patientId: string; serialNo: number; serialAnnounced: number | null } | undefined;
  if (existing !== undefined) {
    return {
      visitId: existing.id, patientId: existing.patientId, serialNo: existing.serialNo,
      serialAnnounced: existing.serialAnnounced, alreadyHad: true,
    };
  }

  // Attributed to the person who was standing at the desk. Falling back
  // to whoever is receiving it would put the doctor's name on a
  // registration he never made.
  const desk = db.prepare('SELECT id, role FROM app_user WHERE id = ? AND deleted_at IS NULL')
    .get(arrival.takenBy) as { id: string; role: string } | undefined;
  if (desk === undefined) {
    throw new DeskArrivalError(
      'That arrival names somebody who is not in this installation as having taken it.',
      'Add the patient to today\'s list on the laptop by hand, so that a real name is on the record.',
    );
  }
  const actor: Actor = { id: desk.id, role: desk.role as Actor['role'] };

  const chamber = db.prepare('SELECT id FROM chamber WHERE id = ? AND deleted_at IS NULL').get(arrival.chamberId);
  if (chamber === undefined) {
    throw new DeskArrivalError(
      'That arrival is for a chamber that is no longer in this installation.',
      'Add the patient to today\'s list on the laptop by hand.',
    );
  }

  const visitDate = arrival.visitDate || sessionDate();
  const arrivedAt = arrival.arrivedAt || nowIso();

  const write = db.transaction((): DeskArrivalResult => {
    const patientId = patientForArrival(db, arrival, actor);

    // The announced number if it is free; otherwise the next one, and
    // the announced one written down so somebody has to tell them.
    const taken = db.prepare(
      'SELECT id FROM visit WHERE chamber_id = ? AND visit_date = ? AND serial_no = ?',
    ).get(arrival.chamberId, visitDate, arrival.serialAnnounced) !== undefined;

    const serialNo = taken
      ? (db.prepare(
          'SELECT COALESCE(max(serial_no), 0) + 1 AS n FROM visit WHERE chamber_id = ? AND visit_date = ?',
        ).get(arrival.chamberId, visitDate) as { n: number }).n
      : arrival.serialAnnounced;

    const id = newId();
    db.prepare(
      `INSERT INTO visit (id, patient_id, chamber_id, visit_date, serial_no, queue_position,
         arrived_at, status, created_at, created_by, updated_at, desk_ref, serial_announced,
         visit_kind)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'waiting', ?, ?, ?, ?, ?, ?)`,
    ).run(id, patientId, arrival.chamberId, visitDate, serialNo, serialNo, arrivedAt,
      arrivedAt, actor.id, arrivedAt, arrival.deskRef,
      taken ? arrival.serialAnnounced : null,
      arrival.visitKind ?? 'consultation');

    recordAudit(db, {
      actor, action: 'visit_registered_at_desk', entity: 'visit', entityId: id,
      details: {
        patient_id: patientId, chamber_id: arrival.chamberId, visit_date: visitDate,
        serial_no: serialNo,
        serial_announced: taken ? arrival.serialAnnounced : null,
        arrived_at: arrivedAt,
        visit_kind: arrival.visitKind ?? 'consultation',
      },
    });
    return {
      visitId: id, patientId, serialNo,
      serialAnnounced: taken ? arrival.serialAnnounced : null, alreadyHad: false,
    };
  });

  const result = write();
  recordUsage(db, {
    eventType: 'visit_registered', actorId: actor.id, visitId: result.visitId, timestamp: arrivedAt,
  });
  return result;
}

export interface SerialClash {
  visitId: string;
  serialNo: number;
  serialAnnounced: number;
  nameBn: string | null;
  nameEn: string | null;
}

/** Patients who were told one number and given another, and have not
 *  yet been told again. Shown on today's list until acknowledged. */
export function unresolvedSerialClashes(db: Db, chamberId: string, visitDate: string): SerialClash[] {
  return db.prepare(
    `SELECT v.id AS visitId, v.serial_no AS serialNo, v.serial_announced AS serialAnnounced,
            p.full_name_bn AS nameBn, p.full_name_en AS nameEn
       FROM visit v JOIN patient p ON p.id = v.patient_id
      WHERE v.chamber_id = ? AND v.visit_date = ?
        AND v.serial_announced IS NOT NULL AND v.serial_clash_seen_at IS NULL
        AND v.deleted_at IS NULL
      ORDER BY v.serial_no`,
  ).all(chamberId, visitDate) as SerialClash[];
}

/** Somebody has told the patient their number changed. */
export function acknowledgeSerialClash(db: Db, visitId: string, actor: Actor): void {
  db.prepare('UPDATE visit SET serial_clash_seen_at = ? WHERE id = ?').run(nowIso(), visitId);
  recordAudit(db, {
    actor, action: 'serial_change_told_to_patient', entity: 'visit', entityId: visitId, details: null,
  });
}
