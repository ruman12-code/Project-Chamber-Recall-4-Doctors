import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { provision } from '../src/main/db/provision';
import { newId } from '../src/main/db/ids';
import { nowIso } from '../src/main/db/clock';
import type { Db } from '../src/main/db/open';
import { buildRecallCard, currentVisitId } from '../src/main/recall/card';
import { loadRulebook } from '../src/main/redflags/rulebook';
import { screenIntake, acknowledgeRedFlag } from '../src/main/redflags/store';
import { tempDir } from './helpers';

const DOCTOR = 'user-doctor';
const DESK = 'user-desk';
const CHAMBER_A = 'chamber-a';
const CHAMBER_B = 'chamber-b';
const AS_OF = new Date('2026-08-22T18:00:00Z');

const RULES = `
approved_by: "Dr Test"
approved_on: "2026-09-01"
rules:
  - id: fires_on_severe
    version: 1
    status: approved
    message: { bn: "এখনই ডাক্তারকে জানান।", en: "Tell the doctor now." }
    when: { question: severity, equals: severe }
  - id: needs_allergies
    version: 2
    status: approved
    message: { bn: "খ", en: "B" }
    when: { question: allergies, equals: yes_known }
`;
const rulebook = loadRulebook(RULES, 'test.yaml').rulebook!;

function newChamber() {
  const t = tempDir();
  const db = provision(t.dir, 'passphrase', 'demo').db;
  db.prepare('INSERT INTO app_user (id, display_name, role, is_active, created_at) VALUES (?, ?, ?, 1, ?)')
    .run(DOCTOR, 'Dr Ashraful', 'doctor', nowIso());
  db.prepare('INSERT INTO app_user (id, display_name, role, is_active, created_at) VALUES (?, ?, ?, 1, ?)')
    .run(DESK, 'Jahid', 'front_desk', nowIso());
  db.prepare('INSERT INTO chamber (id, name, created_at) VALUES (?, ?, ?)').run(CHAMBER_A, 'Chamber A', nowIso());
  db.prepare('INSERT INTO chamber (id, name, created_at) VALUES (?, ?, ?)').run(CHAMBER_B, 'Chamber B', nowIso());
  return { dir: t.dir, db, cleanup: t.cleanup };
}

function addPatient(db: Db, opts: { age?: number; dob?: string } = {}) {
  const id = newId();
  db.prepare(`INSERT INTO patient (id, full_name_bn, full_name_en, search_name_en, phone, dob,
                approx_age_years, approx_age_recorded_on, sex, created_at, created_by, updated_at)
              VALUES (?, ?, ?, ?, '01711000000', ?, ?, ?, 'female', ?, ?, ?)`)
    .run(id, 'পরীক্ষা', 'Test Patient', 'test patient', opts.dob ?? null,
      opts.dob === undefined ? (opts.age ?? 40) : null,
      opts.dob === undefined ? '2026-08-22' : null, nowIso(), DESK, nowIso());
  return id;
}

