// ===================================================================
// Merging two records that are the same person.
// ===================================================================
// Duplicates are inevitable. The same man arrives on a Tuesday as
// "Mohammad Rafiq" and on a Thursday as "Md. Rafiq" with his son's
// phone number, and two records exist. The front desk has to be able to
// put them together without telephoning a programmer.
//
// The dangerous case is the opposite one: two DIFFERENT people merged
// into one record, which fuses two histories and is exactly the kind of
// error that gets somebody hurt. Everything here is built around making
// that recoverable rather than merely unlikely.
//
//   Nothing is deleted. The duplicate record stays, marked with what it
//   was merged into, and stays searchable - so a patient who gives the
//   old phone number is still found.
//
//   Nothing is invented. Fields are not combined. The surviving record
//   keeps its own details exactly as they were.
//
//   Everything moved is written down by id, so the merge can be undone
//   exactly, moving back precisely what was moved and nothing else.
import type { Db } from '../db/open';
import { nowIso } from '../db/clock';
import { recordAudit, type Actor } from '../db/audit';
import { patientById } from './search';
import { ChamberRecallError } from '../../shared/errors';
import type { MergeComparison, MergePreview } from '../../shared/patients';

export class MergeRefusedError extends ChamberRecallError {}

const COMPARED_FIELDS: Array<{ column: string; label: string }> = [
  { column: 'full_name_bn', label: 'Name (Bangla)' },
  { column: 'full_name_en', label: 'Name (English)' },
  { column: 'phone', label: 'Phone' },
  { column: 'sex', label: 'Sex' },
  { column: 'dob', label: 'Date of birth' },
  { column: 'approx_age_years', label: 'Age (estimated)' },
  { column: 'address_free_text', label: 'Address' },
];

/**
 * Everything a person needs to decide whether these two records really
 * are the same patient, shown before anything is changed.
 */
export function previewMerge(db: Db, survivingId: string, duplicateId: string, asOf: Date = new Date()): MergePreview {
  const surviving = patientById(db, survivingId, asOf);
  const duplicate = patientById(db, duplicateId, asOf);

  const blockers: string[] = [];
  if (surviving === null) blockers.push('The record to keep no longer exists.');
  if (duplicate === null) blockers.push('The duplicate record no longer exists.');
  if (survivingId === duplicateId) blockers.push('These are the same record.');
  if (duplicate !== null && duplicate.mergedIntoPatientId !== null) {
    blockers.push(`That record has already been merged into ${duplicate.mergedIntoName ?? 'another record'}.`);
  }
  if (surviving !== null && surviving.mergedIntoPatientId !== null) {
    blockers.push(`The record to keep has itself been merged into ${surviving.mergedIntoName ?? 'another record'}. Keep that one instead.`);
  }

  const rows = db.prepare(
    `SELECT id, ${COMPARED_FIELDS.map((f) => f.column).join(', ')} FROM patient WHERE id IN (?, ?)`,
  ).all(survivingId, duplicateId) as Array<Record<string, string | number | null>>;
  const byId = new Map(rows.map((r) => [String(r.id), r]));

  const comparison: MergeComparison[] = COMPARED_FIELDS.map((field) => {
    const a = byId.get(survivingId)?.[field.column] ?? null;
    const b = byId.get(duplicateId)?.[field.column] ?? null;
    return {
      field: field.column,
      label: field.label,
      surviving: a === null ? null : String(a),
      duplicate: b === null ? null : String(b),
      differs: a !== null && b !== null && String(a) !== String(b),
    };
  });

  const count = (table: string) =>
    (db.prepare(`SELECT count(*) AS n FROM ${table} WHERE patient_id = ?`).get(duplicateId) as { n: number }).n;

  return {
    surviving: surviving ?? { ...emptyResult(survivingId) },
    duplicate: duplicate ?? { ...emptyResult(duplicateId) },
    comparison,
    visitsToMove: count('visit'),
    attachmentsToMove: count('attachment'),
    blockers,
  };
}

function emptyResult(id: string) {
  return {
    id, nameBn: null, nameEn: null, phone: null, sex: null, ageYears: null, ageIsApproximate: true,
    visitCount: 0, lastVisitDate: null, lastChamberName: null, mergedIntoPatientId: null, mergedIntoName: null,
  };
}

export interface MergeOutcome {
  visitsMoved: number;
  attachmentsMoved: number;
}

