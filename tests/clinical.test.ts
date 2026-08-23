import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { provision } from '../src/main/db/provision';
import { newId } from '../src/main/db/ids';
import { nowIso } from '../src/main/db/clock';
import type { Db } from '../src/main/db/open';
import { addStaff } from '../src/main/auth/staff';
import { saveVitals, questionsAbout, vitalsFor } from '../src/main/clinical/vitals';
import {
  openEncounter, saveDraft, setMedications, setInvestigations,
  confirmEncounter, unconfirmEncounter, encounterFor, EncounterError,
} from '../src/main/clinical/encounter';
import { chamberView } from '../src/main/clinical/chamber';
import { requireClinicalRole, requireDoctor, NotAllowedError } from '../src/main/clinical/access';
import { tempDir } from './helpers';

/**
 * Milestone 9. Vitals and the consultation.
 *
 * The two things these tests exist to hold in place:
 *
 *   A number that looks wrong is QUESTIONED and stored anyway. Nothing
 *   here refuses a reading, corrects one, or says anything about what
 *   a reading means.
 *
 *   A confirmed consultation cannot be quietly changed. Amending one
 *   takes an undo that is recorded, so the log holds an amendment
 *   rather than a rewrite.
 */

const system = { id: null, role: 'system' as const };
const CHAMBER = 'chamber-a';
const TODAY = '2026-08-23';

function chamber() {
  const t = tempDir();
  const db = provision(t.dir, 'passphrase', 'demo').db;
  const doctorId = addStaff(db, { displayName: 'Dr Ashraful', role: 'doctor', pin: '4021' }, system);
  const assistantId = addStaff(db, { displayName: 'Nusrat', role: 'clinical_assistant', pin: '5390' }, { id: doctorId, role: 'doctor' });
  const deskId = addStaff(db, { displayName: 'Biplob', role: 'front_desk', pin: '6172' }, { id: doctorId, role: 'doctor' });
  db.prepare('INSERT INTO chamber (id, name, created_at) VALUES (?, ?, ?)').run(CHAMBER, 'Popular Chamber', nowIso());
  return {
    db, cleanup: t.cleanup,
    doctor: { id: doctorId, role: 'doctor' as const },
    assistant: { id: assistantId, role: 'clinical_assistant' as const },
    desk: { id: deskId, role: 'front_desk' as const },
  };
}

let serial = 0;
function newVisit(db: Db, createdBy: string, date = TODAY): { visitId: string; patientId: string } {
  const patientId = newId();
  db.prepare(`INSERT INTO patient (id, full_name_bn, full_name_en, search_name_en, phone,
                approx_age_years, approx_age_recorded_on, sex, created_at, created_by, updated_at)
              VALUES (?, 'তাসলিমা', 'Taslima', 'taslima', '01711000000', 44, ?, 'female', ?, ?, ?)`)
    .run(patientId, date, nowIso(), createdBy, nowIso());
  serial += 1;
  const visitId = newId();
  db.prepare(`INSERT INTO visit (id, patient_id, chamber_id, visit_date, serial_no, arrived_at, status,
                created_at, created_by, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, 'in_chamber', ?, ?, ?)`)
    .run(visitId, patientId, CHAMBER, date, serial, `${date}T17:00:00.000Z`, nowIso(), createdBy, nowIso());
  return { visitId, patientId };
}

function visitFor(db: Db, patientId: string, createdBy: string, date: string): string {
  serial += 1;
  const visitId = newId();
  db.prepare(`INSERT INTO visit (id, patient_id, chamber_id, visit_date, serial_no, arrived_at, status,
                created_at, created_by, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, 'done', ?, ?, ?)`)
    .run(visitId, patientId, CHAMBER, date, serial, `${date}T17:00:00.000Z`, nowIso(), createdBy, nowIso());
  return visitId;
}

const NOTHING = {
  systolic: null, diastolic: null, pulse: null, temperature: null, weightKg: null,
  heightCm: null, randomBloodSugar: null, spo2: null, notes: null,
};

