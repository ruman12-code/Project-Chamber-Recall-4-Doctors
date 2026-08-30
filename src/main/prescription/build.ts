// ===================================================================
// Building the printed prescription.
// ===================================================================
// This assembles a sheet out of things a person typed and nothing
// else. It does not decide anything: no dose is worked out, no
// interaction is checked, no medicine or test is suggested, nothing is
// reordered by importance. The only arithmetic in the whole file turns
// "follow up after 14 days" into a date, which is a calendar question
// rather than a clinical one.
//
// Printing is only possible once the doctor has confirmed the
// consultation. The paper the patient carries out of the room IS the
// record as far as they and the next pharmacist are concerned, and a
// printed draft is indistinguishable from a signed one the moment it
// leaves the desk.
import type { Db } from './../db/open';
import { nowIso } from '../db/clock';
import { patientAgeYears } from '../db/age';
import { recordAudit, type Actor } from '../db/audit';
import { recordUsage } from '../db/usage';
import { ChamberRecallError } from '../../shared/errors';
import { requireClinicalRole } from '../clinical/access';
import { encounterFor, medicationsOf } from '../clinical/encounter';
import { vitalsFor } from '../clinical/vitals';
import { loadPrescriptionConfig, letterheadFor } from './config';
import type { PrescriptionView, PreviousVisit } from '../../shared/prescription';

export class PrescriptionError extends ChamberRecallError {}

