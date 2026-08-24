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
import { normaliseName, searchablePhone } from '../db/names';
import { hashPin } from '../auth/pin';
import { recordAudit } from '../db/audit';
import { recordUsage } from '../db/usage';
import { SeedRefusedError } from '../../shared/errors';
import type { Rulebook } from '../redflags/rulebook';
import { screenIntake, acknowledgeRedFlag } from '../redflags/store';
import { recordConsent } from '../consent/store';
import { MALE_GIVEN, MALE_FAMILY, FEMALE_GIVEN, FEMALE_FAMILY, AREAS } from './names';
import * as V from './demo-vocabulary';

/**
 * How a second registration of the same person drifts.
 *
 * These are the real ways a Bangladeshi name gets written differently
 * by two people on two evenings. The duplicate has to LOOK different on
 * screen, or the merge tool cannot be judged: a duplicate that differs
 * only by an invisible trailing space proves nothing.
 */
const RESPELLINGS: Array<[RegExp, string]> = [
  [/Mohammad/, 'Md.'], [/Hossain/, 'Hosen'], [/Akter/, 'Aktar'], [/Begum/, 'Begom'],
  [/Rahman/, 'Rehman'], [/Chowdhury/, 'Choudhury'], [/Uddin/, 'Uddeen'], [/Khatun/, 'Khatoon'],
  [/Yasmin/, 'Jasmin'], [/Siddika/, 'Siddiqa'], [/Nasrin/, 'Nasreen'], [/Shafiqul/, 'Shafikul'],
  [/Islam/, 'Islaam'], [/Sarkar/, 'Sorkar'], [/Hasan/, 'Hassan'], [/Ayesha/, 'Aisha'],
  [/Taslima/, 'Taslema'], [/Jesmin/, 'Jesmine'], [/Rubel/, 'Rubal'], [/Mia/, 'Miah'],
];

