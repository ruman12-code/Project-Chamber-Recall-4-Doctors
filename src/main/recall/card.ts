// ===================================================================
// Assembling the Recall Card.
// ===================================================================
// Everything the doctor sees on one screen, gathered in one place so
// the screen itself contains no queries and no logic beyond layout.
//
// Two rules run through all of it:
//
//   Soft-deleted rows are excluded everywhere. A record removed from
//   view must not reappear on the most important screen in the product.
//
//   Nothing is interpreted. Diagnoses are grouped by exact text match
//   and by nothing else - no normalising, no clustering, no guessing
//   that two differently-worded entries mean the same thing. Whatever
//   the clinician typed is what appears.
import type { Db } from '../db/open';
import { patientAgeYears } from '../db/age';
import type { Rulebook } from '../redflags/rulebook';
import { consentState } from '../consent/store';
import { correctionsFor } from '../intake/confirm';
import type {
  RecallCard, VitalsReading, IntakeAnswerView, RedFlagView, MedicationView,
  OutstandingInvestigation, TimelineEntry, RecurringDiagnosis, ScreeningState,
} from '../../shared/recall';

const VITALS_COLUMNS = `
  vi.recorded_at AS recordedAt, v.visit_date AS visitDate,
  vi.systolic_bp AS systolic, vi.diastolic_bp AS diastolic, vi.pulse AS pulse,
  vi.temperature_c AS temperatureC, vi.weight_kg AS weightKg, vi.height_cm AS heightCm,
  vi.random_blood_sugar AS randomBloodSugar, vi.spo2 AS spo2,
  u.display_name AS recordedByName, u.role AS recordedByRole`;

function daysBetween(fromDate: string, to: Date): number {
  const from = new Date(`${fromDate}T00:00:00`);
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 86400000));
}

/** The visit the doctor is looking at right now, if there is one. */
export function currentVisitId(db: Db, visitDate: string): string | null {
  const row = db.prepare(
    `SELECT id FROM visit
     WHERE visit_date = ? AND status = 'in_chamber' AND deleted_at IS NULL
     ORDER BY serial_no LIMIT 1`).get(visitDate) as { id: string } | undefined;
  return row?.id ?? null;
}

/**
 * The rulebook is needed because a fired alert records which rule fired
 * and in which version, but not the words the assistant was shown. The
 * text is looked up from the rules file as it stands now.
 *
 * That is a weakness worth naming: if a rule is deleted or reworded
 * without its version being increased, an old alert loses the words
 * that went with it. See docs/DECISIONS.md, open question I.
 */
