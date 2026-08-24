// ===================================================================
// The pilot report.
// ===================================================================
// After twelve weeks somebody has to decide whether this carries on.
// This is the screen that decision is made from, so the one thing it
// must not do is argue for its own continuation.
//
// Three rules, and they are the whole design:
//
//   IT COUNTS, IT DOES NOT CONCLUDE. There is no score, no verdict,
//   no "the pilot was a success". At the end it lists the questions
//   worth asking, because the answers are a clinical and practical
//   judgement that belongs to the doctor and not to his software.
//
//   EVERY NUMBER CARRIES ITS DENOMINATOR. "62%" out of seven cases is
//   a lie told with arithmetic. Below twenty, this reports "4 of 7"
//   and no percentage at all.
//
//   THE FAILURES ARE A SECTION, NOT A FOOTNOTE. Unfinished intakes,
//   patients nobody screened, consultations never confirmed, tests
//   ordered and never resulted, and above all flagged patients who
//   left without being seen. A report that only carries good news is
//   a report nobody should act on.
//
// Nothing here is broken out by anything clinical. It counts what was
// done and how long it took, never what was wrong with anybody.
import type { Db } from '../db/open';
import { dataMode } from '../db/open';
import { backupStatus } from '../backup/backup';
import type { PilotReport, PerPerson } from '../../shared/pilot';

/** Below this many, a percentage is arithmetic pretending to be evidence. */
export const TOO_FEW_FOR_A_PERCENTAGE = 20;

function one(db: Db, sql: string, ...params: unknown[]): number {
  return (db.prepare(sql).get(...params) as { n: number }).n;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : Math.round(((sorted[middle - 1]! + sorted[middle]!) / 2) * 10) / 10;
}

function minutesBetween(from: string, to: string): number | null {
  const start = Date.parse(from);
  const end = Date.parse(to);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
  return Math.round((end - start) / 60000);
}

/**
 * Broken out per person, which is the whole reason every usage row
 * carries who did it. An average across two assistants hides exactly
 * the difference worth seeing: one who asks every question and one
 * who skips half of them are the same number when added together.
 */
function perPerson(db: Db): PerPerson[] {
  const people = db.prepare(
    `SELECT u.id, u.display_name AS name, u.role
     FROM app_user u
     WHERE u.deleted_at IS NULL AND EXISTS (SELECT 1 FROM intake i WHERE i.recorded_by = u.id)
     ORDER BY u.display_name`,
  ).all() as Array<{ id: string; name: string; role: string }>;

  return people.map((person) => {
    const durations = (db.prepare(
      `SELECT started_at AS startedAt, completed_at AS completedAt
       FROM intake WHERE recorded_by = ? AND completed_at IS NOT NULL AND deleted_at IS NULL`,
    ).all(person.id) as Array<{ startedAt: string; completedAt: string }>)
      .map((row) => minutesBetween(row.startedAt, row.completedAt))
      // An intake left open on the desk for two hours is a tablet
      // nobody picked up again, not a two-hour conversation.
      .filter((m): m is number => m !== null && m >= 0 && m < 120);

    return {
      userId: person.id,
      name: person.name,
      role: person.role,
      intakesStarted: one(db, 'SELECT count(*) AS n FROM intake WHERE recorded_by = ? AND deleted_at IS NULL', person.id),
      intakesFinished: one(db,
        'SELECT count(*) AS n FROM intake WHERE recorded_by = ? AND completed_at IS NOT NULL AND deleted_at IS NULL', person.id),
      questionsSkipped: one(db,
        `SELECT count(*) AS n FROM intake_answer a JOIN intake i ON i.id = a.intake_id
         WHERE i.recorded_by = ? AND a.was_skipped = 1`, person.id),
      questionsAsked: one(db,
        `SELECT count(*) AS n FROM intake_answer a JOIN intake i ON i.id = a.intake_id
         WHERE i.recorded_by = ?`, person.id),
      medianMinutes: median(durations),
    };
  });
}