export function mergePatients(
  db: Db, survivingId: string, duplicateId: string, actor: Actor, note: string | null = null,
): MergeOutcome {
  const preview = previewMerge(db, survivingId, duplicateId);
  if (preview.blockers.length > 0) {
    throw new MergeRefusedError(
      'These two records cannot be merged.',
      preview.blockers.join(' '),
    );
  }

  const visitIds = (db.prepare('SELECT id FROM visit WHERE patient_id = ?').all(duplicateId) as Array<{ id: string }>)
    .map((r) => r.id);
  const attachmentIds = (db.prepare('SELECT id FROM attachment WHERE patient_id = ?').all(duplicateId) as Array<{ id: string }>)
    .map((r) => r.id);

  const at = nowIso();
  const write = db.transaction(() => {
    if (visitIds.length > 0) {
      db.prepare(`UPDATE visit SET patient_id = ?, updated_at = ? WHERE patient_id = ?`).run(survivingId, at, duplicateId);
    }
    if (attachmentIds.length > 0) {
      db.prepare(`UPDATE attachment SET patient_id = ? WHERE patient_id = ?`).run(survivingId, duplicateId);
    }
    db.prepare('UPDATE patient SET merged_into_patient_id = ?, updated_at = ? WHERE id = ?')
      .run(survivingId, at, duplicateId);

    // Every id is recorded, because undoing this has to move back
    // exactly what was moved - not everything the surviving record
    // happens to have by then.
    recordAudit(db, {
      actor, action: 'patients_merged', entity: 'patient', entityId: duplicateId,
      details: { surviving_patient_id: survivingId, duplicate_patient_id: duplicateId,
        moved_visit_ids: visitIds, moved_attachment_ids: attachmentIds, note },
    });
  });
  write();

  return { visitsMoved: visitIds.length, attachmentsMoved: attachmentIds.length };
}

/**
 * Puts a merge back exactly as it was.
 *
 * This exists because the front desk will occasionally merge two people
 * who are not the same person, and the brief is explicit that they must
 * be able to fix things without telephoning anybody. An undo that moves
 * back precisely the visits that were moved is the difference between a
 * mistake and a disaster.
 */
export function undoMerge(db: Db, duplicateId: string, actor: Actor): MergeOutcome {
  const patient = db.prepare('SELECT merged_into_patient_id AS survivingId FROM patient WHERE id = ?')
    .get(duplicateId) as { survivingId: string | null } | undefined;
  if (patient === undefined) throw new MergeRefusedError('That record does not exist.', 'Search for the patient again.');
  if (patient.survivingId === null) {
    throw new MergeRefusedError('That record was not merged into anything.', 'There is nothing to undo.');
  }

  const entry = db.prepare(
    `SELECT details_json FROM audit_log WHERE action = 'patients_merged' AND entity_id = ?
     ORDER BY id DESC LIMIT 1`).get(duplicateId) as { details_json: string | null } | undefined;
  if (entry?.details_json == null) {
    throw new MergeRefusedError(
      'There is no record of how this merge was done, so it cannot be undone safely.',
      'Leave it as it is and ask for help. Undoing it by guesswork could attach visits to the wrong patient.',
    );
  }

  const details = JSON.parse(entry.details_json) as { moved_visit_ids?: string[]; moved_attachment_ids?: string[] };
  const visitIds = details.moved_visit_ids ?? [];
  const attachmentIds = details.moved_attachment_ids ?? [];
  const at = nowIso();

  const write = db.transaction(() => {
    const moveVisit = db.prepare('UPDATE visit SET patient_id = ?, updated_at = ? WHERE id = ?');
    for (const id of visitIds) moveVisit.run(duplicateId, at, id);
    const moveAttachment = db.prepare('UPDATE attachment SET patient_id = ? WHERE id = ?');
    for (const id of attachmentIds) moveAttachment.run(duplicateId, id);

    db.prepare('UPDATE patient SET merged_into_patient_id = NULL, updated_at = ? WHERE id = ?').run(at, duplicateId);
    recordAudit(db, {
      actor, action: 'patients_merge_undone', entity: 'patient', entityId: duplicateId,
      details: { surviving_patient_id: patient.survivingId, moved_back_visit_ids: visitIds, moved_back_attachment_ids: attachmentIds },
    });
  });
  write();

  return { visitsMoved: visitIds.length, attachmentsMoved: attachmentIds.length };
}
