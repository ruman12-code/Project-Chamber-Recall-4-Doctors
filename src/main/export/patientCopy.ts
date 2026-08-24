// ===================================================================
// A patient's own copy of their record.
// ===================================================================
// The consent wording promises this in as many words:
//
//   "যেকোনো সময় আপনার তথ্যের কপি চাইতে পারেন"
//   "You can ask for a copy of your information at any time."
//
// That is a promise made to every patient at the front desk, and under
// the Personal Data Protection Act it is also their right. A promise
// that cannot be kept in under a minute at a busy desk is a promise
// that will not be kept at all, so it is one screen and one button.
//
// TWO FORMS, AND WHY THEY DIFFER
//
// A FILE is the complete record: everything held about them, including
// the front desk screening and every warning it raised. That is what
// the right of access means and it is answered in full.
//
// A PRINTED SHEET is a summary, and deliberately leaves the screening
// warnings off. A warning is an instruction to an assistant to fetch
// the doctor sooner; handing it to a patient on a piece of paper turns
// it into a statement about how ill they are, which this software does
// not make. The sheet says plainly that a complete copy can be given
// as a file, so nothing is hidden - it is put in the form where it
// means what it says.
import type { Db } from '../db/open';
import { patientAgeYears } from '../db/age';
import { nowIso } from '../db/clock';
import { recordAudit, type Actor } from '../db/audit';
import { recordUsage } from '../db/usage';
import { ChamberRecallError } from '../../shared/errors';
import { requireClinicalRole } from '../clinical/access';
import { attachmentsFor, attachmentContent } from '../attachments/store';
import type { PatientCopy, PatientCopyVisit } from '../../shared/patientCopy';

export class PatientCopyError extends ChamberRecallError {}

