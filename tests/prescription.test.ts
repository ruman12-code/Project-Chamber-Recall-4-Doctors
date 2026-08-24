import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { provision } from '../src/main/db/provision';
import { newId } from '../src/main/db/ids';
import { nowIso } from '../src/main/db/clock';
import { prescriptionPath } from '../src/main/paths';
import type { Db } from '../src/main/db/open';
import { addStaff } from '../src/main/auth/staff';
import { openEncounter, saveDraft, setMedications, setInvestigations, confirmEncounter } from '../src/main/clinical/encounter';
import { saveVitals } from '../src/main/clinical/vitals';
import { loadPrescriptionConfig, letterheadFor } from '../src/main/prescription/config';
import { buildPrescription, recordPrescriptionPrinted, PrescriptionError } from '../src/main/prescription/build';
import { NotAllowedError } from '../src/main/clinical/access';
import { tempDir } from './helpers';

/**
 * Milestone 10. The one thing that leaves the chamber.
 *
 * The printed sheet may be read tonight by a pharmacist, next year by
 * another doctor, or in an emergency by a hospital, and none of them
 * will have this software. So the tests here are about the sheet
 * standing on its own, about it never carrying a placeholder to a real
 * patient, and about it never being printed before it is signed.
 */

const system = { id: null, role: 'system' as const };
const CHAMBER = 'chamber-a';
const CHAMBER_NAME = 'Popular Chamber';
const TODAY = '2026-08-24';

/** A letterhead with the placeholders replaced, as a real chamber would. */
function fillIn(dir: string, extra = ''): void {
  writeFileSync(prescriptionPath(dir), `
doctor:
  name:
    bn: "ডা. আশরাফুল হক"
    en: "Dr. Ashraful Haque"
  qualifications: "MBBS, FCPS (Medicine)"
  designation: "Consultant, Department of Medicine"
  registration: "BMDC Reg. No. A-12345"
chambers:
  - name: "${CHAMBER_NAME}"
    address:
      bn: "১২/ক, ধানমন্ডি, ঢাকা"
      en: "12/A, Dhanmondi, Dhaka"
    phone: "01711000000"
    hours:
      bn: "শনি–বৃহস্পতি, বিকাল ৫টা–রাত ৯টা"
      en: "Sat-Thu, 5pm-9pm"
footer:
  bn: "পরের বার এই কাগজটি সঙ্গে আনুন।"
  en: "Please bring this paper with you next time."
paper: A5
${extra}
`, 'utf8');
}

function chamber() {
  const t = tempDir();
  const db = provision(t.dir, 'passphrase', 'demo').db;
  const doctorId = addStaff(db, { displayName: 'Dr Ashraful', role: 'doctor', pin: '4021' }, system);
  const deskId = addStaff(db, { displayName: 'Biplob', role: 'front_desk', pin: '6172' }, { id: doctorId, role: 'doctor' });
  db.prepare('INSERT INTO chamber (id, name, created_at) VALUES (?, ?, ?)').run(CHAMBER, CHAMBER_NAME, nowIso());
  return {
    db, dir: t.dir, cleanup: t.cleanup,
    doctor: { id: doctorId, role: 'doctor' as const },
    desk: { id: deskId, role: 'front_desk' as const },
  };
}

let serial = 0;
function newVisit(db: Db, createdBy: string): string {
  const patientId = newId();
  db.prepare(`INSERT INTO patient (id, full_name_bn, full_name_en, search_name_en, phone,
                approx_age_years, approx_age_recorded_on, sex, created_at, created_by, updated_at)
              VALUES (?, 'তাসলিমা বেগম', 'Taslima Begum', 'taslima begum', '01711000000', 44, ?, 'female', ?, ?, ?)`)
    .run(patientId, TODAY, nowIso(), createdBy, nowIso());
  serial += 1;
  const visitId = newId();
  db.prepare(`INSERT INTO visit (id, patient_id, chamber_id, visit_date, serial_no, arrived_at, status,
                created_at, created_by, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, 'in_chamber', ?, ?, ?)`)
    .run(visitId, patientId, CHAMBER, TODAY, serial, `${TODAY}T17:00:00.000Z`, nowIso(), createdBy, nowIso());
  return visitId;
}