export function buildRecallCard(
  db: Db, visitId: string, asOf: Date = new Date(), rulebook: Rulebook | null = null,
  consentVersion: string | null = null,
): RecallCard {
  const visit = db.prepare(
    `SELECT v.id, v.patient_id AS patientId, v.visit_date AS visitDate, v.serial_no AS serialNo,
            v.status, v.arrived_at AS arrivedAt, v.seen_at AS seenAt, c.name AS chamberName
     FROM visit v JOIN chamber c ON c.id = v.chamber_id
     WHERE v.id = ? AND v.deleted_at IS NULL`).get(visitId) as
    { id: string; patientId: string; visitDate: string; serialNo: number; status: string;
      arrivedAt: string; seenAt: string | null; chamberName: string } | undefined;
  if (visit === undefined) throw new Error(`no visit with id ${visitId}`);

  const patient = db.prepare(
    `SELECT id, full_name_bn AS nameBn, full_name_en AS nameEn, phone, sex,
            dob, approx_age_years, approx_age_recorded_on
     FROM patient WHERE id = ?`).get(visit.patientId) as
    { id: string; nameBn: string | null; nameEn: string | null; phone: string | null; sex: string | null;
      dob: string | null; approx_age_years: number | null; approx_age_recorded_on: string | null };

  // ---- today: red flags, screening, intake, vitals
  const intake = db.prepare(
    `SELECT i.id, i.started_at AS startedAt, i.completed_at AS completedAt, i.helper_present AS helperPresent,
            u.display_name AS recordedByName, u.role AS recordedByRole,
            i.doctor_confirmed_at AS confirmedAt, d.display_name AS confirmedByName
     FROM intake i
     LEFT JOIN app_user u ON u.id = i.recorded_by
     LEFT JOIN app_user d ON d.id = i.doctor_confirmed_by
     WHERE i.visit_id = ? AND i.deleted_at IS NULL`).get(visitId) as
    { id: string; startedAt: string; completedAt: string | null; helperPresent: number | null;
      recordedByName: string | null; recordedByRole: string | null;
      confirmedAt: string | null; confirmedByName: string | null } | undefined;

  let redFlags: RedFlagView[] = [];
  let screening: ScreeningState = { ran: false, incomplete: false, missingQuestions: [] };
  let intakeAnswers: IntakeAnswerView[] = [];

  if (intake !== undefined) {
    intakeAnswers = (db.prepare(
      `SELECT question_key AS questionKey, answer_value AS value, answer_free_text AS freeText, was_skipped AS skipped
       FROM intake_answer WHERE intake_id = ? ORDER BY created_at, rowid`).all(intake.id) as Array<
        { questionKey: string; value: string | null; freeText: string | null; skipped: number }>)
      .map((a) => ({ questionKey: a.questionKey, value: a.value, freeText: a.freeText, skipped: a.skipped === 1 }));

    redFlags = (db.prepare(
      `SELECT e.id AS eventId, e.rule_id AS ruleId, e.rule_version AS ruleVersion,
              e.fired_at AS firedAt, e.acknowledged_at AS acknowledgedAt, u.display_name AS acknowledgedByName
       FROM red_flag_event e LEFT JOIN app_user u ON u.id = e.acknowledged_by
       WHERE e.intake_id = ? ORDER BY e.fired_at`).all(intake.id) as Array<Omit<RedFlagView, 'messageBn' | 'messageEn'>>)
      .map((event) => {
        const rule = rulebook?.rules.find((r) => r.id === event.ruleId && r.version === event.ruleVersion);
        return {
          ...event,
          messageBn: rule?.message.bn ?? 'This rule is no longer in the rules file as this version.',
          messageEn: rule?.message.en ?? 'This rule is no longer in the rules file as this version.',
        };
      });

    // The screening state comes from the evaluation log, which is the
    // only honest source: it knows the difference between "the rules
    // ran and found nothing" and "the rules could not be checked".
    const evaluations = db.prepare(
      `SELECT outcome, unknown_questions AS unknownQuestions FROM red_flag_evaluation WHERE intake_id = ?`)
      .all(intake.id) as Array<{ outcome: string; unknownQuestions: string | null }>;

    const missing = new Set<string>();
    for (const e of evaluations) {
      if (e.outcome === 'could_not_check' && e.unknownQuestions !== null) {
        for (const q of e.unknownQuestions.split(',')) missing.add(q);
      }
    }
    screening = {
      ran: evaluations.length > 0,
      incomplete: evaluations.some((e) => e.outcome === 'could_not_check'),
      missingQuestions: [...missing].sort(),
    };
  }

  const todayVitals = db.prepare(
    `SELECT ${VITALS_COLUMNS} FROM vitals vi
     JOIN visit v ON v.id = vi.visit_id LEFT JOIN app_user u ON u.id = vi.recorded_by
     WHERE vi.visit_id = ? AND vi.deleted_at IS NULL ORDER BY vi.recorded_at DESC LIMIT 1`)
    .get(visitId) as VitalsReading | undefined;

  // ---- the two readings before this one, for comparison side by side
  const previousVitals = db.prepare(
    `SELECT ${VITALS_COLUMNS} FROM vitals vi
     JOIN visit v ON v.id = vi.visit_id LEFT JOIN app_user u ON u.id = vi.recorded_by
     WHERE v.patient_id = ? AND v.id != ? AND v.visit_date <= ? AND vi.deleted_at IS NULL AND v.deleted_at IS NULL
     ORDER BY v.visit_date DESC, vi.recorded_at DESC LIMIT 2`)
    .all(visit.patientId, visitId, visit.visitDate) as VitalsReading[];

  // ---- the last visit that actually produced a record
  const last = db.prepare(
    `SELECT v.visit_date AS visitDate, c.name AS chamberName, e.id AS encounterId,
            e.chief_complaint AS chiefComplaint, e.examination_notes AS examinationNotes,
            e.working_diagnosis AS workingDiagnosis, e.decision_notes AS decisionNotes,
            e.follow_up_after_days AS followUpAfterDays, e.doctor_confirmed_at AS doctorConfirmedAt
     FROM visit v JOIN chamber c ON c.id = v.chamber_id JOIN encounter e ON e.visit_id = v.id
     WHERE v.patient_id = ? AND v.id != ? AND v.visit_date <= ? AND v.deleted_at IS NULL AND e.deleted_at IS NULL
     ORDER BY v.visit_date DESC LIMIT 1`)
    .get(visit.patientId, visitId, visit.visitDate) as
    { visitDate: string; chamberName: string; encounterId: string; chiefComplaint: string | null;
      examinationNotes: string | null; workingDiagnosis: string | null; decisionNotes: string | null;
      followUpAfterDays: number | null; doctorConfirmedAt: string | null } | undefined;

  const medicationsOf = (encounterId: string): MedicationView[] => db.prepare(
    `SELECT drug_name AS drugName, strength, dose, frequency, duration_days AS durationDays, instructions
     FROM medication WHERE encounter_id = ? AND deleted_at IS NULL ORDER BY sort_order`)
    .all(encounterId) as MedicationView[];

  const lastVisit = last === undefined ? null : {
    visitDate: last.visitDate,
    chamberName: last.chamberName,
    chiefComplaint: last.chiefComplaint,
    examinationNotes: last.examinationNotes,
    workingDiagnosis: last.workingDiagnosis,
    decisionNotes: last.decisionNotes,
    followUpAfterDays: last.followUpAfterDays,
    doctorConfirmedAt: last.doctorConfirmedAt,
    medications: medicationsOf(last.encounterId),
    investigationsOrdered: (db.prepare(
      `SELECT test_name AS t FROM investigation WHERE encounter_id = ? AND deleted_at IS NULL ORDER BY created_at`)
      .all(last.encounterId) as Array<{ t: string }>).map((r) => r.t),
  };

  // ---- ordered, never came back. The thing paper folders lose.
  const outstandingInvestigations = (db.prepare(
    `SELECT i.test_name AS testName, i.ordered_date AS orderedDate, c.name AS chamberName
     FROM investigation i JOIN encounter e ON e.id = i.encounter_id
     JOIN visit v ON v.id = e.visit_id JOIN chamber c ON c.id = v.chamber_id
     WHERE v.patient_id = ? AND i.result_date IS NULL AND i.deleted_at IS NULL AND v.deleted_at IS NULL
     ORDER BY i.ordered_date DESC`).all(visit.patientId) as Array<Omit<OutstandingInvestigation, 'daysWaiting'>>)
    .map((row) => ({ ...row, daysWaiting: daysBetween(row.orderedDate, asOf) }));

  // ---- trends across every visit
  const trendRows = db.prepare(
    `SELECT v.visit_date AS date, vi.systolic_bp AS systolic, vi.diastolic_bp AS diastolic,
            vi.weight_kg AS weight, vi.random_blood_sugar AS sugar
     FROM vitals vi JOIN visit v ON v.id = vi.visit_id
     WHERE v.patient_id = ? AND vi.deleted_at IS NULL AND v.deleted_at IS NULL
     ORDER BY v.visit_date`).all(visit.patientId) as
    Array<{ date: string; systolic: number | null; diastolic: number | null; weight: number | null; sugar: number | null }>;

  const trend = {
    bp: trendRows.filter((r) => r.systolic !== null && r.diastolic !== null)
      .map((r) => ({ date: r.date, systolic: r.systolic!, diastolic: r.diastolic! })),
    weight: trendRows.filter((r) => r.weight !== null).map((r) => ({ date: r.date, value: r.weight! })),
    sugar: trendRows.filter((r) => r.sugar !== null).map((r) => ({ date: r.date, value: r.sugar! })),
  };

  // ---- diagnoses grouped by EXACT text and nothing else
  const recurringDiagnoses = db.prepare(
    `SELECT e.working_diagnosis AS text, count(*) AS count, max(v.visit_date) AS lastDate
     FROM encounter e JOIN visit v ON v.id = e.visit_id
     WHERE v.patient_id = ? AND e.working_diagnosis IS NOT NULL AND trim(e.working_diagnosis) != ''
       AND e.deleted_at IS NULL AND v.deleted_at IS NULL
     GROUP BY e.working_diagnosis ORDER BY count DESC, lastDate DESC`)
    .all(visit.patientId) as RecurringDiagnosis[];

  // ---- what they are on now: the most recent encounter that had any
  const latestWithMeds = db.prepare(
    `SELECT e.id AS encounterId, v.visit_date AS visitDate
     FROM encounter e JOIN visit v ON v.id = e.visit_id
     WHERE v.patient_id = ? AND e.deleted_at IS NULL AND v.deleted_at IS NULL
       AND EXISTS (SELECT 1 FROM medication m WHERE m.encounter_id = e.id AND m.deleted_at IS NULL)
     ORDER BY v.visit_date DESC LIMIT 1`).get(visit.patientId) as
    { encounterId: string; visitDate: string } | undefined;

  const timeline = db.prepare(
    `SELECT v.visit_date AS visitDate, c.name AS chamberName,
            e.chief_complaint AS complaint, e.working_diagnosis AS diagnosis
     FROM visit v JOIN chamber c ON c.id = v.chamber_id
     LEFT JOIN encounter e ON e.visit_id = v.id AND e.deleted_at IS NULL
     WHERE v.patient_id = ? AND v.deleted_at IS NULL
     ORDER BY v.visit_date DESC`).all(visit.patientId) as TimelineEntry[];

  const attachmentCount = (db.prepare(
    `SELECT count(*) AS n FROM attachment WHERE patient_id = ? AND deleted_at IS NULL`)
    .get(visit.patientId) as { n: number }).n;

  const waitedMinutes = visit.seenAt === null ? null
    : Math.max(0, Math.round((new Date(visit.seenAt).getTime() - new Date(visit.arrivedAt).getTime()) / 60000));

  return {
    patient: {
      id: patient.id,
      nameBn: patient.nameBn,
      nameEn: patient.nameEn,
      ageYears: patientAgeYears(patient, asOf),
      ageIsApproximate: patient.dob === null,
      sex: patient.sex,
      phone: patient.phone,
    },
    today: {
      visitId: visit.id,
      visitDate: visit.visitDate,
      serialNo: visit.serialNo,
      chamberName: visit.chamberName,
      status: visit.status,
      arrivedAt: visit.arrivedAt,
      waitedMinutes,
      redFlags,
      screening,
      intake: intake === undefined ? null : {
        intakeId: intake.id,
        confirmedAt: intake.confirmedAt,
        confirmedByName: intake.confirmedByName,
        corrections: correctionsFor(db, intake.id),
        recordedByName: intake.recordedByName,
        recordedByRole: intake.recordedByRole,
        startedAt: intake.startedAt,
        completedAt: intake.completedAt,
        helperPresent: intake.helperPresent === null ? null : intake.helperPresent === 1,
        answers: intakeAnswers,
      },
      vitals: todayVitals ?? null,
    },
    previousVitals,
    lastVisit,
    outstandingInvestigations,
    trend,
    recurringDiagnoses,
    currentMedications: latestWithMeds === undefined ? [] : medicationsOf(latestWithMeds.encounterId),
    currentMedicationsFrom: latestWithMeds?.visitDate ?? null,
    timeline,
    totalVisits: timeline.length,
    attachmentCount,
    consent: (() => {
      // Whether this patient ever agreed to any of this being kept, and
      // how they were actually told. A doctor looking at a history has
      // a right to know it was taken with permission.
      const state = consentState(db, visit.patientId, consentVersion ?? '');
      const latest = state.latest.careRecord;
      return {
        careRecord: state.careRecord,
        research: state.research,
        version: latest?.version ?? null,
        decidedAt: latest?.decidedAt ?? null,
        method: latest?.method ?? null,
        givenBy: latest?.givenBy ?? null,
      };
    })(),
  };
}
