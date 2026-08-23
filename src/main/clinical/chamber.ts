// ===================================================================
// Everything the chamber screen shows, in one read.
// ===================================================================
// The doctor has a patient in front of him. The screen has to hold who
// they are, what was taken today, what he is writing now, and what he
// wrote last time - because the commonest thing that happens in a
// chamber is "same as before, continue the medicine", and making him
// retype it from memory is how a dose changes by accident.
import type { Db } from '../db/open';
import { patientAgeYears } from '../db/age';
import { vitalsFor } from './vitals';
import { encounterFor, medicationsOf } from './encounter';
import { ChamberRecallError } from '../../shared/errors';
import type { ChamberView, MedicationInput } from '../../shared/clinical';

export class ChamberViewError extends ChamberRecallError {}

export function chamberView(db: Db, visitId: string, asOf: Date = new Date()): ChamberView {
  const visit = db.prepare(
    `SELECT v.id, v.visit_date AS visitDate, v.serial_no AS serialNo, c.name AS chamberName,
            p.id AS patientId, p.full_name_bn AS nameBn, p.full_name_en AS nameEn, p.sex,
            p.dob, p.approx_age_years, p.approx_age_recorded_on
     FROM visit v JOIN chamber c ON c.id = v.chamber_id JOIN patient p ON p.id = v.patient_id
     WHERE v.id = ? AND v.deleted_at IS NULL`,
  ).get(visitId) as Record<string, string | number | null> | undefined;

  if (visit === undefined) {
    throw new ChamberViewError(
      'That visit is not there.',
      'Go back to today\'s list and open the patient again.',
    );
  }

  const encounter = encounterFor(db, visitId);
  if (encounter === null) {
    throw new ChamberViewError(
      'This consultation has not been started.',
      'That is a fault in the software rather than anything you did. Close the patient and open them again.',
    );
  }

  const previous = db.prepare(
    `SELECT e.id, e.working_diagnosis AS workingDiagnosis, v.visit_date AS visitDate
     FROM encounter e JOIN visit v ON v.id = e.visit_id
     WHERE v.patient_id = ? AND v.id <> ? AND v.visit_date <= ? AND e.deleted_at IS NULL AND v.deleted_at IS NULL
     ORDER BY v.visit_date DESC, v.serial_no DESC LIMIT 1`,
  ).get(visit.patientId, visitId, visit.visitDate) as
    { id: string; workingDiagnosis: string | null; visitDate: string } | undefined;

  const previousMedications: MedicationInput[] = previous === undefined ? [] : medicationsOf(db, previous.id);

  return {
    visitId: String(visit.id),
    patientName: (visit.nameBn as string | null) ?? (visit.nameEn as string | null) ?? 'unnamed',
    patientNameAlt: visit.nameBn !== null && visit.nameEn !== null ? String(visit.nameEn) : null,
    ageYears: patientAgeYears({
      dob: visit.dob as string | null,
      approx_age_years: visit.approx_age_years as number | null,
      approx_age_recorded_on: visit.approx_age_recorded_on as string | null,
    }, asOf),
    ageIsApproximate: visit.dob === null,
    sex: visit.sex as string | null,
    serialNo: Number(visit.serialNo),
    chamberName: String(visit.chamberName),
    visitDate: String(visit.visitDate),
    vitals: vitalsFor(db, visitId),
    encounter,
    previousDiagnosis: previous?.workingDiagnosis ?? null,
    previousMedications,
    previousVisitDate: previous?.visitDate ?? null,
  };
}