function aFullConsultation(c: ReturnType<typeof chamber>, visitId: string): string {
  const id = openEncounter(c.db, visitId, c.doctor);
  saveDraft(c.db, id, {
    chiefComplaint: 'stomach pain after eating',
    examinationNotes: 'PLACEHOLDER — examination findings',
    workingDiagnosis: 'the clinician\'s own wording',
    decisionNotes: 'Eat before the tablet. Come back sooner if the pain wakes you at night.',
    followUpAfterDays: 14,
  }, c.doctor);
  setMedications(c.db, id, [
    { drugName: 'PLACEHOLDER DRUG 1', strength: '20 mg', dose: '1 tab', frequency: '1+0+0', durationDays: 30, instructions: 'before breakfast' },
    { drugName: 'PLACEHOLDER DRUG 2', strength: '500 mg', dose: '1 tab', frequency: '1+1+1', durationDays: 7, instructions: null },
  ], c.doctor);
  setInvestigations(c.db, id, ['CBC with ESR', 'X-ray chest PA view'], c.doctor);
  saveVitals(c.db, visitId, {
    systolic: 148, diastolic: 92, pulse: 84, temperature: { typed: 100.4, unit: 'F' },
    weightKg: 76.4, heightCm: null, randomBloodSugar: 11.2, spo2: 97, notes: null,
  }, c.doctor);
  return id;
}

describe('the letterhead', () => {
  let c: ReturnType<typeof chamber>;
  before(() => { c = chamber(); });
  after(() => { c.db.close(); c.cleanup(); });

  test('a fresh installation ships one, full of placeholders', () => {
    const outcome = loadPrescriptionConfig(c.dir);
    assert.notEqual(outcome.config, null);
    assert.ok(outcome.blocksLiveUse.length > 0, 'a template letterhead must block live use');
    assert.match(outcome.blocksLiveUse[0]!.reason, /PLACEHOLDER/);
  });

  test('the refusal names the file and says what to do with it', () => {
    const outcome = loadPrescriptionConfig(c.dir);
    assert.match(outcome.blocksLiveUse[0]!.whatToDo, /prescription\.yaml/);
  });

  test('once it is filled in, it stops blocking', () => {
    fillIn(c.dir);
    const outcome = loadPrescriptionConfig(c.dir);
    assert.deepEqual(outcome.blocksLiveUse, []);
    assert.equal(outcome.config!.doctor.registration, 'BMDC Reg. No. A-12345');
  });

  test('one placeholder left anywhere is still a block', () => {
    fillIn(c.dir);
    const path = prescriptionPath(c.dir);
    writeFileSync(path, readFileSync(path, 'utf8').replace('01711000000', 'PLACEHOLDER — 01XXXXXXXXX'), 'utf8');
    const outcome = loadPrescriptionConfig(c.dir);
    assert.equal(outcome.blocksLiveUse.length, 1);
    assert.match(outcome.blocksLiveUse[0]!.reason, /phone number/);
    fillIn(c.dir);
  });

  test('a missing registration number is a problem, not a silent blank', () => {
    writeFileSync(prescriptionPath(c.dir), `
doctor:
  name: { bn: "ডা. পরীক্ষা", en: "Dr Test" }
  qualifications: "MBBS"
chambers: []
`, 'utf8');
    const outcome = loadPrescriptionConfig(c.dir);
    assert.equal(outcome.config, null);
    assert.ok(outcome.problems.some((p) => /registration/i.test(p.problem)));
    fillIn(c.dir);
  });

  test('the address for the right chamber is found by its exact name', () => {
    const { config } = loadPrescriptionConfig(c.dir);
    assert.notEqual(letterheadFor(config!, CHAMBER_NAME), null);
    assert.equal(letterheadFor(config!, 'Somewhere else'), null);
  });

  test('a file that is not valid yaml is reported rather than crashing', () => {
    writeFileSync(prescriptionPath(c.dir), 'doctor: [unclosed\n', 'utf8');
    const outcome = loadPrescriptionConfig(c.dir);
    assert.equal(outcome.config, null);
    assert.ok(outcome.problems.length > 0);
    assert.ok(outcome.blocksLiveUse.length > 0);
    fillIn(c.dir);
  });
});

