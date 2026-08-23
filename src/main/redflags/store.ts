// ===================================================================
// Running the rules against a real intake, and recording what happened.
// ===================================================================
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from '../db/open';
import { newId } from '../db/ids';
import { nowIso } from '../db/clock';
import { recordAudit, type Actor } from '../db/audit';
import { patientAgeYears } from '../db/age';
import { rulebookPath } from '../paths';
import { loadRulebook, KNOWN_QUESTION_KEYS, type LoadOutcome, type Rulebook } from './rulebook';
import { evaluateRulebook, type Facts, type RulebookResult } from './evaluate';

/** The template shipped with the application, used on first run only. */
function shippedTemplatePath(): string {
  return join(__dirname, '..', '..', '..', 'config', 'red_flags.yaml');
}

/**
 * Puts the rules template into the data folder the first time, and
 * never touches it again. Overwriting would silently replace rules a
 * clinician approved with placeholders.
 */
export function installRulebookTemplateIfMissing(dir: string): boolean {
  const target = rulebookPath(dir);
  if (existsSync(target)) return false;
  copyFileSync(shippedTemplatePath(), target);
  return true;
}

export function loadRulebookFromDisk(dir: string, questionKeys?: readonly string[]): LoadOutcome {
  const path = rulebookPath(dir);
  if (!existsSync(path)) {
    return {
      rulebook: null,
      problems: [{
        line: null,
        where: 'the rules file',
        problem: 'The red flag rules file is missing.',
        whatToDo: `It should be at ${path}. Restore it from a backup, or reinstall the software to get a fresh template - but note that a fresh template contains only placeholders and will need a doctor's approval again.`,
      }],
    };
  }
  return loadRulebook(readFileSync(path, 'utf8'), path, questionKeys ?? KNOWN_QUESTION_KEYS);
}

/** Gathers everything the rules are allowed to look at for one intake. */
export function factsForIntake(db: Db, intakeId: string, asOf: Date = new Date()): Facts {
  const answerRows = db.prepare(
    `SELECT question_key, answer_value, answer_free_text, was_skipped FROM intake_answer WHERE intake_id = ?`,
  ).all(intakeId) as Array<{ question_key: string; answer_value: string | null; answer_free_text: string | null; was_skipped: number }>;

  const answers: Facts['answers'] = {};
  for (const row of answerRows) {
    answers[row.question_key] = {
      value: row.answer_value,
      freeText: row.answer_free_text,
      skipped: row.was_skipped === 1,
    };
  }

  const patient = db.prepare(
    `SELECT p.dob, p.approx_age_years, p.approx_age_recorded_on, p.sex
     FROM intake i JOIN visit v ON v.id = i.visit_id JOIN patient p ON p.id = v.patient_id
     WHERE i.id = ?`,
  ).get(intakeId) as { dob: string | null; approx_age_years: number | null; approx_age_recorded_on: string | null; sex: string | null } | undefined;

  return {
    answers,
    patient: {
      ageYears: patient === undefined ? null : patientAgeYears(patient, asOf),
      sex: patient?.sex ?? null,
    },
  };
}

export interface FiredFlag {
  eventId: string;
  ruleId: string;
  ruleVersion: string;
  message: { bn: string; en: string };
}

export interface ScreeningOutcome extends RulebookResult {
  firedFlags: FiredFlag[];
}

/**
 * Runs every rule against one intake and writes down what each of them
 * decided - including the ones that did not fire, and the ones that
 * could not be checked at all.
 *
 * All of it happens in one transaction with the alert records, so there
 * is no moment where an alert exists without the evaluation that
 * produced it, or the other way round.
 */
