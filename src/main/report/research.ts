// ===================================================================
// The de-identified export, for the research the patient agreed to.
// ===================================================================
// The consent asks a second, separate question: may this information
// be used, without your name, to learn how the chamber is working.
// Some patients say yes and some say no, and the ones who said no are
// simply not here.
//
// TWO THINGS THIS FILE IS CAREFUL ABOUT
//
// NO FREE TEXT. Not one field. A complaint typed as "my son Rahim
// brought me in", a diagnosis with a village in it, a note naming a
// relative - prose written in a chamber contains people's names, and
// no amount of intention stops that. So the export carries coded
// answers, rule identifiers, numbers, dates and counts, and nothing
// anybody typed in a sentence.
//
// IT IS CALLED DE-IDENTIFIED, NOT ANONYMOUS. Names, phone numbers and
// addresses are gone, and the patient code is random per export and
// means nothing outside it. But a date of a visit plus a small
// chamber can still point at one person, and pretending otherwise
// would be the sort of comfortable lie this project exists to avoid.
// The note written into the folder says exactly that.
import { randomBytes } from 'node:crypto';
import type { Db } from '../db/open';
import { nowIso } from '../db/clock';
import { patientAgeYears } from '../db/age';
import { recordAudit, type Actor } from '../db/audit';
import { ChamberRecallError } from '../../shared/errors';
import { requireClinicalRole } from '../clinical/access';

export class ResearchExportError extends ChamberRecallError {}

export interface ResearchExport {
  /** One row per visit, already flattened for a spreadsheet. */
  rows: Array<Record<string, string | number | null>>;
  patientsIncluded: number;
  patientsExcluded: number;
  consentVersion: string;
}

const COLUMNS = [
  'patient_code', 'age_years', 'sex', 'visit_date', 'chamber',
  'intake_taken', 'intake_finished', 'questions_answered', 'questions_skipped',
  'rules_fired', 'rule_ids', 'flag_acknowledged', 'left_unseen',
  'waited_minutes', 'systolic', 'diastolic', 'pulse', 'temperature_c',
  'weight_kg', 'blood_sugar', 'spo2',
  'encounter_written', 'encounter_confirmed', 'medicines_prescribed',
  'tests_ordered', 'follow_up_days', 'papers_photographed',
] as const;

function code(): string {
  return randomBytes(6).toString('hex');
}

/**
 * Builds the export. Only patients whose latest research decision, at
 * the wording currently in force, is "given".
 */
