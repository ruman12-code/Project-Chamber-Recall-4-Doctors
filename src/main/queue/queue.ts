// ===================================================================
// The live queue.
// ===================================================================
// Who is waiting, who is with the doctor, who has been seen, and how
// long each of them has been here.
//
// ---------------------------------------------------------------------
// THE ONE CLINICAL ACTION THIS SOFTWARE TAKES
// ---------------------------------------------------------------------
// A patient whose intake fired a red flag sorts above the patients who
// did not, automatically, and cannot be pushed back below them.
//
// That is the whole of it. The system moves people UP and has no way to
// move anybody DOWN. The up and down controls swap neighbours within
// the same group, so an ordinary patient can be moved around among
// ordinary patients and a flagged patient among flagged patients, but
// no sequence of taps moves a flagged patient below an unflagged one.
// There is deliberately no override, no "dismiss", and no way to clear
// a flag from this screen.
//
// A patient does leave the flagged group - by being seen. Calling them
// in and finishing moves them out of the waiting list entirely, which
// is the correct and only way for the alert to stop mattering.
//
// The cost of this being wrong in one direction is a few minutes of
// somebody's evening. In the other direction it is somebody's life.
import type { Db } from '../db/open';
import { nowIso } from '../db/clock';
import { patientAgeYears } from '../db/age';
import { recordAudit, type Actor } from '../db/audit';
import { setMeta, getMeta } from '../db/open';
import { RegisterRefusedError, type VisitStatus } from './register';
import type { QueueEntry, QueueRedFlag, VisitKind } from '../../shared/queue';
import { noAnswerCounts, bypassedVisits } from './noAnswer';

export type { QueueEntry, QueueRedFlag } from '../../shared/queue';

const STATUS_ORDER: Record<VisitStatus, number> = { in_chamber: 0, waiting: 1, done: 2, left: 3 };

