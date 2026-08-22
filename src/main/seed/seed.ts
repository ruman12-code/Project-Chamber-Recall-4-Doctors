// ===================================================================
// Synthetic practice data.
// ===================================================================
// Why this exists: every screen in this project gets judged against
// realistic volume, not three test records. A Recall Card that looks
// fine with two visits and falls apart with eighteen months of history
// is a Recall Card that fails in the chamber.
//
// Three properties this data deliberately has, because they are the
// awkward cases the software has to survive:
//
//   1. SHARED PHONE NUMBERS. Families share handsets. Several patients
//      here have the same number as a relative. Patient search must
//      still return a list and must never auto-select.
//
//   2. DUPLICATE PATIENTS. The same person registered twice with a
//      slightly different spelling. Duplicates are inevitable in a busy
//      chamber, so the merge tool needs real ones to be tested against.
//
//   3. DIFFERENT ASSISTANTS BEHAVING DIFFERENTLY. One front desk user
//      here is noticeably faster and skips far more questions than the
//      other. The pilot report has to be able to see that. If the data
//      were uniform, a report that averages everyone together would
//      look correct.
//
// The data is deterministic: the same seed value always produces the
// same 300 patients, so a bug found in a demo can be reproduced.
// ===================================================================

import type { Db } from '../db/open';
import { setMeta, dataMode } from '../db/open';
import { newId } from '../db/ids';
import { normaliseName, normalisePhone } from '../db/names';
import { recordAudit } from '../db/audit';
import { recordUsage } from '../db/usage';
import { SeedRefusedError } from '../../shared/errors';
import type { Rulebook } from '../redflags/rulebook';
import { screenIntake } from '../redflags/store';
import { GIVEN_MALE, GIVEN_FEMALE, AREAS } from './names';
import * as V from './demo-vocabulary';

/** Small deterministic random number generator (mulberry32). */
function makeRandom(seed: number) {
  let a = seed >>> 0;
  return function random(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = () => number;
const pick = <T>(rng: Rng, xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)]!;
const intBetween = (rng: Rng, lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));
const chance = (rng: Rng, p: number) => rng() < p;
const round1 = (n: number) => Math.round(n * 10) / 10;

function isoAt(day: Date, hour: number, minute: number): string {
  const d = new Date(day);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}