describe('who may write what', () => {
  test('the front desk cannot enter clinical data', () => {
    assert.throws(() => requireClinicalRole({ id: 'x', role: 'front_desk' }, 'record vitals'), NotAllowedError);
  });

  test('a clinical assistant can write, and cannot sign', () => {
    requireClinicalRole({ id: 'x', role: 'clinical_assistant' }, 'record vitals');
    assert.throws(() => requireDoctor({ id: 'x', role: 'clinical_assistant' }, 'confirm'), NotAllowedError);
  });

  test('nothing is ever written by nobody', () => {
    assert.throws(() => requireClinicalRole({ id: null, role: 'doctor' }, 'record vitals'), NotAllowedError);
    assert.throws(() => requireDoctor({ id: null, role: 'doctor' }, 'confirm'), NotAllowedError);
  });
});

describe('vitals', () => {
  let c: ReturnType<typeof chamber>;
  before(() => { c = chamber(); });
  after(() => { c.db.close(); c.cleanup(); });

  test('a temperature typed in Fahrenheit is stored in Celsius', () => {
    const { visitId } = newVisit(c.db, c.desk.id);
    saveVitals(c.db, visitId, { ...NOTHING, temperature: { typed: 99.8, unit: 'F' } }, c.doctor);
    const row = c.db.prepare('SELECT temperature_c AS t FROM vitals WHERE visit_id = ?').get(visitId) as { t: number };
    assert.equal(row.t, 37.7);
  });

  test('a temperature typed in Celsius is stored as it is', () => {
    const { visitId } = newVisit(c.db, c.desk.id);
    saveVitals(c.db, visitId, { ...NOTHING, temperature: { typed: 38.4, unit: 'C' } }, c.doctor);
    assert.equal(vitalsFor(c.db, visitId).temperatureC, 38.4);
  });

  test('a reading outside what a machine can show is questioned, not refused', () => {
    const { visitId } = newVisit(c.db, c.desk.id);
    const input = { ...NOTHING, systolic: 900, pulse: 72 };
    const questions = questionsAbout(input);
    assert.equal(questions.length, 1);
    assert.equal(questions[0]!.field, 'systolic');
    assert.match(questions[0]!.question, /saved as it is/);

    // And it is stored anyway. Refusing to save what somebody actually
    // typed is how a reading ends up only on a scrap of paper.
    saveVitals(c.db, visitId, input, c.doctor);
    assert.equal(vitalsFor(c.db, visitId).systolic, 900);
  });

  test('nothing in a question says what a reading means', () => {
    const all = questionsAbout({ ...NOTHING, systolic: 900, diastolic: 400, pulse: 300, spo2: 5 });
    for (const q of all) {
      // "upper" and "lower" name the two blood pressure numbers, which
      // is what they are called out loud in a chamber. What must never
      // appear is a word about what the reading MEANS.
      assert.doesNotMatch(q.question, /danger|urgent|serious|abnormal|critical|too (high|low)|very (high|low)|worrying/i,
        `a vitals question interpreted the reading: "${q.question}"`);
    }
  });

  test('blood pressure the wrong way round is questioned as a pair', () => {
    const questions = questionsAbout({ ...NOTHING, systolic: 80, diastolic: 120 });
    assert.equal(questions.length, 1);
    assert.match(questions[0]!.question, /right way round/);
  });

  test('a plausible set of readings asks nothing at all', () => {
    assert.deepEqual(questionsAbout({
      ...NOTHING, systolic: 128, diastolic: 82, pulse: 76, spo2: 98,
      weightKg: 71.5, heightCm: 160, randomBloodSugar: 7.2,
      temperature: { typed: 98.6, unit: 'F' },
    }), []);
  });

  test('an empty form writes nothing', () => {
    const { visitId } = newVisit(c.db, c.desk.id);
    assert.equal(saveVitals(c.db, visitId, { ...NOTHING }, c.doctor), null);
    assert.equal(vitalsFor(c.db, visitId).id, null);
  });

  test('a changed reading is recorded with what it was before', () => {
    const { visitId } = newVisit(c.db, c.desk.id);
    saveVitals(c.db, visitId, { ...NOTHING, systolic: 130, diastolic: 85 }, c.doctor);
    saveVitals(c.db, visitId, { ...NOTHING, systolic: 150, diastolic: 85 }, c.doctor);
    const row = c.db.prepare(
      `SELECT details_json AS details FROM audit_log WHERE action = 'vitals_changed' ORDER BY id DESC LIMIT 1`,
    ).get() as { details: string };
    const details = JSON.parse(row.details) as { changes: Record<string, { was: number; now: number }> };
    assert.deepEqual(details.changes['systolic_bp'], { was: 130, now: 150 });
    assert.equal(details.changes['diastolic_bp'], undefined, 'only what changed is recorded');
  });

  test('saving the same numbers twice does not fill the log with nothing', () => {
    const { visitId } = newVisit(c.db, c.desk.id);
    saveVitals(c.db, visitId, { ...NOTHING, pulse: 72 }, c.doctor);
    const before = c.db.prepare(`SELECT count(*) AS n FROM audit_log WHERE entity = 'vitals'`).get() as { n: number };
    saveVitals(c.db, visitId, { ...NOTHING, pulse: 72 }, c.doctor);
    const after = c.db.prepare(`SELECT count(*) AS n FROM audit_log WHERE entity = 'vitals'`).get() as { n: number };
    assert.equal(after.n, before.n);
  });

  test('the front desk cannot record vitals', () => {
    const { visitId } = newVisit(c.db, c.desk.id);
    assert.throws(() => saveVitals(c.db, visitId, { ...NOTHING, pulse: 72 }, c.desk), NotAllowedError);
  });
});

