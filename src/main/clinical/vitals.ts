// ===================================================================
// Vitals.
// ===================================================================
// Seven numbers, taken in the chamber, stored once per visit.
//
// Two rules run through all of it:
//
//   The unit is never guessed. Temperature is typed in whichever scale
//   the thermometer reads and converted here, by the same code the
//   screen uses for the echo underneath the box. See temperature.ts
//   for why guessing from the value is unacceptable.
//
//   A value that looks wrong is QUESTIONED, never refused and never
//   corrected. Nothing here says a reading is dangerous, or high, or
//   worrying - that is a clinical judgement and this software does not
//   make clinical judgements. It says "that is outside what a machine
//   can read, check it", which is a typing question.
import type { Db } from '../db/open';
import { newId } from '../db/ids';
import { nowIso } from '../db/clock';
import { recordAudit, type Actor } from '../db/audit';
import { requireClinicalRole } from './access';
import { toCelsius } from '../vitals/temperature';
import type { VitalsInput, VitalsQuestion, VitalsView } from '../../shared/clinical';

/**
 * The range a machine or a person can actually produce. Not a clinical
 * normal range - deliberately much wider - because the only thing
 * being caught here is a typing mistake.
 */
const RECORDABLE = {
  systolic: { low: 50, high: 300, unit: 'mmHg' },
  diastolic: { low: 20, high: 200, unit: 'mmHg' },
  pulse: { low: 20, high: 250, unit: 'beats a minute' },
  weightKg: { low: 1, high: 300, unit: 'kg' },
  heightCm: { low: 30, high: 250, unit: 'cm' },
  randomBloodSugar: { low: 1, high: 45, unit: 'mmol/L' },
  spo2: { low: 40, high: 100, unit: '%' },
} as const;

const LABEL: Record<string, string> = {
  systolic: 'The upper blood pressure number',
  diastolic: 'The lower blood pressure number',
  pulse: 'The pulse',
  weightKg: 'The weight',
  heightCm: 'The height',
  randomBloodSugar: 'The blood sugar',
  spo2: 'The oxygen reading',
  temperature: 'The temperature',
};

export function questionsAbout(input: VitalsInput): VitalsQuestion[] {
  const questions: VitalsQuestion[] = [];

  for (const [field, range] of Object.entries(RECORDABLE)) {
    const value = input[field as keyof typeof RECORDABLE];
    if (value === null || value === undefined) continue;
    if (value < range.low || value > range.high) {
      questions.push({
        field,
        question: `${LABEL[field]} reads ${value} ${range.unit}, which is outside what a machine can show (${range.low} to ${range.high}). Check what you typed — it will be saved as it is.`,
      });
    }
  }

  // The two that are wrong as a pair rather than one at a time.
  if (input.systolic !== null && input.diastolic !== null && input.diastolic >= input.systolic) {
    questions.push({
      field: 'diastolic',
      question: `The blood pressure reads ${input.systolic} over ${input.diastolic}, with the lower number the same or bigger than the upper one. Check whether they are the right way round — it will be saved as it is.`,
    });
  }

  if (input.temperature !== null) {
    const celsius = toCelsius(input.temperature.typed, input.temperature.unit);
    if (celsius < 30 || celsius > 45) {
      const shown = input.temperature.unit === 'F'
        ? `${input.temperature.typed} °F, which is ${celsius.toFixed(1)} °C,`
        : `${celsius.toFixed(1)} °C`;
      questions.push({
        field: 'temperature',
        question: `The temperature reads ${shown} which is outside the range a person's temperature can be. Check whether the scale is the right one — it will be saved as it is.`,
      });
    }
  }

  return questions;
}

function isEmpty(input: VitalsInput): boolean {
  return input.systolic === null && input.diastolic === null && input.pulse === null
    && input.temperature === null && input.weightKg === null && input.heightCm === null
    && input.randomBloodSugar === null && input.spo2 === null
    && (input.notes === null || input.notes.trim() === '');
}

/**
 * Writes the vitals for this visit, creating the row the first time
 * and updating it after that. Returns the id, or null when there was
 * nothing to save.
 *
 * A changed number is recorded in the audit log with what it was and
 * what it became, because a blood pressure that changes after the fact
 * is exactly the kind of thing somebody may need to account for later.
 */
