// ===================================================================
// The serial register.
// ===================================================================
// This replaces a paper book, and it has to be better than the book at
// the book's own job before any of the rest of this software matters.
// The two things the book does well are: give the next number, and
// never give the same number twice. Both are guaranteed here - the
// second by the database itself, not by this code being careful.
import type { Db } from '../db/open';
import { newId } from '../db/ids';
import { nowIso, localDate } from '../db/clock';
import type { VisitKind } from '../../shared/queue';
import { recordAudit, type Actor } from '../db/audit';
import { recordUsage } from '../db/usage';
import { resolveToSurvivingPatient } from '../patients/search';
import { ChamberRecallError } from '../../shared/errors';

export class RegisterRefusedError extends ChamberRecallError {}

export type VisitStatus = 'waiting' | 'in_chamber' | 'done' | 'left';

export interface ArrivalResult {
  visitId: string;
  serialNo: number;
  /** Set when this patient is already on today's list. */
  alreadyOnListVisitId: string | null;
}

/**
 * Puts an arriving patient on today's list and gives them the next
 * number.
 *
 * If the patient was picked from a record that has been merged into
 * another, the visit is attached to the record actually in use - the
 * merged one is only an alias for it.
 */
export function registerArrival(
  db: Db, patientId: string, chamberId: string, actor: Actor,
  options: {
    visitDate?: string; arrivedAt?: string; allowSecondVisitToday?: boolean;
    /** 'reports_only' when they have come to show the doctor a test he
     *  asked for last time. It changes what the desk asks them and
     *  nothing else: not their place in the queue, not the rules. */
    visitKind?: VisitKind;
  } = {},
): ArrivalResult {
  const visitDate = options.visitDate ?? localDate();
  const arrivedAt = options.arrivedAt ?? nowIso();
  const realPatientId = resolveToSurvivingPatient(db, patientId);

  const patient = db.prepare('SELECT id FROM patient WHERE id = ? AND deleted_at IS NULL').get(realPatientId);
  if (patient === undefined) {
    throw new RegisterRefusedError('That patient record no longer exists.', 'Search for the patient again.');
  }
  const chamber = db.prepare('SELECT id FROM chamber WHERE id = ? AND deleted_at IS NULL').get(chamberId);
  if (chamber === undefined) {
    throw new RegisterRefusedError('That chamber no longer exists.', 'Choose a chamber at the top of the list.');
  }

  // Somebody arriving twice in one evening is nearly always the
  // assistant adding them a second time by mistake. It is not
  // impossible though, so this reports it rather than refusing, and
  // the screen asks.
  const existing = db.prepare(
    `SELECT id FROM visit WHERE patient_id = ? AND chamber_id = ? AND visit_date = ?
       AND deleted_at IS NULL AND status != 'left'`,
  ).get(realPatientId, chamberId, visitDate) as { id: string } | undefined;

  if (existing !== undefined && options.allowSecondVisitToday !== true) {
    return { visitId: existing.id, serialNo: 0, alreadyOnListVisitId: existing.id };
  }

  const write = db.transaction((): ArrivalResult => {
    const next = (db.prepare(
      'SELECT COALESCE(max(serial_no), 0) + 1 AS n FROM visit WHERE chamber_id = ? AND visit_date = ?',
    ).get(chamberId, visitDate) as { n: number }).n;

    const id = newId();
    db.prepare(
      `INSERT INTO visit (id, patient_id, chamber_id, visit_date, serial_no, queue_position,
         arrived_at, status, created_at, created_by, updated_at, visit_kind)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'waiting', ?, ?, ?, ?)`,
    ).run(id, realPatientId, chamberId, visitDate, next, next, arrivedAt, arrivedAt, actor.id, arrivedAt,
      options.visitKind ?? 'consultation');

    recordAudit(db, {
      actor, action: 'visit_registered', entity: 'visit', entityId: id,
      details: {
        patient_id: realPatientId, chamber_id: chamberId, visit_date: visitDate, serial_no: next,
        visit_kind: options.visitKind ?? 'consultation',
      },
    });
    return { visitId: id, serialNo: next, alreadyOnListVisitId: null };
  });

  const result = write();
  recordUsage(db, { eventType: 'visit_registered', actorId: actor.id, visitId: result.visitId, timestamp: arrivedAt });
  return result;
}

const ALLOWED_MOVES: Record<VisitStatus, VisitStatus[]> = {
  waiting: ['in_chamber', 'left'],
  in_chamber: ['done', 'waiting'],
  done: ['in_chamber'],
  left: ['waiting'],
};

/**
 * Moves a patient between waiting, in the chamber, seen and left.
 *
 * Every move can be undone, because the commonest mistake at a busy
 * desk is tapping the wrong row. Nothing here deletes anything: "left"
 * is a status, not a removal, and their serial stays used.
 */
export function setVisitStatus(db: Db, visitId: string, next: VisitStatus, actor: Actor, at: string = nowIso()): void {
  const visit = db.prepare('SELECT status, seen_at FROM visit WHERE id = ? AND deleted_at IS NULL').get(visitId) as
    { status: VisitStatus; seen_at: string | null } | undefined;
  if (visit === undefined) throw new RegisterRefusedError('That visit is no longer on the list.', 'Refresh the list and try again.');
  if (visit.status === next) return;

  if (!ALLOWED_MOVES[visit.status].includes(next)) {
    throw new RegisterRefusedError(
      `A patient cannot go from "${visit.status}" straight to "${next}".`,
      'Move them one step at a time so the record stays sensible.',
    );
  }

  // seen_at is stamped the first time they go in and never rewritten.
  // It is the answer to "how long did this person wait", and a second
  // trip into the chamber must not erase the first one's timing.
  const stampSeen = next === 'in_chamber' && visit.seen_at === null;

  // Marking somebody as having left is the ONE path that takes a
  // flagged patient out of the queue without the doctor seeing them.
  // The system cannot stop a patient walking out, so this is allowed -
  // but it is never allowed to be quiet. It is recorded as its own
  // action so that "a flagged patient went home unseen" can be found
  // later without reading every status change in the log.
  const flags = (db.prepare(
    `SELECT count(*) AS n FROM red_flag_event e JOIN intake i ON i.id = e.intake_id WHERE i.visit_id = ?`,
  ).get(visitId) as { n: number }).n;
  const leavingWithFlag = next === 'left' && flags > 0;

  const write = db.transaction(() => {
    db.prepare(`UPDATE visit SET status = ?, seen_at = COALESCE(?, seen_at), updated_at = ? WHERE id = ?`)
      .run(next, stampSeen ? at : null, at, visitId);
    recordAudit(db, {
      actor, action: 'visit_status_changed', entity: 'visit', entityId: visitId,
      details: { from: visit.status, to: next, red_flags: flags },
    });
    if (leavingWithFlag) {
      recordAudit(db, {
        actor, action: 'flagged_patient_left_unseen', entity: 'visit', entityId: visitId,
        details: { red_flags: flags, from: visit.status },
      });
    }
  });
  write();

  if (next === 'in_chamber') {
    recordUsage(db, { eventType: 'patient_called_in', actorId: actor.id, visitId, timestamp: at });
  } else if (next === 'done') {
    recordUsage(db, { eventType: 'visit_finished', actorId: actor.id, visitId, timestamp: at });
  }
}