export function screenIntake(
  db: Db, rulebook: Rulebook, intakeId: string, actor: Actor, at: string = nowIso(),
): ScreeningOutcome {
  const facts = factsForIntake(db, intakeId, new Date(at));
  const outcome = evaluateRulebook(rulebook, facts);
  const firedFlags: FiredFlag[] = [];

  const write = db.transaction(() => {
    const insEval = db.prepare(
      `INSERT INTO red_flag_evaluation (id, intake_id, rule_id, rule_version, rulebook_checksum, evaluated_at, outcome, unknown_questions)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    const insEvent = db.prepare(
      `INSERT INTO red_flag_event (id, intake_id, rule_id, rule_version, fired_at) VALUES (?, ?, ?, ?, ?)`);

    for (const result of outcome.results) {
      insEval.run(newId(), intakeId, result.ruleId, result.ruleVersion, rulebook.checksum, at,
        result.outcome, result.unknownQuestions.length === 0 ? null : result.unknownQuestions.join(','));
    }

    // An intake is screened repeatedly - after each answer - so that an
    // alert appears as early as possible rather than at the end. That
    // means the same rule matches again on every later answer, and
    // without this check the assistant would be shown the same warning
    // over and over and the doctor's queue would fill with copies of
    // one alert. The FIRST time it fired is the one that is recorded.
    const alreadyFired = db.prepare(
      'SELECT id FROM red_flag_event WHERE intake_id = ? AND rule_id = ? AND rule_version = ?');

    for (const rule of outcome.fired) {
      const existing = alreadyFired.get(intakeId, rule.id, rule.version) as { id: string } | undefined;
      if (existing !== undefined) {
        firedFlags.push({ eventId: existing.id, ruleId: rule.id, ruleVersion: rule.version, message: rule.message });
        continue;
      }
      const eventId = newId();
      insEvent.run(eventId, intakeId, rule.id, rule.version, at);
      firedFlags.push({ eventId, ruleId: rule.id, ruleVersion: rule.version, message: rule.message });
      recordAudit(db, {
        actor, action: 'red_flag_fired', entity: 'red_flag_event', entityId: eventId,
        details: { rule_id: rule.id, rule_version: rule.version, rulebook_checksum: rulebook.checksum, intake_id: intakeId },
      });
    }

    if (outcome.screeningIncomplete) {
      recordAudit(db, {
        actor, action: 'red_flag_screening_incomplete', entity: 'intake', entityId: intakeId,
        details: { missing_questions: outcome.missingQuestions, rulebook_checksum: rulebook.checksum },
      });
    }
  });
  write();

  return { ...outcome, firedFlags };
}

/**
 * The assistant has read the full-screen warning and tapped to confirm.
 * Recorded with who they were and when. This does not clear anything:
 * the doctor's alert stays until the patient has been seen.
 */
export function acknowledgeRedFlag(db: Db, eventId: string, actor: Actor, at: string = nowIso()): void {
  const existing = db.prepare('SELECT acknowledged_at FROM red_flag_event WHERE id = ?').get(eventId) as
    { acknowledged_at: string | null } | undefined;
  if (existing === undefined) throw new Error(`no red flag event with id ${eventId}`);
  // Acknowledging twice is not an error, but the first acknowledgement
  // is the one that counts and it is never overwritten.
  if (existing.acknowledged_at !== null) return;

  const write = db.transaction(() => {
    db.prepare('UPDATE red_flag_event SET acknowledged_by = ?, acknowledged_at = ? WHERE id = ?')
      .run(actor.id, at, eventId);
    recordAudit(db, {
      actor, action: 'red_flag_acknowledged', entity: 'red_flag_event', entityId: eventId, details: { acknowledged_at: at },
    });
  });
  write();
}

export interface QueueFlag {
  eventId: string;
  visitId: string;
  patientId: string;
  patientName: string | null;
  ruleId: string;
  ruleVersion: string;
  firedAt: string;
  acknowledgedAt: string | null;
}

/**
 * Red flags for patients who are still waiting or in the chamber. This
 * is what makes the doctor's alert persistent: it is derived from the
 * queue every time it is asked for, so it cannot be dismissed away.
 */
export function activeQueueFlags(db: Db, visitDate: string): QueueFlag[] {
  return db.prepare(
    `SELECT e.id AS eventId, v.id AS visitId, p.id AS patientId,
            COALESCE(p.full_name_bn, p.full_name_en) AS patientName,
            e.rule_id AS ruleId, e.rule_version AS ruleVersion,
            e.fired_at AS firedAt, e.acknowledged_at AS acknowledgedAt
     FROM red_flag_event e
     JOIN intake i  ON i.id = e.intake_id
     JOIN visit v   ON v.id = i.visit_id
     JOIN patient p ON p.id = v.patient_id
     WHERE v.visit_date = ? AND v.status IN ('waiting', 'in_chamber') AND v.deleted_at IS NULL
     ORDER BY e.fired_at`,
  ).all(visitDate) as QueueFlag[];
}