function addDays(date: string, days: number): string | null {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

/**
 * Today's readings as one short line. Only what was actually taken:
 * an empty box does not become "—" on a piece of paper somebody else
 * will read as a measurement.
 */
function vitalsLine(db: Db, visitId: string): string {
  const v = vitalsFor(db, visitId);
  const parts: string[] = [];
  if (v.systolic !== null && v.diastolic !== null) parts.push(`BP ${v.systolic}/${v.diastolic}`);
  if (v.pulse !== null) parts.push(`Pulse ${v.pulse}`);
  if (v.temperatureC !== null) parts.push(`Temp ${v.temperatureC.toFixed(1)}°C`);
  if (v.weightKg !== null) parts.push(`Wt ${v.weightKg} kg`);
  if (v.randomBloodSugar !== null) parts.push(`RBS ${v.randomBloodSugar} mmol/L`);
  if (v.spo2 !== null) parts.push(`SpO₂ ${v.spo2}%`);
  return parts.join(' · ');
}

export function buildPrescription(db: Db, dataDir: string, visitId: string, asOf: Date = new Date()): PrescriptionView {
  const { config, blocksLiveUse } = loadPrescriptionConfig(dataDir);
  if (config === null) {
    throw new PrescriptionError(
      'The prescription letterhead cannot be read, so nothing can be printed.',
      `Open prescription.yaml in the records folder and put right what is wrong with it: ${blocksLiveUse.map((b) => b.reason).join(' ')}`,
    );
  }

  const visit = db.prepare(
    `SELECT v.visit_date AS visitDate, v.serial_no AS serialNo, c.name AS chamberName,
            p.full_name_bn AS nameBn, p.full_name_en AS nameEn, p.sex,
            p.dob, p.approx_age_years, p.approx_age_recorded_on
     FROM visit v JOIN chamber c ON c.id = v.chamber_id JOIN patient p ON p.id = v.patient_id
     WHERE v.id = ? AND v.deleted_at IS NULL`,
  ).get(visitId) as Record<string, string | number | null> | undefined;

  if (visit === undefined) {
    throw new PrescriptionError(
      'That visit is not there.',
      'Go back to today\'s list and open the patient again.',
    );
  }

  const encounter = encounterFor(db, visitId);
  if (encounter === null) {
    throw new PrescriptionError(
      'Nothing has been written for this visit yet.',
      'Write the consultation first. There is nothing to print.',
    );
  }
  if (encounter.confirmedAt === null) {
    throw new PrescriptionError(
      'This consultation has not been confirmed, so it cannot be printed.',
      'Press "Confirm this consultation" first. Once it is printed and handed over, nobody can tell a draft from a signed prescription — so the signature comes first.',
    );
  }

  const chamberName = String(visit.chamberName);
  const address = letterheadFor(config, chamberName);
  const visitDate = String(visit.visitDate);

  const printed = db.prepare(
    `SELECT count(*) AS n FROM audit_log WHERE action = 'prescription_printed' AND entity_id = ?`,
  ).get(encounter.id) as { n: number };

  return {
    previousVisits: previousVisitsFor(db, visitId),
    letterhead: {
      doctorNameBn: config.doctor.name.bn,
      doctorNameEn: config.doctor.name.en,
      qualifications: config.doctor.qualifications,
      designation: config.doctor.designation,
      registration: config.doctor.registration,
      chamberName,
      addressBn: address?.address.bn ?? '',
      addressEn: address?.address.en ?? '',
      phone: address?.phone ?? '',
      hoursBn: address?.hours.bn ?? '',
      hoursEn: address?.hours.en ?? '',
      footerBn: config.footer.bn,
      footerEn: config.footer.en,
      addressKnown: address !== null,
      paper: config.paper,
    },
    patient: {
      nameBn: visit.nameBn as string | null,
      nameEn: visit.nameEn as string | null,
      ageYears: patientAgeYears({
        dob: visit.dob as string | null,
        approx_age_years: visit.approx_age_years as number | null,
        approx_age_recorded_on: visit.approx_age_recorded_on as string | null,
      }, asOf),
      ageIsApproximate: visit.dob === null,
      sex: visit.sex as string | null,
    },
    visitDate,
    serialNo: Number(visit.serialNo),
    diagnosis: config.printDiagnosis ? encounter.workingDiagnosis : null,
    vitalsLine: config.printVitals ? vitalsLine(db, visitId) : '',
    medications: encounter.medications,
    investigations: encounter.investigations,
    advice: encounter.decisionNotes,
    followUpAfterDays: encounter.followUpAfterDays,
    followUpDate: encounter.followUpAfterDays === null ? null : addDays(visitDate, encounter.followUpAfterDays),
    confirmedAt: encounter.confirmedAt,
    confirmedByName: encounter.confirmedByName,
    timesPrinted: printed.n,
  };
}

/**
 * Recorded after the paper comes out, not before.
 *
 * How many prescriptions were printed, and how many were reprinted, is
 * one of the numbers the pilot report is built from - and a reprint
 * usually means something went wrong with the first one.
 */
export function recordPrescriptionPrinted(db: Db, visitId: string, actor: Actor, at: string = nowIso()): void {
  requireClinicalRole(actor, 'print a prescription');
  const encounter = encounterFor(db, visitId);
  if (encounter === null) {
    throw new PrescriptionError(
      'There is nothing to record a printing against.',
      'That is a fault in the software rather than anything you did. Report it before carrying on.',
    );
  }
  const before = db.prepare(
    `SELECT count(*) AS n FROM audit_log WHERE action = 'prescription_printed' AND entity_id = ?`,
  ).get(encounter.id) as { n: number };

  recordAudit(db, {
    actor, action: 'prescription_printed', entity: 'encounter', entityId: encounter.id,
    details: { visit_id: visitId, copy: before.n + 1, reprint: before.n > 0 },
  });
  recordUsage(db, {
    eventType: before.n > 0 ? 'prescription_reprinted' : 'prescription_printed',
    actorId: actor.id, visitId, timestamp: at,
  });
}

/**
 * The last two CONFIRMED consultations before this one, for the sheet.
 *
 * Read by patient, not by chamber: the same doctor sees the same
 * patient at Lubana on Tuesday and Popular on Thursday, and a history
 * that stopped at the chamber door would be a history with holes in
 * it. The chamber is named on each line so the reader can see where.
 *
 * Ordered by date and then by when the visit was created, so two
 * visits on one day come out in the order they happened.
 *
 * Every word is the doctor's own, typed by him at the time. Nothing
 * here is summarised, shortened, ranked or inferred.
 */
function previousVisitsFor(db: Db, visitId: string): PreviousVisit[] {
  const rows = db.prepare(
    `SELECT v.id, v.visit_date AS visitDate, c.name AS chamberName, e.id AS encounterId,
            e.decision_notes AS advice
       FROM visit v
       JOIN chamber c ON c.id = v.chamber_id
       JOIN encounter e ON e.visit_id = v.id AND e.deleted_at IS NULL
      WHERE v.patient_id = (SELECT patient_id FROM visit WHERE id = ?)
        AND v.id != ?
        AND v.deleted_at IS NULL
        AND e.doctor_confirmed_at IS NOT NULL
        AND (v.visit_date, v.created_at) <
            (SELECT visit_date, created_at FROM visit WHERE id = ?)
      ORDER BY v.visit_date DESC, v.created_at DESC
      LIMIT 2`,
  ).all(visitId, visitId, visitId) as Array<{
    visitDate: string; chamberName: string; encounterId: string; advice: string | null;
  }>;

  return rows.map((row) => ({
    visitDate: row.visitDate,
    chamberName: row.chamberName,
    medications: medicationsOf(db, row.encounterId),
    advice: row.advice,
    investigations: (db.prepare(
      `SELECT test_name AS testName FROM investigation
        WHERE encounter_id = ? AND deleted_at IS NULL ORDER BY created_at, rowid`,
    ).all(row.encounterId) as Array<{ testName: string }>).map((r) => r.testName),
  }));
}