function respell(englishName: string): string {
  for (const [pattern, replacement] of RESPELLINGS) {
    if (pattern.test(englishName)) return englishName.replace(pattern, replacement);
  }
  // Nothing matched: registered by given name only, which is the other
  // common way a second record of the same person appears.
  const parts = englishName.trim().split(/\s+/);
  return parts.length > 1 ? parts[0]! : `${englishName} (2)`;
}

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
   * The version of the consent wording in force. When given, every
   * practice patient gets a recorded decision - most agreeing, some
   * not - through the real consent code, so the pilot report and the
   * research export have something true to count.
   */
  consentVersion?: string | null;
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
  redFlagsAcknowledged: number;
  consentRecorded: number;
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
    ruleEvaluations: 0, redFlagsFired: 0, redFlagsAcknowledged: 0, consentRecorded: 0, screeningsIncomplete: 0,
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
    // Every practice user has a PIN so the demo can be signed into.
    // These PINs are printed by the seed script and are only ever in a
    // database marked demo, which cannot hold a real patient.
    const users = [
      { id: newId(), display_name: 'Dr. Ashraful Haque', role: 'doctor' as const, pin: '4021', speed: 1, skip: 0 },
      { id: newId(), display_name: 'Nusrat (clinical assistant)', role: 'clinical_assistant' as const, pin: '5390', speed: 1, skip: 0 },
      { id: newId(), display_name: 'Jahid (front desk)', role: 'front_desk' as const, pin: '6172', speed: 1.0, skip: 0.12 },
      { id: newId(), display_name: 'Shopna (front desk)', role: 'front_desk' as const, pin: '7483', speed: 0.45, skip: 0.55 },
    ];
    for (const u of users) {
      const pin = hashPin(u.pin);
      db.prepare(
        `INSERT INTO app_user (id, display_name, role, pin_salt, pin_hash, pin_set_at, is_active, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
      ).run(u.id, u.display_name, u.role, pin.salt, pin.hash, isoAt(startDate, 9, 0), isoAt(startDate, 9, 0));
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
      `INSERT INTO patient (id, full_name_bn, full_name_en, search_name_bn, search_name_en, phone, search_phone,
         dob, approx_age_years, approx_age_recorded_on, sex, address_free_text,
         created_at, created_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    for (let i = 0; i < patientCount; i++) {
      const sex: 'male' | 'female' = chance(rng, 0.48) ? 'male' : 'female';
      const given = pick(rng, sex === 'male' ? MALE_GIVEN : FEMALE_GIVEN);
      const family = pick(rng, sex === 'male' ? MALE_FAMILY : FEMALE_FAMILY);
      const name = { bn: `${given.bn} ${family.bn}`, en: `${given.en} ${family.en}` };
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
        phone, searchablePhone(phone), dob, knowsDob ? null : age, knowsDob ? null : createdAt.slice(0, 10),
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
      const respelled = respell(enName);
      const id = newId();
      const createdAt = isoAt(new Date(startDate.getTime() + rng() * (now.getTime() - startDate.getTime())), 11, 0);
      const duplicatePhone = chance(rng, 0.5)
        ? (row.phone as string | null)
        : `01${intBetween(rng, 3, 9)}${String(intBetween(rng, 10000000, 99999999)).padStart(8, '0')}`;
      insertPatient.run(
        id, row.full_name_bn, respelled,
        normaliseName(String(row.full_name_bn ?? '')), normaliseName(respelled),
        duplicatePhone, searchablePhone(duplicatePhone),
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
    // The history stops yesterday. Today's session is generated
    // separately below, and two generators writing into the same
    // clinic day would fight over the serial numbers.
    const historyEnds = new Date(now.getTime() - 24 * 3600 * 1000);
    const spanMs = historyEnds.getTime() - startDate.getTime();

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
    // Confirming is a separate step, because that is the order it
    // happens in life and, since milestone 9, the order the database
    // insists on: a confirmed consultation cannot have a medicine or a
    // test added to it without the confirmation being undone first.
    const signEnc = db.prepare(
      'UPDATE encounter SET doctor_confirmed_by = ?, doctor_confirmed_at = ?, updated_at = ? WHERE id = ?');
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
            chance(rng, 0.4) ? round1(36.4 + rng() * 2.6) : null,
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
            null, null,
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

          if (confirmed) signEnc.run(doctor.id, seenAt, seenAt, encId);
        }
      }
    }

    // ---------------- today's session ----------------
    // The history above is all in the past, which is not enough: the
    // Recall Card, the queue and the intake screens all need a chamber
    // that is running RIGHT NOW - people waiting, one patient in with
    // the doctor, a few already seen.
    //
    // Patients with the most history come first, because a Recall Card
    // is only worth looking at when there is something to recall.
    const historyCount = new Map<string, number>();
    for (const v of planned) historyCount.set(v.patient.id, (historyCount.get(v.patient.id) ?? 0) + 1);

    const returning = [...patients]
      .filter((p) => (historyCount.get(p.id) ?? 0) >= 4)
      .sort((a, b) => (historyCount.get(b.id) ?? 0) - (historyCount.get(a.id) ?? 0))
      .slice(0, 14);
    const firstTimers = patients.filter((p) => (historyCount.get(p.id) ?? 0) <= 1).slice(0, 4);
    const todaysPatients = [...returning, ...firstTimers];

    const todayDate = dateOnly(now);
    const todaysChamber = chambers[0]!.id;

    // Arrival times run BACKWARDS from the moment the practice data is
    // built, not from a fixed hour of the evening. A session pinned to
    // 17:00 shows every patient as having waited zero minutes whenever
    // the demo is opened in the morning - and "how long has this person
    // been waiting" is one of the things the queue exists to answer.
    const sessionStartedAt = now.getTime() - 3 * 3600 * 1000;
    const arrivalOf = (index: number) => new Date(sessionStartedAt + index * 8 * 60000);

    // Continue from any serial already issued in this chamber today,
    // rather than assuming today's list starts empty. A register that
    // reuses a serial is a register nobody can trust.
    const serialsAlreadyToday = (db.prepare(
      'SELECT COALESCE(max(serial_no), 0) AS n FROM visit WHERE chamber_id = ? AND visit_date = ?',
    ).get(todaysChamber, todayDate) as { n: number }).n;

    todaysPatients.forEach((p, index) => {
      const serial = serialsAlreadyToday + index + 1;
      // Six already seen, one with the doctor now, the rest waiting.
      const status = index < 6 ? 'done' : index === 6 ? 'in_chamber' : 'waiting';
      const arrived = arrivalOf(index);
      const arrivedAt = arrived.toISOString();
      // Those already seen were called in some minutes after arriving;
      // the one with the doctor went in a quarter of an hour ago.
      const seenAt = status === 'waiting' ? null
        : status === 'in_chamber' ? new Date(now.getTime() - 14 * 60000).toISOString()
        : new Date(arrived.getTime() + intBetween(rng, 12, 38) * 60000).toISOString();
      const visitId = newId();
      const desk = pick(rng, frontDesk);

      insVisit.run(visitId, p.id, todaysChamber, todayDate, serial, arrivedAt, seenAt, status, arrivedAt, desk.id, arrivedAt);
      recordAudit(db, { actor: system, action: 'visit_created', entity: 'visit', entityId: visitId, details: { serial_no: serial, source: 'seed', session: 'today' } });
      recordUsage(db, { eventType: 'visit_registered', actorId: desk.id, visitId, timestamp: arrivedAt, durationMs: Math.round(16000 + rng() * 20000) });
      result.visits++;

      // Most, not all, have an intake. One waiting patient deliberately
      // has none at all, so the "nobody screened this patient" case is
      // visible on the doctor's screen.
      const noIntakeAtAll = index === todaysPatients.length - 1;
      if (!noIntakeAtAll) {
        const intakeId = newId();
        const startedAt = new Date(arrived.getTime() + 2 * 60000).toISOString();
        const durationMs = Math.round((55000 + rng() * 150000) * desk.speed);
        insIntake.run(intakeId, visitId, desk.id, startedAt,
          new Date(new Date(startedAt).getTime() + durationMs).toISOString(),
          0, chance(rng, 0.35) ? 1 : 0, 'consent-v1', startedAt,
          chance(rng, 0.62) ? 'research-consent-v1' : null, chance(rng, 0.62) ? startedAt : null,
          startedAt, startedAt);

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
          const skipped = chance(rng, desk.skip);
          insAnswer.run(newId(), intakeId, key, skipped ? null : value, skipped ? null : free, skipped ? 1 : 0, startedAt, startedAt);
        }
        recordUsage(db, { eventType: 'intake_completed', actorId: desk.id, visitId, timestamp: startedAt, durationMs });
        result.intakes++;
      }

      // Vitals for everyone the doctor has already reached.
      if (status !== 'waiting') {
        const ph = p.phys;
        const recorder = chance(rng, 0.6) ? assistant : doctor;
        insVitals.run(newId(), visitId, recorder.id, seenAt ?? arrivedAt,
          Math.round(ph.systolic0 + ph.systolicPerYear * years + (rng() * 10 - 5)),
          Math.round(ph.diastolic0 + ph.diastolicPerYear * years + (rng() * 6 - 3)),
          Math.round(ph.pulse0 + (rng() * 12 - 6)),
          chance(rng, 0.4) ? round1(36.4 + rng() * 2.6) : null,
          round1(ph.weight0 + ph.weightPerYear * years + (rng() * 1.2 - 0.6)),
          chance(rng, 0.25) ? intBetween(rng, 140, 178) : null,
          chance(rng, 0.55) ? round1(ph.sugar0 + ph.sugarPerYear * years + (rng() * 1.5 - 0.75)) : null,
          chance(rng, 0.3) ? intBetween(rng, 94, 99) : null,
          null, seenAt ?? arrivedAt, seenAt ?? arrivedAt);
        result.vitals++;
      }

      // Only the patients already seen have an encounter. The patient
      // in the chamber right now does not: that is exactly the moment
      // the Recall Card exists for.
      if (status === 'done') {
        const encId = newId();
        insEnc.run(encId, visitId, pick(rng, V.COMPLAINTS).en,
          'PLACEHOLDER — examination findings recorded by the clinician',
          pick(rng, V.PLACEHOLDER_DIAGNOSES),
          chance(rng, 0.6) ? 'PLACEHOLDER — decision and advice recorded by the clinician' : null,
          chance(rng, 0.55) ? pick(rng, [7, 14, 15, 30, 30, 90]) : null,
          doctor.id, null, null, seenAt ?? arrivedAt, seenAt ?? arrivedAt);
        result.encounters++;
        for (let m = 0, n = intBetween(rng, 1, 3); m < n; m++) {
          const drug = pick(rng, V.PLACEHOLDER_DRUGS);
          insMed.run(newId(), encId, drug.drug_name, drug.strength, pick(rng, ['1 tab', '2 tabs', '1 tsf']),
            pick(rng, ['1+0+1', '1+1+1', '0+0+1']), pick(rng, [5, 7, 10, 14]),
            null, m, seenAt ?? arrivedAt, seenAt ?? arrivedAt);
          result.medications++;
        }
        signEnc.run(doctor.id, seenAt, seenAt ?? arrivedAt, encId);
      }
    });

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
    const deskUsers = db.prepare(
      `SELECT id FROM app_user WHERE role = 'front_desk' AND deleted_at IS NULL`,
    ).all() as Array<{ id: string }>;
    const intakes = db.prepare(
      `SELECT i.id AS intakeId, i.started_at AS startedAt FROM intake i ORDER BY i.started_at`,
    ).all() as Array<{ intakeId: string; startedAt: string }>;

    for (const intake of intakes) {
      const outcome = screenIntake(db, options.rulebook, intake.intakeId, system, intake.startedAt);
      result.ruleEvaluations += outcome.results.length;
      result.redFlagsFired += outcome.firedFlags.length;
      if (outcome.screeningIncomplete) result.screeningsIncomplete += 1;

      // Most warnings get acknowledged at the desk, and some do not.
      // Both happen in a real chamber, and the pilot report is built
      // to show the difference - so the practice data has to contain
      // it rather than showing a tidy hundred per cent or a flat zero.
      const desk = deskUsers.length === 0 ? null : pick(rng, deskUsers);
      if (desk === null) continue;
      for (const flag of outcome.firedFlags) {
        if (!chance(rng, 0.86)) continue;
        acknowledgeRedFlag(db, flag.eventId, { id: desk.id, role: 'front_desk' },
          new Date(new Date(intake.startedAt).getTime() + intBetween(rng, 20, 240) * 1000).toISOString());
        result.redFlagsAcknowledged += 1;
      }
    }
    report(`${result.ruleEvaluations} rule evaluations`);
  }

  // ---------------- permission ----------------
  // Through the real consent code, at each patient's first visit, by
  // whichever assistant was on that evening.
  if (options.consentVersion != null && options.consentVersion !== '') {
    const deskForConsent = db.prepare(
      `SELECT id FROM app_user WHERE role = 'front_desk' AND deleted_at IS NULL`,
    ).all() as Array<{ id: string }>;
    const firstVisits = db.prepare(
      `SELECT patient_id AS patientId, min(visit_date) AS firstDate FROM visit
       WHERE deleted_at IS NULL GROUP BY patient_id`,
    ).all() as Array<{ patientId: string; firstDate: string }>;

    for (const first of firstVisits) {
      const desk = deskForConsent.length === 0 ? null : pick(rng, deskForConsent);
      if (desk === null) break;
      const actor = { id: desk.id, role: 'front_desk' as const };
      const at = `${first.firstDate}T17:05:00.000Z`;

      // A few patients say no to a history being kept, and rather
      // more say no to research. Both happen, and a practice database
      // where everybody agrees teaches the wrong lesson.
      const keepsHistory = chance(rng, 0.94);
      recordConsent(db, {
        patientId: first.patientId, kind: 'care_record', version: options.consentVersion,
        decision: keepsHistory ? 'given' : 'declined',
        givenBy: chance(rng, 0.22) ? 'family_member' : 'self',
        givenByName: null, relationship: null,
        method: 'read_aloud', language: 'bn',
      }, actor, at);
      result.consentRecorded += 1;

      if (keepsHistory) {
        recordConsent(db, {
          patientId: first.patientId, kind: 'research', version: options.consentVersion,
          decision: chance(rng, 0.62) ? 'given' : 'declined',
          givenBy: 'self', givenByName: null, relationship: null,
          method: 'read_aloud', language: 'bn',
        }, actor, at);
        result.consentRecorded += 1;
      }
    }
    report(`${result.consentRecorded} permission decisions recorded`);
  }

  report('done');
  return result;
}