describe('the printed sheet', () => {
  let c: ReturnType<typeof chamber>;
  before(() => { c = chamber(); fillIn(c.dir); });
  after(() => { c.db.close(); c.cleanup(); });

  test('an unconfirmed consultation cannot be printed', () => {
    const visitId = newVisit(c.db, c.desk.id);
    aFullConsultation(c, visitId);
    try {
      buildPrescription(c.db, c.dir, visitId);
      assert.fail('an unsigned prescription was built');
    } catch (error) {
      assert.ok(error instanceof PrescriptionError);
      assert.match(error.userMessage, /not been confirmed/);
      assert.match(error.whatToDo, /Confirm this consultation/);
    }
  });

  test('a visit with nothing written for it cannot be printed', () => {
    const visitId = newVisit(c.db, c.desk.id);
    assert.throws(() => buildPrescription(c.db, c.dir, visitId), PrescriptionError);
  });

  test('everything on the sheet is what somebody typed', () => {
    const visitId = newVisit(c.db, c.desk.id);
    const encounterId = aFullConsultation(c, visitId);
    confirmEncounter(c.db, encounterId, c.doctor);
    const sheet = buildPrescription(c.db, c.dir, visitId, new Date(`${TODAY}T18:00:00Z`));

    assert.equal(sheet.medications.length, 2);
    assert.equal(sheet.medications[0]!.drugName, 'PLACEHOLDER DRUG 1');
    assert.equal(sheet.medications[0]!.frequency, '1+0+0');
    assert.equal(sheet.medications[0]!.instructions, 'before breakfast');
    assert.deepEqual(sheet.investigations, ['CBC with ESR', 'X-ray chest PA view']);
    assert.equal(sheet.advice, 'Eat before the tablet. Come back sooner if the pain wakes you at night.');
    assert.equal(sheet.diagnosis, 'the clinician\'s own wording');
  });

  test('the order of the prescription is the order it was written in', () => {
    const visitId = newVisit(c.db, c.desk.id);
    const encounterId = aFullConsultation(c, visitId);
    confirmEncounter(c.db, encounterId, c.doctor);
    const sheet = buildPrescription(c.db, c.dir, visitId);
    assert.deepEqual(sheet.medications.map((m) => m.drugName), ['PLACEHOLDER DRUG 1', 'PLACEHOLDER DRUG 2']);
  });

  test('the sheet carries who prescribed, their registration, and which chamber', () => {
    const visitId = newVisit(c.db, c.desk.id);
    const encounterId = aFullConsultation(c, visitId);
    confirmEncounter(c.db, encounterId, c.doctor);
    const { letterhead } = buildPrescription(c.db, c.dir, visitId);
    assert.equal(letterhead.doctorNameEn, 'Dr. Ashraful Haque');
    assert.equal(letterhead.registration, 'BMDC Reg. No. A-12345');
    assert.equal(letterhead.chamberName, CHAMBER_NAME);
    assert.equal(letterhead.addressEn, '12/A, Dhanmondi, Dhaka');
    assert.equal(letterhead.addressKnown, true);
  });

  test('a chamber the letterhead does not know about still prints, and says so', () => {
    const other = 'chamber-b';
    c.db.prepare('INSERT INTO chamber (id, name, created_at) VALUES (?, ?, ?)').run(other, 'Unknown Chamber', nowIso());
    const visitId = newVisit(c.db, c.desk.id);
    c.db.prepare('UPDATE visit SET chamber_id = ? WHERE id = ?').run(other, visitId);
    const encounterId = aFullConsultation(c, visitId);
    confirmEncounter(c.db, encounterId, c.doctor);
    const { letterhead } = buildPrescription(c.db, c.dir, visitId);
    assert.equal(letterhead.addressKnown, false);
    assert.equal(letterhead.addressEn, '');
    assert.equal(letterhead.doctorNameEn, 'Dr. Ashraful Haque', 'a missing address never costs the prescriber');
  });

  test('the follow-up date is worked out from the visit, not from today', () => {
    const visitId = newVisit(c.db, c.desk.id);
    const encounterId = aFullConsultation(c, visitId);
    confirmEncounter(c.db, encounterId, c.doctor);
    const sheet = buildPrescription(c.db, c.dir, visitId, new Date('2027-01-01T00:00:00Z'));
    assert.equal(sheet.followUpAfterDays, 14);
    assert.equal(sheet.followUpDate, '2026-09-07');
  });

  test('the readings printed are the ones taken, and the temperature is in Celsius', () => {
    const visitId = newVisit(c.db, c.desk.id);
    const encounterId = aFullConsultation(c, visitId);
    confirmEncounter(c.db, encounterId, c.doctor);
    const sheet = buildPrescription(c.db, c.dir, visitId);
    assert.match(sheet.vitalsLine, /BP 148\/92/);
    assert.match(sheet.vitalsLine, /Temp 38\.0°C/);
    assert.doesNotMatch(sheet.vitalsLine, /Height/, 'a box nobody filled in is not printed as a measurement');
  });

  test('a reading nobody took is left off entirely', () => {
    const visitId = newVisit(c.db, c.desk.id);
    const encounterId = openEncounter(c.db, visitId, c.doctor);
    saveDraft(c.db, encounterId, {
      chiefComplaint: 'a complaint', examinationNotes: null, workingDiagnosis: null,
      decisionNotes: null, followUpAfterDays: null,
    }, c.doctor);
    confirmEncounter(c.db, encounterId, c.doctor);
    const sheet = buildPrescription(c.db, c.dir, visitId);
    assert.equal(sheet.vitalsLine, '');
    assert.equal(sheet.followUpDate, null);
  });

  test('the doctor can keep the diagnosis off the paper the patient carries', () => {
    fillIn(c.dir, 'print_diagnosis: false\nprint_vitals: false');
    const visitId = newVisit(c.db, c.desk.id);
    const encounterId = aFullConsultation(c, visitId);
    confirmEncounter(c.db, encounterId, c.doctor);
    const sheet = buildPrescription(c.db, c.dir, visitId);
    assert.equal(sheet.diagnosis, null);
    assert.equal(sheet.vitalsLine, '');
    fillIn(c.dir);
  });

  test('printing is recorded, and a reprint is recorded as a reprint', () => {
    const visitId = newVisit(c.db, c.desk.id);
    const encounterId = aFullConsultation(c, visitId);
    confirmEncounter(c.db, encounterId, c.doctor);

    assert.equal(buildPrescription(c.db, c.dir, visitId).timesPrinted, 0);
    recordPrescriptionPrinted(c.db, visitId, c.doctor);
    assert.equal(buildPrescription(c.db, c.dir, visitId).timesPrinted, 1);
    recordPrescriptionPrinted(c.db, visitId, c.doctor);
    assert.equal(buildPrescription(c.db, c.dir, visitId).timesPrinted, 2);

    const events = (c.db.prepare(
      `SELECT event_type AS type FROM usage_event WHERE visit_id = ? AND event_type LIKE 'prescription%' ORDER BY timestamp, id`,
    ).all(visitId) as Array<{ type: string }>).map((r) => r.type);
    assert.deepEqual(events, ['prescription_printed', 'prescription_reprinted']);
  });

  test('the front desk cannot print a prescription', () => {
    const visitId = newVisit(c.db, c.desk.id);
    const encounterId = aFullConsultation(c, visitId);
    confirmEncounter(c.db, encounterId, c.doctor);
    assert.throws(() => recordPrescriptionPrinted(c.db, visitId, c.desk), NotAllowedError);
  });

  test('nothing on the sheet was written by the software', () => {
    // A blunt guard against somebody later adding a helpful sentence.
    // Every string on this sheet comes from a person: the doctor typed
    // the clinical text, and the doctor typed the letterhead.
    const visitId = newVisit(c.db, c.desk.id);
    const encounterId = aFullConsultation(c, visitId);
    confirmEncounter(c.db, encounterId, c.doctor);
    const sheet = buildPrescription(c.db, c.dir, visitId);

    const typed = new Set<string>([
      'PLACEHOLDER DRUG 1', 'PLACEHOLDER DRUG 2', 'CBC with ESR', 'X-ray chest PA view',
      'the clinician\'s own wording',
      'Eat before the tablet. Come back sooner if the pain wakes you at night.',
    ]);
    for (const medication of sheet.medications) assert.ok(typed.has(medication.drugName));
    for (const test of sheet.investigations) assert.ok(typed.has(test));
    assert.ok(typed.has(sheet.diagnosis!));
    assert.ok(typed.has(sheet.advice!));
  });
});