export function saveVitals(db: Db, visitId: string, input: VitalsInput, actor: Actor, at: string = nowIso()): string | null {
  requireClinicalRole(actor, 'record vitals');

  const existing = db.prepare(
    `SELECT id, systolic_bp AS systolic, diastolic_bp AS diastolic, pulse, temperature_c AS temperatureC,
            weight_kg AS weightKg, height_cm AS heightCm, random_blood_sugar AS randomBloodSugar,
            spo2, notes
     FROM vitals WHERE visit_id = ? AND deleted_at IS NULL ORDER BY recorded_at DESC LIMIT 1`,
  ).get(visitId) as Record<string, number | string | null> | undefined;

  if (existing === undefined && isEmpty(input)) return null;

  const celsius = input.temperature === null ? null : toCelsius(input.temperature.typed, input.temperature.unit);
  const notes = input.notes === null || input.notes.trim() === '' ? null : input.notes.trim();

  if (existing === undefined) {
    const id = newId();
    const write = db.transaction(() => {
      db.prepare(
        `INSERT INTO vitals (id, visit_id, recorded_by, recorded_at, systolic_bp, diastolic_bp, pulse,
           temperature_c, weight_kg, height_cm, random_blood_sugar, spo2, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, visitId, actor.id, at, input.systolic, input.diastolic, input.pulse, celsius,
        input.weightKg, input.heightCm, input.randomBloodSugar, input.spo2, notes, at, at);
      recordAudit(db, {
        actor, action: 'vitals_recorded', entity: 'vitals', entityId: id, details: { visit_id: visitId },
      });
    });
    write();
    return id;
  }

  const id = String(existing.id);
  const changes: Record<string, { was: unknown; now: unknown }> = {};
  // Named by database column, so an audit entry read months later
  // points at something that still exists.
  const compare: Array<[string, unknown, unknown]> = [
    ['systolic_bp', existing.systolic, input.systolic],
    ['diastolic_bp', existing.diastolic, input.diastolic],
    ['pulse', existing.pulse, input.pulse],
    ['temperature_c', existing.temperatureC, celsius],
    ['weight_kg', existing.weightKg, input.weightKg],
    ['height_cm', existing.heightCm, input.heightCm],
    ['random_blood_sugar', existing.randomBloodSugar, input.randomBloodSugar],
    ['spo2', existing.spo2, input.spo2],
    ['notes', existing.notes, notes],
  ];
  for (const [name, was, now] of compare) {
    if ((was ?? null) !== (now ?? null)) changes[name] = { was: was ?? null, now: now ?? null };
  }
  if (Object.keys(changes).length === 0) return id;

  const write = db.transaction(() => {
    db.prepare(
      `UPDATE vitals SET systolic_bp = ?, diastolic_bp = ?, pulse = ?, temperature_c = ?, weight_kg = ?,
         height_cm = ?, random_blood_sugar = ?, spo2 = ?, notes = ?, updated_at = ? WHERE id = ?`,
    ).run(input.systolic, input.diastolic, input.pulse, celsius, input.weightKg, input.heightCm,
      input.randomBloodSugar, input.spo2, notes, at, id);
    recordAudit(db, {
      actor, action: 'vitals_changed', entity: 'vitals', entityId: id, details: { visit_id: visitId, changes },
    });
  });
  write();
  return id;
}

export function vitalsFor(db: Db, visitId: string): VitalsView {
  const row = db.prepare(
    `SELECT v.id, v.systolic_bp AS systolic, v.diastolic_bp AS diastolic, v.pulse,
            v.temperature_c AS temperatureC, v.weight_kg AS weightKg, v.height_cm AS heightCm,
            v.random_blood_sugar AS randomBloodSugar, v.spo2, v.notes, v.recorded_at AS recordedAt,
            u.display_name AS recordedByName
     FROM vitals v LEFT JOIN app_user u ON u.id = v.recorded_by
     WHERE v.visit_id = ? AND v.deleted_at IS NULL ORDER BY v.recorded_at DESC LIMIT 1`,
  ).get(visitId) as Record<string, string | number | null> | undefined;

  const empty: VitalsView = {
    id: null, systolic: null, diastolic: null, pulse: null, temperature: null,
    weightKg: null, heightCm: null, randomBloodSugar: null, spo2: null, notes: null,
    temperatureC: null, recordedByName: null, recordedAt: null,
  };
  if (row === undefined) return empty;

  const celsius = row.temperatureC === null ? null : Number(row.temperatureC);
  return {
    id: String(row.id),
    systolic: row.systolic as number | null,
    diastolic: row.diastolic as number | null,
    pulse: row.pulse as number | null,
    // Stored Celsius is handed back as Celsius. Whoever typed °F sees
    // their own number echoed while they type; what comes back out of
    // the record is the one scale it is kept in.
    temperature: celsius === null ? null : { typed: celsius, unit: 'C' },
    temperatureC: celsius,
    weightKg: row.weightKg as number | null,
    heightCm: row.heightCm as number | null,
    randomBloodSugar: row.randomBloodSugar as number | null,
    spo2: row.spo2 as number | null,
    notes: row.notes as string | null,
    recordedByName: row.recordedByName as string | null,
    recordedAt: row.recordedAt as string | null,
  };
}