export function todaysQueue(db: Db, chamberId: string, visitDate: string, asOf: Date = new Date()): QueueEntry[] {
  const rows = db.prepare(
    `SELECT v.id AS visitId, v.serial_no AS serialNo, v.status, v.visit_kind AS visitKind,
            v.arrived_at AS arrivedAt, v.seen_at AS seenAt,
            v.queue_position AS queuePosition,
            p.id AS patientId, p.attending_since AS attendingSince, p.full_name_bn AS nameBn, p.full_name_en AS nameEn, p.phone, p.sex,
            p.dob, p.approx_age_years, p.approx_age_recorded_on,
            i.id AS intakeId, i.completed_at AS intakeCompletedAt,
            (SELECT count(*) FROM visit pv WHERE pv.patient_id = p.id AND pv.visit_date < v.visit_date
               AND pv.deleted_at IS NULL) AS previousVisits,
            (SELECT max(pv.visit_date) FROM visit pv WHERE pv.patient_id = p.id AND pv.visit_date < v.visit_date
               AND pv.deleted_at IS NULL) AS lastVisitDate
     FROM visit v
     JOIN patient p ON p.id = v.patient_id
     LEFT JOIN intake i ON i.visit_id = v.id AND i.deleted_at IS NULL
     WHERE v.chamber_id = ? AND v.visit_date = ? AND v.deleted_at IS NULL`,
  ).all(chamberId, visitDate) as Array<{
    visitId: string; serialNo: number; status: VisitStatus; visitKind: VisitKind;
    arrivedAt: string; seenAt: string | null;
    queuePosition: number | null; patientId: string; attendingSince: string | null;
    nameBn: string | null; nameEn: string | null;
    phone: string | null; sex: string | null; dob: string | null; approx_age_years: number | null;
    approx_age_recorded_on: string | null; intakeId: string | null; intakeCompletedAt: string | null;
    previousVisits: number; lastVisitDate: string | null;
  }>;

  const flagsByIntake = new Map<string, QueueRedFlag[]>();
  const screeningByIntake = new Map<string, { ran: boolean; incomplete: boolean }>();
  const intakeIds = rows.map((r) => r.intakeId).filter((id): id is string => id !== null);

  if (intakeIds.length > 0) {
    const placeholders = intakeIds.map(() => '?').join(',');
    for (const flag of db.prepare(
      `SELECT intake_id AS intakeId, rule_id AS ruleId, rule_version AS ruleVersion, acknowledged_at AS acknowledgedAt
       FROM red_flag_event WHERE intake_id IN (${placeholders}) ORDER BY fired_at`,
    ).all(...intakeIds) as Array<QueueRedFlag & { intakeId: string }>) {
      const list = flagsByIntake.get(flag.intakeId) ?? [];
      list.push({ ruleId: flag.ruleId, ruleVersion: flag.ruleVersion, acknowledgedAt: flag.acknowledgedAt });
      flagsByIntake.set(flag.intakeId, list);
    }
    for (const row of db.prepare(
      `SELECT intake_id AS intakeId, count(*) AS total,
              sum(CASE WHEN outcome = 'could_not_check' THEN 1 ELSE 0 END) AS blocked
       FROM red_flag_evaluation WHERE intake_id IN (${placeholders}) GROUP BY intake_id`,
    ).all(...intakeIds) as Array<{ intakeId: string; total: number; blocked: number }>) {
      screeningByIntake.set(row.intakeId, { ran: row.total > 0, incomplete: row.blocked > 0 });
    }
  }

  const noAnswer = noAnswerCounts(db, chamberId, visitDate);
  const bypassed = bypassedVisits(db, chamberId, visitDate);

  // Photographs of the paper the patient brought today. Counted so the
  // tablet stops pushing the camera at an assistant who has already
  // taken them, and so the doctor can see there is something to look at.
  const papers = new Map<string, number>(
    (db.prepare(
      `SELECT a.visit_id AS visitId, count(*) AS n
         FROM attachment a
         JOIN visit v ON v.id = a.visit_id
        WHERE v.chamber_id = ? AND v.visit_date = ? AND v.deleted_at IS NULL
          AND a.deleted_at IS NULL
        GROUP BY a.visit_id`,
    ).all(chamberId, visitDate) as Array<{ visitId: string; n: number }>)
      .map((r) => [r.visitId, r.n]),
  );

  const entries: QueueEntry[] = rows.map((row) => {
    const until = row.seenAt === null ? asOf.getTime() : new Date(row.seenAt).getTime();
    const screening = row.intakeId === null ? undefined : screeningByIntake.get(row.intakeId);
    return {
      visitId: row.visitId,
      serialNo: row.serialNo,
      status: row.status,
      visitKind: row.visitKind,
      patientId: row.patientId,
      nameBn: row.nameBn,
      nameEn: row.nameEn,
      ageYears: patientAgeYears(row, asOf),
      ageIsApproximate: row.dob === null,
      sex: row.sex,
      phone: row.phone,
      arrivedAt: row.arrivedAt,
      seenAt: row.seenAt,
      waitedMinutes: Math.max(0, Math.round((until - new Date(row.arrivedAt).getTime()) / 60000)),
      previousVisits: row.previousVisits,
      attendingSince: row.attendingSince,
      lastVisitDate: row.lastVisitDate,
      redFlags: row.intakeId === null ? [] : flagsByIntake.get(row.intakeId) ?? [],
      calledNoAnswer: noAnswer.get(row.visitId) ?? 0,
      passedOver: bypassed.has(row.visitId),
      attachmentCount: papers.get(row.visitId) ?? 0,
      intakeStarted: row.intakeId !== null,
      intakeCompleted: row.intakeCompletedAt !== null,
      screeningRan: screening?.ran ?? false,
      screeningIncomplete: screening?.incomplete ?? false,
    };
  });

  const positionOf = new Map(rows.map((r) => [r.visitId, r.queuePosition ?? r.serialNo]));

  return entries.sort((a, b) => {
    if (STATUS_ORDER[a.status] !== STATUS_ORDER[b.status]) return STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    // The escalation. Flagged patients sort above unflagged ones and
    // there is no control anywhere that reverses this.
    const flagged = (e: QueueEntry) => (e.redFlags.length > 0 ? 0 : 1);
    if (flagged(a) !== flagged(b)) return flagged(a) - flagged(b);
    const pa = positionOf.get(a.visitId) ?? a.serialNo;
    const pb = positionOf.get(b.visitId) ?? b.serialNo;
    if (pa !== pb) return pa - pb;
    return a.serialNo - b.serialNo;
  });
}