describe('the consultation', () => {
  let c: ReturnType<typeof chamber>;
  before(() => { c = chamber(); });
  after(() => { c.db.close(); c.cleanup(); });

  test('opening it twice is the same consultation, not two', () => {
    const { visitId } = newVisit(c.db, c.desk.id);
    const first = openEncounter(c.db, visitId, c.doctor);
    const second = openEncounter(c.db, visitId, c.assistant);
    assert.equal(first, second);
  });

  test('the front desk cannot open one at all', () => {
    const { visitId } = newVisit(c.db, c.desk.id);
    assert.throws(() => openEncounter(c.db, visitId, c.desk), NotAllowedError);
  });

  test('a draft saves without being confirmed, and is not part of the record yet', () => {
    const { visitId } = newVisit(c.db, c.desk.id);
    const id = openEncounter(c.db, visitId, c.assistant);
    saveDraft(c.db, id, {
      chiefComplaint: 'stomach pain after eating', examinationNotes: 'soft, tender epigastrium',
      workingDiagnosis: null, decisionNotes: null, followUpAfterDays: null,
    }, c.assistant);
    const view = encounterFor(c.db, visitId)!;
    assert.equal(view.chiefComplaint, 'stomach pain after eating');
    assert.equal(view.confirmedAt, null);
    assert.equal(view.enteredByName, 'Nusrat');
  });

  test('an empty consultation cannot be confirmed', () => {
    const { visitId } = newVisit(c.db, c.desk.id);
    const id = openEncounter(c.db, visitId, c.doctor);
    assert.throws(() => confirmEncounter(c.db, id, c.doctor), EncounterError);
  });

  test('only the doctor confirms', () => {
    const { visitId } = newVisit(c.db, c.desk.id);
    const id = openEncounter(c.db, visitId, c.assistant);
    saveDraft(c.db, id, {
      chiefComplaint: 'cough', examinationNotes: null, workingDiagnosis: null,
      decisionNotes: null, followUpAfterDays: null,
    }, c.assistant);
    assert.throws(() => confirmEncounter(c.db, id, c.assistant), NotAllowedError);
    confirmEncounter(c.db, id, c.doctor);
    assert.notEqual(encounterFor(c.db, visitId)!.confirmedAt, null);
  });

  test('what was signed is copied into the audit log as it stood', () => {
    const { visitId } = newVisit(c.db, c.desk.id);
    const id = openEncounter(c.db, visitId, c.doctor);
    saveDraft(c.db, id, {
      chiefComplaint: 'headache', examinationNotes: null, workingDiagnosis: 'a diagnosis in his own words',
      decisionNotes: null, followUpAfterDays: 14,
    }, c.doctor);
    confirmEncounter(c.db, id, c.doctor);
    const row = c.db.prepare(
      `SELECT details_json AS details FROM audit_log WHERE action = 'encounter_confirmed' AND entity_id = ?`,
    ).get(id) as { details: string };
    const details = JSON.parse(row.details) as { signed: Record<string, unknown> };
    assert.equal(details.signed.workingDiagnosis, 'a diagnosis in his own words');
    assert.equal(details.signed.followUpAfterDays, 14);
  });

  test('a confirmed consultation cannot be edited', () => {
    const { visitId } = newVisit(c.db, c.desk.id);
    const id = openEncounter(c.db, visitId, c.doctor);
    saveDraft(c.db, id, {
      chiefComplaint: 'fever', examinationNotes: null, workingDiagnosis: null,
      decisionNotes: null, followUpAfterDays: null,
    }, c.doctor);
    confirmEncounter(c.db, id, c.doctor);
    assert.throws(() => saveDraft(c.db, id, {
      chiefComplaint: 'something else', examinationNotes: null, workingDiagnosis: null,
      decisionNotes: null, followUpAfterDays: null,
    }, c.doctor), EncounterError);
  });

  test('the database refuses the edit even if the code around it does not', () => {
    const { visitId } = newVisit(c.db, c.desk.id);
    const id = openEncounter(c.db, visitId, c.doctor);
    saveDraft(c.db, id, {
      chiefComplaint: 'fever', examinationNotes: null, workingDiagnosis: null,
      decisionNotes: null, followUpAfterDays: null,
    }, c.doctor);
    confirmEncounter(c.db, id, c.doctor);
    assert.throws(
      () => c.db.prepare('UPDATE encounter SET working_diagnosis = ? WHERE id = ?').run('slipped in', id),
      /confirmed/,
    );
  });

  test('amending one means undoing the confirmation, which is recorded', () => {
    const { visitId } = newVisit(c.db, c.desk.id);
    const id = openEncounter(c.db, visitId, c.doctor);
    saveDraft(c.db, id, {
      chiefComplaint: 'fever', examinationNotes: null, workingDiagnosis: null,
      decisionNotes: null, followUpAfterDays: null,
    }, c.doctor);
    confirmEncounter(c.db, id, c.doctor);
    assert.throws(() => unconfirmEncounter(c.db, id, c.assistant), NotAllowedError);
    unconfirmEncounter(c.db, id, c.doctor, 'wrote it on the wrong patient');
    saveDraft(c.db, id, {
      chiefComplaint: 'fever for three days', examinationNotes: null, workingDiagnosis: null,
      decisionNotes: null, followUpAfterDays: null,
    }, c.doctor);
    confirmEncounter(c.db, id, c.doctor);

    const actions = (c.db.prepare(
      `SELECT action FROM audit_log WHERE entity_id = ? ORDER BY id`,
    ).all(id) as Array<{ action: string }>).map((r) => r.action);
    assert.deepEqual(actions.filter((a) => a.startsWith('encounter_')), [
      'encounter_started', 'encounter_confirmed', 'encounter_confirmation_undone', 'encounter_confirmed',
    ]);
  });

  test('a prescription cannot be changed once the consultation is signed', () => {
    const { visitId } = newVisit(c.db, c.desk.id);
    const id = openEncounter(c.db, visitId, c.doctor);
    setMedications(c.db, id, [
      { drugName: 'PLACEHOLDER DRUG 1', strength: '500 mg', dose: '1 tab', frequency: '1+0+1', durationDays: 7, instructions: null },
    ], c.doctor);
    confirmEncounter(c.db, id, c.doctor);
    assert.throws(() => setMedications(c.db, id, [], c.doctor), EncounterError);
    assert.throws(
      () => c.db.prepare('UPDATE medication SET drug_name = ? WHERE encounter_id = ?').run('something else', id),
      /confirmed/,
    );
    assert.equal(encounterFor(c.db, visitId)!.medications.length, 1);
  });

  test('the order of the prescription is the order it was written in', () => {
    const { visitId } = newVisit(c.db, c.desk.id);
    const id = openEncounter(c.db, visitId, c.doctor);
    setMedications(c.db, id, [
      { drugName: 'B', strength: null, dose: null, frequency: null, durationDays: null, instructions: null },
      { drugName: 'A', strength: null, dose: null, frequency: null, durationDays: null, instructions: null },
      { drugName: 'C', strength: null, dose: null, frequency: null, durationDays: null, instructions: null },
    ], c.doctor);
    assert.deepEqual(encounterFor(c.db, visitId)!.medications.map((m) => m.drugName), ['B', 'A', 'C']);
  });

  test('a blank line in the prescription is not a medicine', () => {
    const { visitId } = newVisit(c.db, c.desk.id);
    const id = openEncounter(c.db, visitId, c.doctor);
    setMedications(c.db, id, [
      { drugName: '  ', strength: null, dose: null, frequency: null, durationDays: null, instructions: null },
      { drugName: 'Real one', strength: null, dose: null, frequency: null, durationDays: null, instructions: null },
    ], c.doctor);
    assert.deepEqual(encounterFor(c.db, visitId)!.medications.map((m) => m.drugName), ['Real one']);
  });

  test('a test that already has a result is never dropped by editing the list', () => {
    const { visitId } = newVisit(c.db, c.desk.id);
    const id = openEncounter(c.db, visitId, c.doctor);
    setInvestigations(c.db, id, ['CBC with ESR', 'X-ray chest PA view'], c.doctor);
    c.db.prepare(`UPDATE investigation SET result_date = ?, result_summary = ? WHERE encounter_id = ? AND test_name = ?`)
      .run(TODAY, 'a result', id, 'CBC with ESR');

    setInvestigations(c.db, id, ['Serum creatinine'], c.doctor);
    const names = encounterFor(c.db, visitId)!.investigations;
    assert.ok(names.includes('CBC with ESR'), 'a result is a fact about the patient and does not belong to the edit box');
    assert.ok(names.includes('Serum creatinine'));
    assert.ok(!names.includes('X-ray chest PA view'));
  });

  test('a result can still be recorded weeks after the consultation was signed', () => {
    const { visitId } = newVisit(c.db, c.desk.id);
    const id = openEncounter(c.db, visitId, c.doctor);
    setInvestigations(c.db, id, ['TSH'], c.doctor);
    confirmEncounter(c.db, id, c.doctor);

    // The result comes back later. Recording it must never require
    // undoing a signature on a consultation that is finished.
    c.db.prepare(`UPDATE investigation SET result_date = ?, result_summary = ? WHERE encounter_id = ?`)
      .run('2026-09-10', 'a result as recorded by the clinician', id);

    // But the test itself is part of what was signed.
    assert.throws(
      () => c.db.prepare('UPDATE investigation SET test_name = ? WHERE encounter_id = ?').run('something else', id),
      /confirmed/,
    );
  });

  test('a follow-up has to be a number of days', () => {
    const { visitId } = newVisit(c.db, c.desk.id);
    const id = openEncounter(c.db, visitId, c.doctor);
    assert.throws(() => saveDraft(c.db, id, {
      chiefComplaint: null, examinationNotes: null, workingDiagnosis: null,
      decisionNotes: null, followUpAfterDays: -3,
    }, c.doctor), EncounterError);
  });
});