function dateOnly(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export interface SeedOptions {
  patientCount?: number;
  /** Change this to get a different but equally reproducible dataset. */
  randomSeed?: number;
  /** How far back the history runs. The spec asks for four years. */
  years?: number;
  onProgress?: (message: string) => void;
  /**
   * When given, every seeded intake is screened with the REAL rule
   * evaluator, exactly as a live intake would be. Nothing is faked:
   * the alerts in the practice database are produced by running the
   * rules file over the practice answers.
   */
  rulebook?: Rulebook | null;
}

export interface SeedResult {
  chambers: number;
  users: number;
  patients: number;
  visits: number;
  encounters: number;
  vitals: number;
  medications: number;
  investigations: number;
  outstandingInvestigations: number;
  intakes: number;
  duplicatePairs: number;
  sharedPhoneGroups: number;
  ruleEvaluations: number;
  redFlagsFired: number;
  screeningsIncomplete: number;
}

/**
 * A per-patient physiological baseline with a slow trend, so that the
 * vitals sparklines on the Recall Card show something a doctor would
 * actually recognise: a blood pressure creeping up over two years, a
 * weight falling, a sugar staying flat. Random numbers per visit would
 * produce noise, and noise would make the sparkline look useless when
 * the problem was the data, not the chart.
 */
interface Physiology {
  systolic0: number; systolicPerYear: number;
  diastolic0: number; diastolicPerYear: number;
  weight0: number; weightPerYear: number;
  sugar0: number; sugarPerYear: number;
  pulse0: number;
}

function makePhysiology(rng: Rng, ageYears: number): Physiology {
  const older = ageYears > 50;
  return {
    systolic0: intBetween(rng, older ? 118 : 105, older ? 155 : 130),
    systolicPerYear: chance(rng, 0.45) ? round1(rng() * 5) : round1(-rng() * 2),
    diastolic0: intBetween(rng, 68, 95),
    diastolicPerYear: round1(rng() * 2 - 0.6),
    weight0: round1(intBetween(rng, 44, 88) + rng()),
    weightPerYear: round1(rng() * 4 - 2),
    sugar0: round1(intBetween(rng, 4, 12) + rng()),
    sugarPerYear: chance(rng, 0.3) ? round1(rng()) : round1(-rng() * 0.3),
    pulse0: intBetween(rng, 62, 96),
  };
}

export function seedDatabase(db: Db, options: SeedOptions = {}): SeedResult {
  const patientCount = options.patientCount ?? 300;
  const years = options.years ?? 4;
  const rng = makeRandom(options.randomSeed ?? 20260322);
  const report = options.onProgress ?? (() => {});

  // ---- Guard. This is the line between practice data and real patients.
  if (dataMode(db) === 'live') {
    throw new SeedRefusedError(
      'This database is marked as live and may hold real patient records. Practice data can only be written into a database created in demo mode. Create a separate demo database instead.',
    );
  }
  const existing = db.prepare('SELECT count(*) AS n FROM patient').get() as { n: number };
  if (existing.n > 0) {
    throw new SeedRefusedError(
      `This database already contains ${existing.n} patient records. Seeding would mix practice data into them. Start from an empty database.`,
    );
  }

  const system = { id: null, role: 'system' as const };
  const now = new Date();
  const startDate = new Date(now);
  startDate.setFullYear(startDate.getFullYear() - years);

  const result: SeedResult = {
    chambers: 0, users: 0, patients: 0, visits: 0, encounters: 0, vitals: 0,
    medications: 0, investigations: 0, outstandingInvestigations: 0, intakes: 0,
    duplicatePairs: 0, sharedPhoneGroups: 0,
    ruleEvaluations: 0, redFlagsFired: 0, screeningsIncomplete: 0,
  };

  const insertAll = db.transaction(() => {
    // ---------------- chambers ----------------
    const chambers = [
      { id: newId(), name: 'Green Life Chamber, Dhanmondi' },
      { id: newId(), name: 'Al-Shifa Chamber, Savar' },
    ];
    for (const c of chambers) {
      db.prepare('INSERT INTO chamber (id, name, letterhead_config_json, created_at) VALUES (?, ?, NULL, ?)')
        .run(c.id, c.name, isoAt(startDate, 9, 0));
      recordAudit(db, { actor: system, action: 'chamber_created', entity: 'chamber', entityId: c.id, details: { name: c.name, source: 'seed' } });
    }
    result.chambers = chambers.length;

    // ---------------- users ----------------
    // Two front desk assistants with deliberately different habits, so
    // the pilot report has a real difference to expose.
    const users = [
      { id: newId(), display_name: 'Dr. Ashraful Haque', role: 'doctor' as const, speed: 1, skip: 0 },
      { id: newId(), display_name: 'Nusrat (clinical assistant)', role: 'clinical_assistant' as const, speed: 1, skip: 0 },
      { id: newId(), display_name: 'Jahid (front desk)', role: 'front_desk' as const, speed: 1.0, skip: 0.12 },
      { id: newId(), display_name: 'Shopna (front desk)', role: 'front_desk' as const, speed: 0.45, skip: 0.55 },
    ];
    for (const u of users) {
      db.prepare('INSERT INTO app_user (id, display_name, role, is_active, created_at) VALUES (?, ?, ?, 1, ?)')
        .run(u.id, u.display_name, u.role, isoAt(startDate, 9, 0));
      recordAudit(db, { actor: system, action: 'user_created', entity: 'app_user', entityId: u.id, details: { role: u.role, source: 'seed' } });
    }
    result.users = users.length;
    const doctor = users[0]!;
    const assistant = users[1]!;
    const frontDesk = [users[2]!, users[3]!];

    // ---------------- patients ----------------
    interface P { id: string; sex: 'male' | 'female'; ageAtStart: number; phys: Physiology; phone: string | null }
    const patients: P[] = [];
    const sharedPhonePool: string[] = [];

    const insertPatient = db.prepare(
      `INSERT INTO patient (id, full_name_bn, full_name_en, search_name_bn, search_name_en, phone,
         dob, approx_age_years, approx_age_recorded_on, sex, address_free_text,
         created_at, created_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    for (let i = 0; i < patientCount; i++) {
      const sex: 'male' | 'female' = chance(rng, 0.48) ? 'male' : 'female';
      const name = sex === 'male' ? pick(rng, GIVEN_MALE) : pick(rng, GIVEN_FEMALE);
      const area = pick(rng, AREAS);
      const age = intBetween(rng, 2, 84);

      // Roughly one patient in eight shares a handset with someone
      // already registered - a son's number, a shared family phone.
      let phone: string | null;
      if (sharedPhonePool.length > 0 && chance(rng, 0.12)) {
        phone = pick(rng, sharedPhonePool);
        result.sharedPhoneGroups++;
      } else if (chance(rng, 0.04)) {
        phone = null; // some patients simply have no number
      } else {
        phone = `01${intBetween(rng, 3, 9)}${String(intBetween(rng, 10000000, 99999999)).padStart(8, '0')}`;
        if (chance(rng, 0.35)) sharedPhonePool.push(phone);
      }

      // Age is recorded as a date of birth when the patient knows it,
      // and as an approximate age otherwise, which is the common case.
      const knowsDob = chance(rng, 0.55);
      const dob = knowsDob ? dateOnly(new Date(now.getFullYear() - age, intBetween(rng, 0, 11), intBetween(rng, 1, 28))) : null;
      const createdAt = isoAt(new Date(startDate.getTime() + rng() * (now.getTime() - startDate.getTime())), 10, 0);

      const id = newId();
      insertPatient.run(
        id, name.bn, name.en, normaliseName(name.bn), normaliseName(name.en),
        phone, dob, knowsDob ? null : age, knowsDob ? null : createdAt.slice(0, 10),
        sex, area.bn, createdAt, pick(rng, frontDesk).id, createdAt,
      );
      recordAudit(db, { actor: system, action: 'patient_created', entity: 'patient', entityId: id, details: { source: 'seed' } });

      patients.push({ id, sex, ageAtStart: Math.max(0, age - years), phys: makePhysiology(rng, age), phone });
    }

    // Deliberate duplicates: the same person registered a second time
    // with a different spelling and sometimes a different phone. These
    // are what the merge tool in milestone 4 will be tested against.
    const duplicateCount = Math.max(4, Math.round(patientCount * 0.04));
    for (let i = 0; i < duplicateCount; i++) {
      const original = pick(rng, patients);
      const row = db.prepare('SELECT * FROM patient WHERE id = ?').get(original.id) as Record<string, unknown>;
      const enName = String(row.full_name_en ?? '');
      // A plausible re-spelling, the way a second front desk entry drifts.
      const respelled = enName.replace(/Mohammad/, 'Md.').replace(/Hossain/, 'Hosen').replace(/Akter/, 'Aktar').replace(/Begum/, 'Begom');
      const id = newId();
      const createdAt = isoAt(new Date(startDate.getTime() + rng() * (now.getTime() - startDate.getTime())), 11, 0);
      insertPatient.run(
        id, row.full_name_bn, respelled === enName ? `${enName} ` : respelled,
        normaliseName(String(row.full_name_bn ?? '')), normaliseName(respelled),
        chance(rng, 0.5) ? row.phone : `01${intBetween(rng, 3, 9)}${String(intBetween(rng, 10000000, 99999999)).padStart(8, '0')}`,
        row.dob, row.approx_age_years, row.approx_age_recorded_on, row.sex, row.address_free_text,
        createdAt, pick(rng, frontDesk).id, createdAt,
      );
      recordAudit(db, { actor: system, action: 'patient_created', entity: 'patient', entityId: id, details: { source: 'seed', note: 'deliberate duplicate for merge testing' } });
      patients.push({ id, sex: original.sex, ageAtStart: original.ageAtStart, phys: original.phys, phone: null });
      result.duplicatePairs++;
    }
    result.patients = patients.length;
    report(`${result.patients} patients`);

    // ---------------- visits and everything hanging off them ----------------
    // Visits are generated first, then grouped by chamber and day so
    // that serial numbers run 1, 2, 3 within each clinic day - which is
    // what the register actually has to guarantee.
    interface PlannedVisit { patient: P; chamberId: string; day: Date; }
    const planned: PlannedVisit[] = [];
    const spanMs = now.getTime() - startDate.getTime();

    for (const p of patients) {
      const visitCount = intBetween(rng, 1, 8);
      const homeChamber = chance(rng, 0.75) ? chambers[0]!.id : chambers[1]!.id;
      const times: number[] = [];
      for (let v = 0; v < visitCount; v++) times.push(startDate.getTime() + rng() * spanMs);
      times.sort((a, b) => a - b);
      for (const t of times) {
        const day = new Date(t);
        // Chambers do not sit on Fridays; push those to Saturday.
        if (day.getDay() === 5) day.setDate(day.getDate() + 1);
        planned.push({ patient: p, chamberId: chance(rng, 0.85) ? homeChamber : (homeChamber === chambers[0]!.id ? chambers[1]!.id : chambers[0]!.id), day });
      }
    }

    const byDay = new Map<string, PlannedVisit[]>();
    for (const v of planned) {
      const key = `${v.chamberId}|${dateOnly(v.day)}`;
      const list = byDay.get(key);
      if (list) list.push(v); else byDay.set(key, [v]);
    }

    const insVisit = db.prepare(
      `INSERT INTO visit (id, patient_id, chamber_id, visit_date, serial_no, arrived_at, seen_at, status, created_at, created_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insVitals = db.prepare(
      `INSERT INTO vitals (id, visit_id, recorded_by, recorded_at, systolic_bp, diastolic_bp, pulse, temperature_c,
         weight_kg, height_cm, random_blood_sugar, spo2, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insEnc = db.prepare(
      `INSERT INTO encounter (id, visit_id, chief_complaint, examination_notes, working_diagnosis, decision_notes,
         follow_up_after_days, entered_by, doctor_confirmed_by, doctor_confirmed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insMed = db.prepare(
      `INSERT INTO medication (id, encounter_id, drug_name, strength, dose, frequency, duration_days, instructions, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insInv = db.prepare(
      `INSERT INTO investigation (id, encounter_id, test_name, ordered_date, result_summary, result_date, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    const insIntake = db.prepare(
      `INSERT INTO intake (id, visit_id, recorded_by, started_at, completed_at, was_skipped, helper_present,
         consent_version, consent_given_at, research_consent_version, research_consent_given_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insAnswer = db.prepare(
      `INSERT INTO intake_answer (id, intake_id, question_key, answer_value, answer_free_text, was_skipped, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);

    for (const [, dayVisits] of byDay) {
      dayVisits.sort(() => rng() - 0.5);
      let serial = 0;
      for (const pv of dayVisits) {
        serial += 1;
        const yearsIn = (pv.day.getTime() - startDate.getTime()) / (365.25 * 24 * 3600 * 1000);
        const arriveHour = intBetween(rng, 17, 20);
        const arriveMin = intBetween(rng, 0, 59);
        const arrivedAt = isoAt(pv.day, arriveHour, arriveMin);
        const seenAt = isoAt(pv.day, arriveHour + (chance(rng, 0.5) ? 0 : 1), Math.min(59, arriveMin + intBetween(rng, 8, 55)));
        const visitId = newId();
        const desk = pick(rng, frontDesk);

        insVisit.run(visitId, pv.patient.id, pv.chamberId, dateOnly(pv.day), serial, arrivedAt, seenAt, 'done', arrivedAt, desk.id, seenAt);
        recordAudit(db, { actor: system, action: 'visit_created', entity: 'visit', entityId: visitId, details: { serial_no: serial, source: 'seed' } });
        recordUsage(db, { eventType: 'visit_registered', actorId: desk.id, visitId, timestamp: arrivedAt, durationMs: Math.round(18000 + rng() * 22000) });
        result.visits++;

        // ---- intake, taken by the front desk, sometimes not at all ----
        if (chance(rng, 0.72)) {
          const intakeId = newId();
          const startedAt = isoAt(pv.day, arriveHour, Math.min(59, arriveMin + 2));
          // Shopna is faster and skips more. That difference is the
          // whole reason the pilot report never averages assistants.
          const durationMs = Math.round((55000 + rng() * 150000) * desk.speed);
          const abandoned = chance(rng, 0.09);
          insIntake.run(
            intakeId, visitId, desk.id, startedAt,
            abandoned ? null : new Date(new Date(startedAt).getTime() + durationMs).toISOString(),
            0, chance(rng, 0.35) ? 1 : 0,
            'consent-v1', startedAt,
            chance(rng, 0.62) ? 'research-consent-v1' : null, chance(rng, 0.62) ? startedAt : null,
            startedAt, startedAt,
          );
          const complaint = pick(rng, V.COMPLAINTS);
          const answers: Array<[string, string | null, string | null]> = [
            ['presenting_complaint', null, complaint.bn],
            ['body_region', pick(rng, V.BODY_REGIONS), null],
            ['duration', pick(rng, V.DURATIONS).bn, null],
            ['severity', pick(rng, ['mild', 'moderate', 'severe']), null],
            ['medicines_already_taken', null, pick(rng, V.SELF_MEDICATION_ANSWERS).bn],
            ['known_conditions', null, chance(rng, 0.4) ? 'PLACEHOLDER — known conditions as reported' : null],
            ['allergies', null, chance(rng, 0.12) ? 'PLACEHOLDER — allergy as reported' : null],
            ['most_worried_about', null, pick(rng, V.WORRIES).bn],
            ['hoping_for', null, pick(rng, V.HOPES).bn],
          ];
          for (const [key, value, free] of answers) {
            const skipped = chance(rng, desk.skip) || (abandoned && chance(rng, 0.6));
            insAnswer.run(newId(), intakeId, key, skipped ? null : value, skipped ? null : free, skipped ? 1 : 0, startedAt, startedAt);
          }
          recordUsage(db, { eventType: 'intake_completed', actorId: desk.id, visitId, timestamp: startedAt, durationMs });
          result.intakes++;
        }

        // ---- vitals: partial is normal, not degraded ----
        if (chance(rng, 0.8)) {
          const ph = pv.patient.phys;
          const recorder = chance(rng, 0.6) ? assistant : doctor;
          insVitals.run(
            newId(), visitId, recorder.id, seenAt,
            chance(rng, 0.92) ? Math.round(ph.systolic0 + ph.systolicPerYear * yearsIn + (rng() * 10 - 5)) : null,
            chance(rng, 0.92) ? Math.round(ph.diastolic0 + ph.diastolicPerYear * yearsIn + (rng() * 6 - 3)) : null,
            chance(rng, 0.7) ? Math.round(ph.pulse0 + (rng() * 12 - 6)) : null,
            chance(rng, 0.4) ? round1(97.5 + rng() * 3.2) : null,
            chance(rng, 0.65) ? round1(ph.weight0 + ph.weightPerYear * yearsIn + (rng() * 1.2 - 0.6)) : null,
            chance(rng, 0.25) ? intBetween(rng, 140, 178) : null,
            chance(rng, 0.45) ? round1(ph.sugar0 + ph.sugarPerYear * yearsIn + (rng() * 1.5 - 0.75)) : null,
            chance(rng, 0.3) ? intBetween(rng, 94, 99) : null,
            null, seenAt, seenAt,
          );
          result.vitals++;
        }

        // ---- encounter ----
        if (chance(rng, 0.93)) {
          const encId = newId();
          const complaint = pick(rng, V.COMPLAINTS);
          const enteredBy = chance(rng, 0.35) ? assistant : doctor;
          // A few encounters are left unconfirmed on purpose: an evening
          // that ended in a hurry. The Recall Card has to show that
          // state honestly rather than pretending it is confirmed.
          const confirmed = chance(rng, 0.9);
          insEnc.run(
            encId, visitId, complaint.en,
            chance(rng, 0.75) ? 'PLACEHOLDER — examination findings recorded by the clinician' : null,
            pick(rng, V.PLACEHOLDER_DIAGNOSES),
            chance(rng, 0.6) ? 'PLACEHOLDER — decision and advice recorded by the clinician' : null,
            chance(rng, 0.55) ? pick(rng, [7, 14, 15, 30, 30, 90]) : null,
            enteredBy.id,
            confirmed ? doctor.id : null, confirmed ? seenAt : null,
            seenAt, seenAt,
          );
          recordAudit(db, { actor: system, action: 'encounter_created', entity: 'encounter', entityId: encId, details: { source: 'seed' } });
          recordUsage(db, { eventType: 'encounter_entered', actorId: enteredBy.id, visitId, timestamp: seenAt, durationMs: Math.round(90000 + rng() * 240000) });
          result.encounters++;

          for (let m = 0, n = intBetween(rng, 0, 4); m < n; m++) {
            const drug = pick(rng, V.PLACEHOLDER_DRUGS);
            insMed.run(newId(), encId, drug.drug_name, drug.strength,
              pick(rng, ['1 tab', '2 tabs', '1 tsf', '½ tab']),
              pick(rng, ['1+0+1', '1+1+1', '0+0+1', '1+0+0']),
              pick(rng, [5, 7, 10, 14, 30]),
              chance(rng, 0.5) ? 'PLACEHOLDER — instruction as written by the clinician' : null,
              m, seenAt, seenAt);
            result.medications++;
          }

          // Investigations. Some deliberately have no result recorded,
          // because outstanding tests are the highest-value block on the
          // Recall Card and it needs real ones to display.
          for (let t = 0, n = chance(rng, 0.45) ? intBetween(rng, 1, 3) : 0; t < n; t++) {
            const hasResult = chance(rng, 0.62);
            const orderedDate = dateOnly(pv.day);
            const resultDate = hasResult ? dateOnly(new Date(pv.day.getTime() + intBetween(rng, 1, 20) * 86400000)) : null;
            insInv.run(newId(), encId, pick(rng, V.PLACEHOLDER_TESTS), orderedDate,
              hasResult ? 'PLACEHOLDER — result summary as recorded by the clinician' : null,
              resultDate, seenAt, seenAt);
            result.investigations++;
            if (!hasResult) result.outstandingInvestigations++;
          }
        }
      }
    }

    setMeta(db, 'data_mode', 'demo');
    setMeta(db, 'seeded_at', new Date().toISOString());
    setMeta(db, 'seed_random_seed', String(options.randomSeed ?? 20260322));
    recordAudit(db, { actor: system, action: 'database_seeded', entity: 'app_meta', entityId: 'data_mode', details: { ...result } });
  });

  insertAll();
  report(`${result.visits} visits`);

  // Screening runs after everything is inserted, as a separate pass,
  // using the same code path a real intake goes through. This is also
  // the first time the evaluator is exercised at realistic volume.
  if (options.rulebook != null) {
    const system = { id: null, role: 'system' as const };
    const intakes = db.prepare(
      `SELECT i.id AS intakeId, i.started_at AS startedAt FROM intake i ORDER BY i.started_at`,
    ).all() as Array<{ intakeId: string; startedAt: string }>;

    for (const intake of intakes) {
      const outcome = screenIntake(db, options.rulebook, intake.intakeId, system, intake.startedAt);
      result.ruleEvaluations += outcome.results.length;
      result.redFlagsFired += outcome.firedFlags.length;
      if (outcome.screeningIncomplete) result.screeningsIncomplete += 1;
    }
    report(`${result.ruleEvaluations} rule evaluations`);
  }

  report('done');
  return result;
}
