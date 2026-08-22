// ===================================================================
// Finding a patient.
// ===================================================================
// The highest-risk operation in the system, because the failure is
// silent: attach a visit to the wrong record and two people's histories
// become one, and nobody notices until a doctor is looking at somebody
// else's blood pressure.
//
// Three rules follow from that, and none of them are negotiable:
//
//   ALWAYS A LIST. Even when exactly one patient matches, this returns
//   a list of one and the assistant chooses. There is no function in
//   this file that returns a single patient for a search term, because
//   if one existed something would eventually call it.
//
//   NEVER AUTOMATIC. Nothing here merges, links or de-duplicates on its
//   own. Merging is a separate, deliberate, audited action.
//
//   NO CLEVERNESS. Unicode normalisation and substring matching, and
//   nothing else. No phonetic matching, no fuzzy distance, no guessing
//   that "Md." and "Mohammad" are the same man. A search that makes the
//   assistant type one more letter is a far better outcome than one
//   that quietly offers the wrong person as a confident first result.
import type { Db } from '../db/open';
import { patientAgeYears } from '../db/age';
import { normaliseName, searchablePhone } from '../db/names';
import type { PatientSearchResult } from '../../shared/patients';

const ROW_COLUMNS = `
  p.id, p.full_name_bn AS nameBn, p.full_name_en AS nameEn, p.phone, p.sex,
  p.dob, p.approx_age_years, p.approx_age_recorded_on,
  p.merged_into_patient_id AS mergedIntoPatientId,
  COALESCE(m.full_name_bn, m.full_name_en) AS mergedIntoName,
  (SELECT count(*) FROM visit v WHERE v.patient_id = p.id AND v.deleted_at IS NULL) AS visitCount,
  (SELECT max(v.visit_date) FROM visit v WHERE v.patient_id = p.id AND v.deleted_at IS NULL) AS lastVisitDate,
  (SELECT c.name FROM visit v JOIN chamber c ON c.id = v.chamber_id
    WHERE v.patient_id = p.id AND v.deleted_at IS NULL
    ORDER BY v.visit_date DESC LIMIT 1) AS lastChamberName`;

interface RawRow {
  id: string; nameBn: string | null; nameEn: string | null; phone: string | null; sex: string | null;
  dob: string | null; approx_age_years: number | null; approx_age_recorded_on: string | null;
  mergedIntoPatientId: string | null; mergedIntoName: string | null;
  visitCount: number; lastVisitDate: string | null; lastChamberName: string | null;
}

function toResult(row: RawRow, asOf: Date): PatientSearchResult {
  return {
    id: row.id,
    nameBn: row.nameBn,
    nameEn: row.nameEn,
    phone: row.phone,
    sex: row.sex,
    ageYears: patientAgeYears(row, asOf),
    ageIsApproximate: row.dob === null,
    visitCount: row.visitCount,
    lastVisitDate: row.lastVisitDate,
    lastChamberName: row.lastChamberName,
    mergedIntoPatientId: row.mergedIntoPatientId,
    mergedIntoName: row.mergedIntoName,
  };
}

/**
 * Matches on phone OR name, in one pass, and always returns a list.
 *
 * Records that have been merged into another are still searched and
 * still returned, marked with what they were merged into. That is
 * deliberate: the duplicate often holds the phone number or the
 * spelling the patient actually gives at the desk, and hiding it would
 * make the patient unfindable by the very thing they said.
 */
export function searchPatients(
  db: Db, query: string, options: { limit?: number; asOf?: Date } = {},
): PatientSearchResult[] {
  const asOf = options.asOf ?? new Date();
  const limit = options.limit ?? 40;

  const name = normaliseName(query);
  const phone = searchablePhone(query);
  if (name === null && phone === null) return [];

  const rows = db.prepare(
    `SELECT ${ROW_COLUMNS}
     FROM patient p LEFT JOIN patient m ON m.id = p.merged_into_patient_id
     WHERE p.deleted_at IS NULL
       AND ( (? IS NOT NULL AND p.search_phone LIKE '%' || ? || '%')
          OR (? IS NOT NULL AND p.search_name_bn LIKE '%' || ? || '%')
          OR (? IS NOT NULL AND p.search_name_en LIKE '%' || ? || '%') )
     ORDER BY lastVisitDate DESC NULLS LAST, p.created_at DESC
     LIMIT ?`,
  ).all(phone, phone, name, name, name, name, limit) as RawRow[];

  return rows.map((row) => toResult(row, asOf));
}

/** One patient by id. Used after the assistant has chosen from a list. */
export function patientById(db: Db, id: string, asOf: Date = new Date()): PatientSearchResult | null {
  const row = db.prepare(
    `SELECT ${ROW_COLUMNS} FROM patient p LEFT JOIN patient m ON m.id = p.merged_into_patient_id
     WHERE p.id = ? AND p.deleted_at IS NULL`).get(id) as RawRow | undefined;
  return row === undefined ? null : toResult(row, asOf);
}

/**
 * Follows a merge to the record that is actually in use. Merges do not
 * chain in normal use, but the loop is cheap and a chain that somehow
 * formed must not spin forever.
 */
export function resolveToSurvivingPatient(db: Db, id: string): string {
  const seen = new Set<string>();
  let current = id;
  for (;;) {
    if (seen.has(current)) return current;
    seen.add(current);
    const row = db.prepare('SELECT merged_into_patient_id AS next FROM patient WHERE id = ?').get(current) as
      { next: string | null } | undefined;
    if (row === undefined || row.next === null) return current;
    current = row.next;
  }
}