export function buildPatientCopy(db: Db, patientId: string, asOf: Date = new Date()): PatientCopy {
  const patient = db.prepare(
    `SELECT id, full_name_bn AS nameBn, full_name_en AS nameEn, phone, sex, dob,
            approx_age_years, approx_age_recorded_on, address_free_text AS address, created_at AS firstKnown
     FROM patient WHERE id = ? AND deleted_at IS NULL`,
  ).get(patientId) as Record<string, string | number | null> | undefined;

  if (patient === undefined) {
    throw new PatientCopyError(
      'That patient record is not there.',
      'Search for the patient again.',
    );
  }

  const visits = (db.prepare(
    `SELECT v.id, v.visit_date AS visitDate, v.serial_no AS serialNo, c.name AS chamberName, v.status
     FROM visit v JOIN chamber c ON c.id = v.chamber_id
     WHERE v.patient_id = ? AND v.deleted_at IS NULL
     ORDER BY v.visit_date DESC, v.serial_no DESC`,
  ).all(patientId) as Array<Record<string, string | number>>).map((row): PatientCopyVisit => {
    const visitId = String(row.id);

    const intake = db.prepare(
      `SELECT id, started_at AS startedAt FROM intake WHERE visit_id = ? AND deleted_at IS NULL`,
    ).get(visitId) as { id: string; startedAt: string } | undefined;

    const answers = intake === undefined ? [] : (db.prepare(
      `SELECT question_key AS questionKey, answer_value AS value, answer_free_text AS freeText,
              was_skipped AS skipped
       FROM intake_answer WHERE intake_id = ? ORDER BY created_at, rowid`,
    ).all(intake.id) as Array<Record<string, string | number | null>>).map((a) => ({
      questionKey: String(a.questionKey),
      value: a.value as string | null,
      freeText: a.freeText as string | null,
      skipped: a.skipped === 1,
    }));

    const warnings = intake === undefined ? [] : (db.prepare(
      `SELECT rule_id AS ruleId, rule_version AS ruleVersion, fired_at AS firedAt
       FROM red_flag_event WHERE intake_id = ? ORDER BY fired_at`,
    ).all(intake.id) as Array<Record<string, string>>).map((w) => ({
      ruleId: String(w.ruleId), ruleVersion: String(w.ruleVersion), firedAt: String(w.firedAt),
    }));

    const vitals = db.prepare(
      `SELECT systolic_bp AS systolic, diastolic_bp AS diastolic, pulse, temperature_c AS temperatureC,
              weight_kg AS weightKg, height_cm AS heightCm, random_blood_sugar AS randomBloodSugar, spo2
       FROM vitals WHERE visit_id = ? AND deleted_at IS NULL ORDER BY recorded_at DESC LIMIT 1`,
    ).get(visitId) as Record<string, number | null> | undefined;

    const encounter = db.prepare(
      `SELECT id, chief_complaint AS chiefComplaint, examination_notes AS examinationNotes,
              working_diagnosis AS workingDiagnosis, decision_notes AS decisionNotes,
              follow_up_after_days AS followUpAfterDays, doctor_confirmed_at AS confirmedAt
       FROM encounter WHERE visit_id = ? AND deleted_at IS NULL`,
    ).get(visitId) as Record<string, string | number | null> | undefined;

    const medications = encounter === undefined ? [] : (db.prepare(
      `SELECT drug_name AS drugName, strength, dose, frequency, duration_days AS durationDays, instructions
       FROM medication WHERE encounter_id = ? AND deleted_at IS NULL ORDER BY sort_order, rowid`,
    ).all(encounter.id) as Array<Record<string, string | number | null>>).map((m) => ({
      drugName: String(m.drugName),
      strength: m.strength as string | null,
      dose: m.dose as string | null,
      frequency: m.frequency as string | null,
      durationDays: m.durationDays as number | null,
      instructions: m.instructions as string | null,
    }));

    const investigations = encounter === undefined ? [] : (db.prepare(
      `SELECT test_name AS testName, ordered_date AS orderedDate, result_date AS resultDate,
              result_summary AS resultSummary
       FROM investigation WHERE encounter_id = ? AND deleted_at IS NULL ORDER BY created_at, rowid`,
    ).all(encounter.id) as Array<Record<string, string | null>>).map((i) => ({
      testName: String(i.testName),
      orderedDate: String(i.orderedDate),
      resultDate: i.resultDate ?? null,
      resultSummary: i.resultSummary ?? null,
    }));

    return {
      visitDate: String(row.visitDate),
      serialNo: Number(row.serialNo),
      chamberName: String(row.chamberName),
      whatTheyTold: answers,
      warningsRaised: warnings,
      vitals: vitals === undefined ? null : {
        systolic: vitals.systolic ?? null, diastolic: vitals.diastolic ?? null, pulse: vitals.pulse ?? null,
        temperatureC: vitals.temperatureC ?? null, weightKg: vitals.weightKg ?? null,
        heightCm: vitals.heightCm ?? null, randomBloodSugar: vitals.randomBloodSugar ?? null,
        spo2: vitals.spo2 ?? null,
      },
      complaint: (encounter?.chiefComplaint as string | null) ?? null,
      examination: (encounter?.examinationNotes as string | null) ?? null,
      diagnosis: (encounter?.workingDiagnosis as string | null) ?? null,
      decision: (encounter?.decisionNotes as string | null) ?? null,
      followUpAfterDays: (encounter?.followUpAfterDays as number | null) ?? null,
      confirmedByDoctor: (encounter?.confirmedAt ?? null) !== null,
      medications,
      investigations,
    };
  });

  const permissions = (db.prepare(
    `SELECT kind, decision, decided_at AS decidedAt, version, method
     FROM patient_consent WHERE patient_id = ? ORDER BY decided_at`,
  ).all(patientId) as Array<Record<string, string>>).map((c) => ({
    kind: String(c.kind), decision: String(c.decision), decidedAt: String(c.decidedAt),
    version: String(c.version), method: String(c.method),
  }));

  const papers = attachmentsFor(db, patientId).map((a) => ({
    id: a.id,
    kind: a.kind,
    caption: a.caption,
    documentDate: a.documentDate,
    photographedAt: a.capturedAt,
    fileName: `paper-${a.documentDate ?? a.capturedAt.slice(0, 10)}-${a.id.slice(0, 8)}.${a.contentType === 'image/png' ? 'png' : 'jpg'}`,
  }));

  return {
    madeAt: asOf.toISOString(),
    patient: {
      nameBn: patient.nameBn as string | null,
      nameEn: patient.nameEn as string | null,
      phone: patient.phone as string | null,
      sex: patient.sex as string | null,
      dateOfBirth: patient.dob as string | null,
      ageYears: patientAgeYears({
        dob: patient.dob as string | null,
        approx_age_years: patient.approx_age_years as number | null,
        approx_age_recorded_on: patient.approx_age_recorded_on as string | null,
      }, asOf),
      ageIsApproximate: patient.dob === null,
      address: patient.address as string | null,
      firstKnownHere: String(patient.firstKnown).slice(0, 10),
    },
    visits,
    permissions,
    papers,
  };
}

/**
 * The picture files that go beside the record, so the patient gets
 * their own photographed reports back rather than a list of them.
 */
export function patientCopyFiles(db: Db, copy: PatientCopy): Array<{ name: string; content: Buffer }> {
  const files: Array<{ name: string; content: Buffer }> = [];
  for (const paper of copy.papers) {
    try {
      files.push({ name: paper.fileName, content: attachmentContent(db, paper.id).content });
    } catch {
      // A damaged photograph does not stop the rest of somebody's
      // record being handed over. It is reported by its absence and by
      // the note written into the folder.
    }
  }
  return files;
}

export function recordPatientCopyGiven(
  db: Db, patientId: string, how: 'printed' | 'file', actor: Actor, at: string = nowIso(),
): void {
  requireClinicalRole(actor, 'give a patient a copy of their record');
  recordAudit(db, {
    actor, action: 'patient_copy_given', entity: 'patient', entityId: patientId, details: { how },
  });
  recordUsage(db, { eventType: 'patient_copy_given', actorId: actor.id, timestamp: at });
}