/**
 * Swaps a waiting patient with the neighbour above or below them.
 *
 * Refuses when that would put a patient carrying a red flag behind one
 * who is not. The refusal explains itself: an assistant who cannot see
 * why the button did nothing will assume the software is broken.
 */
export function moveInQueue(db: Db, visitId: string, direction: 'up' | 'down', actor: Actor): void {
  const visit = db.prepare('SELECT chamber_id AS chamberId, visit_date AS visitDate, status FROM visit WHERE id = ? AND deleted_at IS NULL')
    .get(visitId) as { chamberId: string; visitDate: string; status: VisitStatus } | undefined;
  if (visit === undefined) throw new RegisterRefusedError('That visit is no longer on the list.', 'Refresh the list and try again.');
  if (visit.status !== 'waiting') {
    throw new RegisterRefusedError(
      'Only patients who are still waiting can be moved.',
      'Someone already with the doctor, or already seen, keeps the place they had.',
    );
  }

  const waiting = todaysQueue(db, visit.chamberId, visit.visitDate).filter((e) => e.status === 'waiting');
  const index = waiting.findIndex((e) => e.visitId === visitId);
  if (index === -1) return;

  const targetIndex = direction === 'up' ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= waiting.length) return;

  const self = waiting[index]!;
  const other = waiting[targetIndex]!;

  if (self.redFlags.length === 0 && other.redFlags.length > 0) {
    throw new RegisterRefusedError(
      'This patient cannot be moved past one who needs to be seen sooner.',
      'A patient the questions flagged always stays ahead. Nobody can be moved behind them, including by mistake.',
    );
  }
  if (self.redFlags.length > 0 && other.redFlags.length === 0) {
    throw new RegisterRefusedError(
      'This patient already needs to be seen sooner and is kept ahead.',
      'They cannot be moved back down the list.',
    );
  }

  const reordered = [...waiting];
  reordered[index] = other;
  reordered[targetIndex] = self;

  const write = db.transaction(() => {
    const update = db.prepare('UPDATE visit SET queue_position = ?, updated_at = ? WHERE id = ?');
    const at = nowIso();
    reordered.forEach((entry, position) => update.run(position + 1, at, entry.visitId));
    recordAudit(db, {
      actor, action: 'queue_reordered', entity: 'visit', entityId: visitId,
      details: { direction, swapped_with: other.visitId, serial_no: self.serialNo, other_serial_no: other.serialNo },
    });
  });
  write();
}

export function activeChamberId(db: Db): string | null {
  const stored = getMeta(db, 'active_chamber_id');
  if (stored !== null) {
    const exists = db.prepare('SELECT id FROM chamber WHERE id = ? AND deleted_at IS NULL').get(stored);
    if (exists !== undefined) return stored;
  }
  const first = db.prepare('SELECT id FROM chamber WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1').get() as
    { id: string } | undefined;
  return first?.id ?? null;
}

export function setActiveChamber(db: Db, chamberId: string): void {
  setMeta(db, 'active_chamber_id', chamberId);
}

export function chambers(db: Db): Array<{ id: string; name: string }> {
  return db.prepare('SELECT id, name FROM chamber WHERE deleted_at IS NULL ORDER BY created_at')
    .all() as Array<{ id: string; name: string }>;
}