export function buildResearchExport(db: Db, consentVersion: string): ResearchExport {
  const consenting = db.prepare(
    `SELECT p.id, p.dob, p.approx_age_years, p.approx_age_recorded_on, p.sex
     FROM patient p
     WHERE p.deleted_at IS NULL AND p.merged_into_patient_id IS NULL
       AND (
         SELECT c.decision FROM patient_consent c
         WHERE c.patient_id = p.id AND c.kind = 'research' AND c.version = ?
         ORDER BY c.decided_at DESC, c.rowid DESC LIMIT 1
       ) = 'given'`,
  ).all(consentVersion) as Array<Record<string, string | number | null>>;

  const allPatients = (db.prepare(
    'SELECT count(*) AS n FROM patient WHERE deleted_at IS NULL AND merged_into_patient_id IS NULL',
  ).get() as { n: number }).n;

  const rows: Array<Record<string, string | number | null>> = [];

  for (const patient of consenting) {
    const patientCode = code();
    const visits = db.prepare(
      `SELECT v.id, v.visit_date AS visitDate, v.arrived_at AS arrivedAt, v.seen_at AS seenAt,
              v.status, c.name AS chamber
       FROM visit v JOIN chamber c ON c.id = v.chamber_id
       WHERE v.patient_id = ? AND v.deleted_at IS NULL ORDER BY v.visit_date`,
    ).all(patient.id) as Array<Record<string, string | null>>;

    for (const visit of visits) {
      const visitId = String(visit.id);
      const intake = db.prepare(
        'SELECT id, completed_at AS completedAt FROM intake WHERE visit_id = ? AND deleted_at IS NULL',
      ).get(visitId) as { id: string; completedAt: string | null } | undefined;

      const answered = intake === undefined ? 0 : (db.prepare(
        'SELECT count(*) AS n FROM intake_answer WHERE intake_id = ? AND was_skipped = 0',
      ).get(intake.id) as { n: number }).n;
      const skipped = intake === undefined ? 0 : (db.prepare(
        'SELECT count(*) AS n FROM intake_answer WHERE intake_id = ? AND was_skipped = 1',
      ).get(intake.id) as { n: number }).n;

      const flags = intake === undefined ? [] : db.prepare(
        `SELECT rule_id AS ruleId, rule_version AS ruleVersion, acknowledged_at AS acknowledgedAt
         FROM red_flag_event WHERE intake_id = ? ORDER BY fired_at`,
      ).all(intake.id) as Array<{ ruleId: string; ruleVersion: string; acknowledgedAt: string | null }>;

      const vitals = db.prepare(
        `SELECT systolic_bp AS systolic, diastolic_bp AS diastolic, pulse, temperature_c AS temperatureC,
                weight_kg AS weightKg, random_blood_sugar AS sugar, spo2
         FROM vitals WHERE visit_id = ? AND deleted_at IS NULL ORDER BY recorded_at DESC LIMIT 1`,
      ).get(visitId) as Record<string, number | null> | undefined;

      const encounter = db.prepare(
        `SELECT id, doctor_confirmed_at AS confirmedAt, follow_up_after_days AS followUp
         FROM encounter WHERE visit_id = ? AND deleted_at IS NULL`,
      ).get(visitId) as { id: string; confirmedAt: string | null; followUp: number | null } | undefined;

      const seenAt = visit.seenAt ?? null;
      const arrivedAt = visit.arrivedAt ?? null;
      const waited = seenAt === null || arrivedAt === null ? null
        : Math.round((Date.parse(seenAt) - Date.parse(arrivedAt)) / 60000);

      rows.push({
        patient_code: patientCode,
        // The age at that visit, not today's age.
        age_years: patientAgeYears({
          dob: patient.dob as string | null,
          approx_age_years: patient.approx_age_years as number | null,
          approx_age_recorded_on: patient.approx_age_recorded_on as string | null,
        }, new Date(`${visit.visitDate}T12:00:00Z`)),
        sex: patient.sex as string | null,
        visit_date: String(visit.visitDate),
        chamber: String(visit.chamber),
        intake_taken: intake === undefined ? 0 : 1,
        intake_finished: intake?.completedAt != null ? 1 : 0,
        questions_answered: answered,
        questions_skipped: skipped,
        rules_fired: flags.length,
        // Rule identifiers, which are the doctor's own names for his
        // rules. Not free text: they come from a fixed file.
        rule_ids: flags.map((f) => `${f.ruleId}@${f.ruleVersion}`).join(' '),
        flag_acknowledged: flags.length === 0 ? null : flags.every((f) => f.acknowledgedAt !== null) ? 1 : 0,
        left_unseen: visit.status === 'left' ? 1 : 0,
        waited_minutes: waited !== null && waited >= 0 && waited < 600 ? waited : null,
        systolic: vitals?.systolic ?? null,
        diastolic: vitals?.diastolic ?? null,
        pulse: vitals?.pulse ?? null,
        temperature_c: vitals?.temperatureC ?? null,
        weight_kg: vitals?.weightKg ?? null,
        blood_sugar: vitals?.sugar ?? null,
        spo2: vitals?.spo2 ?? null,
        encounter_written: encounter === undefined ? 0 : 1,
        encounter_confirmed: encounter?.confirmedAt != null ? 1 : 0,
        medicines_prescribed: encounter === undefined ? 0 : (db.prepare(
          'SELECT count(*) AS n FROM medication WHERE encounter_id = ? AND deleted_at IS NULL',
        ).get(encounter.id) as { n: number }).n,
        tests_ordered: encounter === undefined ? 0 : (db.prepare(
          'SELECT count(*) AS n FROM investigation WHERE encounter_id = ? AND deleted_at IS NULL',
        ).get(encounter.id) as { n: number }).n,
        follow_up_days: encounter?.followUp ?? null,
        papers_photographed: (db.prepare(
          'SELECT count(*) AS n FROM attachment WHERE visit_id = ? AND deleted_at IS NULL',
        ).get(visitId) as { n: number }).n,
      });
    }
  }

  return {
    rows,
    patientsIncluded: consenting.length,
    patientsExcluded: allPatients - consenting.length,
    consentVersion,
  };
}

function csvCell(value: string | number | null): string {
  if (value === null) return '';
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(exported: ResearchExport): string {
  const header = COLUMNS.join(',');
  const lines = exported.rows.map((row) => COLUMNS.map((column) => csvCell(row[column] ?? null)).join(','));
  return [header, ...lines].join('\n') + '\n';
}

export function researchReadme(exported: ResearchExport, madeAt: string): string {
  return `CHAMBER RECALL - DE-IDENTIFIED EXPORT

Made on ${madeAt.slice(0, 10)}.

WHO IS IN IT
------------
${exported.patientsIncluded} patients, every one of whom was asked
separately whether their information could be used this way and said
yes, against consent wording version ${exported.consentVersion}.
${exported.patientsExcluded} patients are not in it: they said no, were
never asked, or answered against different wording.

Anybody who withdraws that permission is excluded from every export
made afterwards. This file is a snapshot and cannot be recalled, which
is why it should not be copied further than it needs to go.

WHAT IS IN IT
-------------
One row per visit. Coded answers, rule identifiers, measurements,
counts and dates.

An empty cell means nothing was recorded, and is never a zero. The
age_years column holds the age AT that visit: where the age is an
estimate rather than a date of birth, it is counted forward or back
from the day the estimate was given, and left empty where even that
cannot give an answer.

WHAT IS DELIBERATELY NOT IN IT
------------------------------
No names, phone numbers or addresses. And no free text of any kind -
not the complaint in the patient's own words, not the examination, not
the diagnosis, not any note. Prose written in a chamber contains
people's names whether anybody intends it to or not.

The patient_code column is random, made fresh for this export, and
means nothing outside this file. The same patient in two exports has
two different codes.

THIS IS DE-IDENTIFIED, NOT ANONYMOUS
------------------------------------
A visit date plus a small chamber can still point at one person.
Handle this file as personal information: keep it where the records
are kept, do not email it, and aggregate it before it is shown to
anybody outside the chamber.
`;
}

export function recordResearchExport(
  db: Db, exported: ResearchExport, actor: Actor, at: string = nowIso(),
): void {
  requireClinicalRole(actor, 'make a research export');
  recordAudit(db, {
    actor, action: 'research_export_made', entity: 'app_meta', entityId: null,
    details: {
      patients: exported.patientsIncluded,
      excluded: exported.patientsExcluded,
      rows: exported.rows.length,
      consent_version: exported.consentVersion,
      at,
    },
  });
}