let serialCounter = 0;
function addVisit(db: Db, patientId: string, date: string, chamberId = CHAMBER_A, status = 'done') {
  const id = newId();
  serialCounter += 1;
  db.prepare(`INSERT INTO visit (id, patient_id, chamber_id, visit_date, serial_no, arrived_at, seen_at, status, created_at, created_by, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, patientId, chamberId, date, serialCounter, `${date}T17:00:00.000Z`, `${date}T17:30:00.000Z`, status,
      nowIso(), DESK, nowIso());
  return id;
}

/**
 * An encounter is written first and signed afterwards, in that order,
 * because since milestone 9 the database refuses to let a medicine or
 * a test be added to a consultation that is already confirmed. The
 * helper mirrors what really happens: build it, then sign it.
 */
const toSign: string[] = [];
function addEncounter(db: Db, visitId: string, opts: { diagnosis?: string; complaint?: string; confirmed?: boolean } = {}) {
  const id = newId();
  db.prepare(`INSERT INTO encounter (id, visit_id, chief_complaint, working_diagnosis, entered_by,
                created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id, visitId, opts.complaint ?? 'a complaint', opts.diagnosis ?? null, DOCTOR, nowIso(), nowIso());
  if (opts.confirmed !== false) toSign.push(id);
  return id;
}

function signEncounters(db: Db) {
  for (const id of toSign) {
    db.prepare('UPDATE encounter SET doctor_confirmed_by = ?, doctor_confirmed_at = ? WHERE id = ?')
      .run(DOCTOR, nowIso(), id);
  }
  toSign.length = 0;
}

function addVitals(db: Db, visitId: string, systolic: number, weight: number | null = null) {
  db.prepare(`INSERT INTO vitals (id, visit_id, recorded_by, recorded_at, systolic_bp, diastolic_bp, weight_kg, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, 80, ?, ?, ?)`)
    .run(newId(), visitId, DOCTOR, nowIso(), systolic, weight, nowIso(), nowIso());
}

function addInvestigation(db: Db, encounterId: string, name: string, orderedDate: string, resultDate: string | null) {
  const id = newId();
  db.prepare(`INSERT INTO investigation (id, encounter_id, test_name, ordered_date, result_date, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id, encounterId, name, orderedDate, resultDate, nowIso(), nowIso());
  return id;
}

function addIntake(db: Db, visitId: string, answers: Record<string, { value?: string; skipped?: boolean }>) {
  const id = newId();
  db.prepare(`INSERT INTO intake (id, visit_id, recorded_by, started_at, completed_at, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id, visitId, DESK, nowIso(), nowIso(), nowIso(), nowIso());
  for (const [key, a] of Object.entries(answers)) {
    db.prepare(`INSERT INTO intake_answer (id, intake_id, question_key, answer_value, was_skipped, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(newId(), id, key, a.value ?? null, a.skipped === true ? 1 : 0, nowIso(), nowIso());
  }
  return id;
}

describe('a returning patient with history', () => {
  let db: Db; let cleanup: () => void; let card: ReturnType<typeof buildRecallCard>;

  before(() => {
    const c = newChamber(); db = c.db; cleanup = c.cleanup;
    const patientId = addPatient(db, { age: 49 });

    const v1 = addVisit(db, patientId, '2024-01-10', CHAMBER_B);
    const e1 = addEncounter(db, v1, { diagnosis: 'Chronic problem', complaint: 'first complaint' });
    addVitals(db, v1, 130, 70);
    addInvestigation(db, e1, 'CBC with ESR', '2024-01-10', '2024-01-15');
    addInvestigation(db, e1, 'X-ray K.U.B.', '2024-01-10', null);

    const v2 = addVisit(db, patientId, '2025-06-20');
    const e2 = addEncounter(db, v2, { diagnosis: 'Chronic problem', complaint: 'second complaint' });
    addVitals(db, v2, 138, 72);
    db.prepare(`INSERT INTO medication (id, encounter_id, drug_name, strength, dose, frequency, sort_order, created_at, updated_at)
                VALUES (?, ?, 'PLACEHOLDER DRUG 1', '500 mg', '1 tab', '1+0+1', 0, ?, ?)`).run(newId(), e2, nowIso(), nowIso());
    addInvestigation(db, e2, 'TSH', '2025-06-20', null);

    const today = addVisit(db, patientId, '2026-08-22', CHAMBER_A, 'in_chamber');
    addVitals(db, today, 148, 74);
    const intakeId = addIntake(db, today, {
      severity: { value: 'severe' }, body_region: { value: 'chest' }, allergies: { skipped: true },
    });
    const [flag] = screenIntake(db, rulebook, intakeId, { id: DESK, role: 'front_desk' }).firedFlags;
    acknowledgeRedFlag(db, flag!.eventId, { id: DESK, role: 'front_desk' });

    signEncounters(db);
    card = buildRecallCard(db, today, AS_OF, rulebook);
  });
  after(() => { db.close(); cleanup(); });

  test('finds the patient in the chamber right now', () => {
    assert.equal(currentVisitId(db, '2026-08-22'), card.today.visitId);
  });

  test('the red flag carries the words the assistant was actually shown', () => {
    assert.equal(card.today.redFlags.length, 1);
    assert.equal(card.today.redFlags[0]!.messageEn, 'Tell the doctor now.');
    assert.equal(card.today.redFlags[0]!.messageBn, 'এখনই ডাক্তারকে জানান।');
  });

  test('the card shows whether anyone at the front desk acknowledged it', () => {
    assert.ok(card.today.redFlags[0]!.acknowledgedAt);
    assert.equal(card.today.redFlags[0]!.acknowledgedByName, 'Jahid');
  });

  test('a rule that could not be checked is reported as incomplete screening', () => {
    assert.equal(card.today.screening.ran, true);
    assert.equal(card.today.screening.incomplete, true);
    assert.deepEqual(card.today.screening.missingQuestions, ['allergies']);
  });

  test('the last visit is the most recent one before today', () => {
    assert.equal(card.lastVisit!.visitDate, '2025-06-20');
    assert.equal(card.lastVisit!.chamberName, 'Chamber A');
    assert.equal(card.lastVisit!.medications.length, 1);
  });

  test("today's vitals come with the previous two beside them", () => {
    assert.equal(card.today.vitals!.systolic, 148);
    assert.deepEqual(card.previousVitals.map((v) => v.systolic), [138, 130]);
  });

  test('outstanding investigations are the ones with no result, oldest waiting the longest', () => {
    assert.deepEqual(card.outstandingInvestigations.map((i) => i.testName), ['TSH', 'X-ray K.U.B.']);
    assert.equal(card.outstandingInvestigations.find((i) => i.testName === 'X-ray K.U.B.')!.daysWaiting, 955);
  });

  test('an investigation that came back is not outstanding', () => {
    assert.equal(card.outstandingInvestigations.some((i) => i.testName === 'CBC with ESR'), false);
  });

  test('the trend covers every visit, not only recent ones', () => {
    assert.deepEqual(card.trend.bp.map((p) => p.systolic), [130, 138, 148]);
    assert.deepEqual(card.trend.weight.map((p) => p.value), [70, 72, 74]);
  });

  test('the timeline lists every visit including today, newest first', () => {
    assert.equal(card.totalVisits, 3);
    assert.deepEqual(card.timeline.map((t) => t.visitDate), ['2026-08-22', '2025-06-20', '2024-01-10']);
    assert.equal(card.timeline[2]!.chamberName, 'Chamber B', 'the chamber a visit happened in must travel with it');
  });

  test('an approximate age is shown as approximate', () => {
    assert.equal(card.patient.ageYears, 49);
    assert.equal(card.patient.ageIsApproximate, true);
  });

  test('current medicines come from the last visit that had any', () => {
    assert.equal(card.currentMedications[0]!.drugName, 'PLACEHOLDER DRUG 1');
    assert.equal(card.currentMedicationsFrom, '2025-06-20');
  });
});

describe('grouping diagnoses', () => {
  let db: Db; let cleanup: () => void;
  before(() => { const c = newChamber(); db = c.db; cleanup = c.cleanup; });
  after(() => { db.close(); cleanup(); });

  test('identical wording is grouped, different wording is not', () => {
    // Grouping is by exact text and nothing else. The software must
    // never decide that two differently-worded entries mean the same
    // thing - that would be it interpreting a diagnosis.
    const patientId = addPatient(db);
    for (const [date, diagnosis] of [
      ['2024-02-01', 'Chronic problem'],
      ['2024-08-01', 'Chronic problem'],
      ['2025-02-01', 'chronic problem'],
      ['2025-08-01', 'Chronic problem '],
    ] as const) {
      addEncounter(db, addVisit(db, patientId, date), { diagnosis });
    }
    const today = addVisit(db, patientId, '2026-08-22', CHAMBER_A, 'in_chamber');
    signEncounters(db);
    const card = buildRecallCard(db, today, AS_OF, rulebook);

    const groups = Object.fromEntries(card.recurringDiagnoses.map((d) => [d.text, d.count]));
    assert.equal(groups['Chronic problem'], 2);
    assert.equal(groups['chronic problem'], 1, 'different capitalisation is a different entry, not a guess');
    assert.equal(groups['Chronic problem '], 1);
  });
});

describe('soft-deleted records never come back on the card', () => {
  let db: Db; let cleanup: () => void; let patientId: string; let todayVisit: string;

  before(() => {
    const c = newChamber(); db = c.db; cleanup = c.cleanup;
    patientId = addPatient(db);
    const old = addVisit(db, patientId, '2025-01-01');
    const encounterId = addEncounter(db, old, { diagnosis: 'Removed diagnosis' });
    addVitals(db, old, 200);
    addInvestigation(db, encounterId, 'Removed test', '2025-01-01', null);
    db.prepare(`INSERT INTO medication (id, encounter_id, drug_name, sort_order, created_at, updated_at)
                VALUES (?, ?, 'Removed drug', 0, ?, ?)`).run(newId(), encounterId, nowIso(), nowIso());
    todayVisit = addVisit(db, patientId, '2026-08-22', CHAMBER_A, 'in_chamber');
    signEncounters(db);
  });
  after(() => { db.close(); cleanup(); });

  test('everything shows while it is there', () => {
    const card = buildRecallCard(db, todayVisit, AS_OF, rulebook);
    assert.equal(card.recurringDiagnoses.length, 1);
    assert.equal(card.outstandingInvestigations.length, 1);
    assert.equal(card.trend.bp.length, 1);
    assert.equal(card.currentMedications.length, 1);
    assert.equal(card.totalVisits, 2);
  });

  test('and none of it shows once the visit is soft-deleted', () => {
    db.prepare('UPDATE visit SET deleted_at = ? WHERE visit_date = ?').run(nowIso(), '2025-01-01');
    const card = buildRecallCard(db, todayVisit, AS_OF, rulebook);
    assert.equal(card.recurringDiagnoses.length, 0);
    assert.equal(card.outstandingInvestigations.length, 0);
    assert.equal(card.trend.bp.length, 0);
    assert.equal(card.lastVisit, null);
    assert.equal(card.totalVisits, 1);
  });
});

describe('the cases with nothing to recall', () => {
  let db: Db; let cleanup: () => void;
  before(() => { const c = newChamber(); db = c.db; cleanup = c.cleanup; });
  after(() => { db.close(); cleanup(); });

  test('a first visit has no last visit, and says so rather than breaking', () => {
    const patientId = addPatient(db);
    const visitId = addVisit(db, patientId, '2026-08-22', CHAMBER_A, 'in_chamber');
    const card = buildRecallCard(db, visitId, AS_OF, rulebook);
    assert.equal(card.lastVisit, null);
    assert.equal(card.totalVisits, 1);
    assert.deepEqual(card.trend.bp, []);
    assert.deepEqual(card.currentMedications, []);
  });

  test('a patient nobody screened is reported as not screened at all', () => {
    // Different from "screened and nothing found", and the doctor's
    // screen has to be able to tell them apart.
    const patientId = addPatient(db);
    const visitId = addVisit(db, patientId, '2026-08-22', CHAMBER_A, 'waiting');
    const card = buildRecallCard(db, visitId, AS_OF, rulebook);
    assert.equal(card.today.intake, null);
    assert.deepEqual(card.today.screening, { ran: false, incomplete: false, missingQuestions: [] });
  });

  test('a patient screened with nothing found is reported as complete and clear', () => {
    const patientId = addPatient(db);
    const visitId = addVisit(db, patientId, '2026-08-22', CHAMBER_A, 'waiting');
    const intakeId = addIntake(db, visitId, { severity: { value: 'mild' }, allergies: { value: 'none' } });
    screenIntake(db, rulebook, intakeId, { id: DESK, role: 'front_desk' });
    const card = buildRecallCard(db, visitId, AS_OF, rulebook);
    assert.equal(card.today.screening.ran, true);
    assert.equal(card.today.screening.incomplete, false);
    assert.equal(card.today.redFlags.length, 0);
  });

  test('an unconfirmed encounter is visible as unconfirmed', () => {
    const patientId = addPatient(db);
    addEncounter(db, addVisit(db, patientId, '2025-05-05'), { diagnosis: 'Something', confirmed: false });
    signEncounters(db);
    const visitId = addVisit(db, patientId, '2026-08-22', CHAMBER_A, 'in_chamber');
    const card = buildRecallCard(db, visitId, AS_OF, rulebook);
    assert.equal(card.lastVisit!.doctorConfirmedAt, null);
  });

  test('a rule that has since been removed does not leave a blank warning', () => {
    const patientId = addPatient(db);
    const visitId = addVisit(db, patientId, '2026-08-22', CHAMBER_A, 'waiting');
    const intakeId = addIntake(db, visitId, { severity: { value: 'severe' } });
    screenIntake(db, rulebook, intakeId, { id: DESK, role: 'front_desk' });

    const withoutTheRule = loadRulebook(RULES.replace(/  - id: fires_on_severe[\s\S]*?when: \{ question: severity, equals: severe \}\n/, ''), 'x.yaml').rulebook!;
    const card = buildRecallCard(db, visitId, AS_OF, withoutTheRule);
    assert.equal(card.today.redFlags.length, 1);
    assert.match(card.today.redFlags[0]!.messageEn, /no longer in the rules file/);
  });
});