describe('the chamber screen', () => {
  let c: ReturnType<typeof chamber>;
  before(() => { c = chamber(); });
  after(() => { c.db.close(); c.cleanup(); });

  test('it carries what was written last time, so nothing is retyped from memory', () => {
    const { visitId, patientId } = newVisit(c.db, c.desk.id);
    const older = visitFor(c.db, patientId, c.desk.id, '2026-05-02');
    const olderEncounter = openEncounter(c.db, older, c.doctor);
    saveDraft(c.db, olderEncounter, {
      chiefComplaint: 'the same problem', examinationNotes: null,
      workingDiagnosis: 'what he called it last time', decisionNotes: null, followUpAfterDays: 30,
    }, c.doctor);
    setMedications(c.db, olderEncounter, [
      { drugName: 'PLACEHOLDER DRUG 1', strength: '20 mg', dose: '1 tab', frequency: '1+0+0', durationDays: 30, instructions: null },
    ], c.doctor);
    confirmEncounter(c.db, olderEncounter, c.doctor);

    openEncounter(c.db, visitId, c.doctor);
    const view = chamberView(c.db, visitId);
    assert.equal(view.previousDiagnosis, 'what he called it last time');
    assert.equal(view.previousVisitDate, '2026-05-02');
    assert.equal(view.previousMedications[0]!.drugName, 'PLACEHOLDER DRUG 1');
    assert.equal(view.previousMedications[0]!.strength, '20 mg');
    // And today's own consultation is still empty.
    assert.equal(view.encounter.chiefComplaint, null);
    assert.equal(view.serialNo > 0, true);
    assert.equal(view.chamberName, 'Popular Chamber');
  });

  test('a first visit has nothing to carry and says so rather than breaking', () => {
    const { visitId } = newVisit(c.db, c.desk.id);
    openEncounter(c.db, visitId, c.doctor);
    const view = chamberView(c.db, visitId);
    assert.equal(view.previousDiagnosis, null);
    assert.deepEqual(view.previousMedications, []);
  });
});