export function buildPilotReport(db: Db, asOf: Date = new Date()): PilotReport {
  const days = db.prepare(
    `SELECT min(visit_date) AS first, max(visit_date) AS last FROM visit WHERE deleted_at IS NULL`,
  ).get() as { first: string | null; last: string | null };

  const chambers = (db.prepare(
    `SELECT DISTINCT c.name FROM visit v JOIN chamber c ON c.id = v.chamber_id
     WHERE v.deleted_at IS NULL ORDER BY c.name`,
  ).all() as Array<{ name: string }>).map((row) => row.name);

  const waits = (db.prepare(
    `SELECT arrived_at AS arrivedAt, seen_at AS seenAt FROM visit
     WHERE seen_at IS NOT NULL AND deleted_at IS NULL`,
  ).all() as Array<{ arrivedAt: string; seenAt: string }>)
    .map((row) => minutesBetween(row.arrivedAt, row.seenAt))
    .filter((m): m is number => m !== null && m < 600);

  const flagsFired = one(db, 'SELECT count(*) AS n FROM red_flag_event');
  const visitsFlagged = one(db,
    `SELECT count(DISTINCT i.visit_id) AS n FROM red_flag_event e JOIN intake i ON i.id = e.intake_id`);
  const flaggedLeftUnseen = one(db,
    `SELECT count(*) AS n FROM audit_log WHERE action = 'flagged_patient_left_unseen'`);

  const consentAsked = one(db, 'SELECT count(DISTINCT patient_id) AS n FROM patient_consent');
  const patients = one(db,
    'SELECT count(*) AS n FROM patient WHERE deleted_at IS NULL AND merged_into_patient_id IS NULL');

  const backup = backupStatus(db, asOf);
  const backupDates = (db.prepare(
    `SELECT timestamp FROM usage_event WHERE event_type = 'backup_taken' ORDER BY timestamp`,
  ).all() as Array<{ timestamp: string }>).map((row) => row.timestamp.slice(0, 10));
  let longestGapDays: number | null = null;
  for (let i = 1; i < backupDates.length; i += 1) {
    const gap = Math.round(
      (Date.parse(`${backupDates[i]!}T00:00:00Z`) - Date.parse(`${backupDates[i - 1]!}T00:00:00Z`)) / 86400000);
    longestGapDays = longestGapDays === null ? gap : Math.max(longestGapDays, gap);
  }

  const gaps: Array<{ what: string; count: number; why: string }> = [];
  const push = (what: string, count: number, why: string) => {
    if (count > 0) gaps.push({ what, count, why });
  };

  push('Intakes started and never finished',
    one(db, 'SELECT count(*) AS n FROM intake WHERE completed_at IS NULL AND deleted_at IS NULL'),
    'The patient was called in, or walked away, part way through the questions. What they did answer is kept.');
  push('Visits with no intake at all',
    one(db, `SELECT count(*) AS n FROM visit v WHERE v.deleted_at IS NULL
             AND NOT EXISTS (SELECT 1 FROM intake i WHERE i.visit_id = v.id AND i.deleted_at IS NULL)`),
    'Nobody asked these patients anything at the desk, so no red flag rule was ever checked for them.');
  push('Consultations written and never confirmed',
    one(db, `SELECT count(*) AS n FROM encounter WHERE doctor_confirmed_at IS NULL AND deleted_at IS NULL`),
    'The doctor never signed these off. They are drafts in the record and show as drafts on the card.');
  push('Patients never asked for permission',
    Math.max(0, patients - consentAsked),
    'Their history is being kept without a recorded decision from them. This is the one a lawyer asks about first.');
  push('Tests ordered and never resulted',
    one(db, `SELECT count(*) AS n FROM investigation i JOIN encounter e ON e.id = i.encounter_id
             JOIN visit v ON v.id = e.visit_id
             WHERE i.result_date IS NULL AND i.deleted_at IS NULL AND v.visit_date <= date('now', '-30 days')`),
    'Ordered more than a month ago with nothing recorded back. Some of these patients never returned.');
  push('Flagged patients who left without being seen',
    flaggedLeftUnseen,
    'The questions raised a warning about these patients and they went home anyway. Every one is worth asking about by name.');

  return {
    madeAt: asOf.toISOString(),
    dataMode: dataMode(db),
    firstDay: days.first,
    lastDay: days.last,
    eveningsHeld: one(db,
      `SELECT count(*) AS n FROM (SELECT DISTINCT visit_date, chamber_id FROM visit WHERE deleted_at IS NULL)`),
    chambers,

    patientsSeen: one(db, `SELECT count(DISTINCT patient_id) AS n FROM visit WHERE deleted_at IS NULL`),
    visits: one(db, 'SELECT count(*) AS n FROM visit WHERE deleted_at IS NULL'),
    newPatients: one(db,
      `SELECT count(*) AS n FROM (SELECT patient_id FROM visit WHERE deleted_at IS NULL
        GROUP BY patient_id HAVING count(*) = 1)`),
    returningVisits: one(db,
      `SELECT count(*) AS n FROM visit v WHERE v.deleted_at IS NULL AND EXISTS (
        SELECT 1 FROM visit earlier WHERE earlier.patient_id = v.patient_id
          AND earlier.visit_date < v.visit_date AND earlier.deleted_at IS NULL)`),

    screening: {
      arrivals: one(db, 'SELECT count(*) AS n FROM visit WHERE deleted_at IS NULL'),
      intakesStarted: one(db, 'SELECT count(*) AS n FROM intake WHERE deleted_at IS NULL'),
      intakesFinished: one(db, 'SELECT count(*) AS n FROM intake WHERE completed_at IS NOT NULL AND deleted_at IS NULL'),
      perPerson: perPerson(db),
    },

    waiting: {
      medianMinutes: median(waits),
      longestMinutes: waits.length === 0 ? null : Math.max(...waits),
      counted: waits.length,
    },

    safety: {
      flagsFired,
      visitsFlagged,
      acknowledgedAtTheDesk: one(db, 'SELECT count(*) AS n FROM red_flag_event WHERE acknowledged_at IS NOT NULL'),
      movedUpTheQueue: one(db, `SELECT count(*) AS n FROM audit_log WHERE action = 'queue_reordered'`),
      flaggedLeftUnseen,
      screeningIncomplete: one(db, `SELECT count(*) AS n FROM audit_log WHERE action = 'red_flag_screening_incomplete'`),
    },

    record: {
      encountersWritten: one(db, 'SELECT count(*) AS n FROM encounter WHERE deleted_at IS NULL'),
      encountersConfirmed: one(db,
        'SELECT count(*) AS n FROM encounter WHERE doctor_confirmed_at IS NOT NULL AND deleted_at IS NULL'),
      intakesConfirmedByDoctor: one(db,
        'SELECT count(*) AS n FROM intake WHERE doctor_confirmed_at IS NOT NULL AND deleted_at IS NULL'),
      answersCorrectedByDoctor: one(db, 'SELECT count(*) AS n FROM intake_correction'),
      prescriptionsPrinted: one(db,
        `SELECT count(*) AS n FROM usage_event WHERE event_type = 'prescription_printed'`),
      prescriptionsReprinted: one(db,
        `SELECT count(*) AS n FROM usage_event WHERE event_type = 'prescription_reprinted'`),
      papersPhotographed: one(db, 'SELECT count(*) AS n FROM attachment WHERE deleted_at IS NULL'),
      patientsWithTwoOrMoreVisits: one(db,
        `SELECT count(*) AS n FROM (SELECT patient_id FROM visit WHERE deleted_at IS NULL
          GROUP BY patient_id HAVING count(*) >= 2)`),
    },

    consent: {
      asked: consentAsked,
      given: one(db,
        `SELECT count(DISTINCT patient_id) AS n FROM patient_consent
         WHERE kind = 'care_record' AND decision = 'given'`),
      declined: one(db,
        `SELECT count(DISTINCT patient_id) AS n FROM patient_consent
         WHERE kind = 'care_record' AND decision = 'declined'`),
      withdrawn: one(db,
        `SELECT count(DISTINCT patient_id) AS n FROM patient_consent
         WHERE kind = 'care_record' AND decision = 'withdrawn'`),
      researchGiven: one(db,
        `SELECT count(DISTINCT patient_id) AS n FROM patient_consent
         WHERE kind = 'research' AND decision = 'given'`),
      neverAsked: Math.max(0, patients - consentAsked),
    },

    backups: {
      taken: backupDates.length,
      verified: one(db, `SELECT count(*) AS n FROM audit_log WHERE action = 'backup_taken'`),
      longestGapDays,
      daysSinceLast: backup.daysSince,
    },

    gaps,
  };
}

/**
 * "4 of 7" rather than "57%", until there are enough of them for a
 * percentage to mean anything.
 */
export function share(n: number, of: number): string {
  if (of === 0) return 'none yet';
  if (of < TOO_FEW_FOR_A_PERCENTAGE) return `${n} of ${of}`;
  return `${Math.round((n / of) * 100)}% (${n} of ${of})`;
}
