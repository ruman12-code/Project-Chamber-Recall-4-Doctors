import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { provision } from '../src/main/db/provision';
import { newId } from '../src/main/db/ids';
import { nowIso } from '../src/main/db/clock';
import type { Db } from '../src/main/db/open';
import { addStaff } from '../src/main/auth/staff';
import { recordConsent } from '../src/main/consent/store';
import { openEncounter, saveDraft, setMedications, setInvestigations, confirmEncounter } from '../src/main/clinical/encounter';
import { saveVitals } from '../src/main/clinical/vitals';
import { addAttachment } from '../src/main/attachments/store';
import { buildPatientCopy, patientCopyFiles, recordPatientCopyGiven, PatientCopyError } from '../src/main/export/patientCopy';
import { NotAllowedError } from '../src/main/clinical/access';
import { tempDir } from './helpers';

/**
 * Milestone 12, the second half. The copy a patient can ask for.
 *
 * The consent wording promises it — "you can ask for a copy of your
 * information at any time" — and the Personal Data Protection Act
 * requires it. These tests are about the promise being kept in full.
 */

const system = { id: null, role: 'system' as const };
const CHAMBER = 'chamber-a';
const TODAY = '2026-08-25';

function chamber() {
  const t = tempDir();
  const db = provision(t.dir, 'passphrase', 'demo').db;
  const doctorId = addStaff(db, { displayName: 'Dr Ashraful', role: 'doctor', pin: '4021' }, system);
  const deskId = addStaff(db, { displayName: 'Biplob', role: 'front_desk', pin: '6172' }, { id: doctorId, role: 'doctor' });
  db.prepare('INSERT INTO chamber (id, name, created_at) VALUES (?, ?, ?)').run(CHAMBER, 'Popular Chamber', nowIso());
  return {
    db, dir: t.dir, cleanup: t.cleanup,
    doctor: { id: doctorId, role: 'doctor' as const },
    desk: { id: deskId, role: 'front_desk' as const },
  };
}

let serial = 0;
function aPatientWithHistory(c: ReturnType<typeof chamber>) {
  const patientId = newId();
  c.db.prepare(`INSERT INTO patient (id, full_name_bn, full_name_en, search_name_en, phone,
                  approx_age_years, approx_age_recorded_on, sex, address_free_text,
                  created_at, created_by, updated_at)
                VALUES (?, 'তাসলিমা বেগম', 'Taslima Begum', 'taslima begum', '01711000000',
                  44, ?, 'female', 'PLACEHOLDER address', ?, ?, ?)`)
    .run(patientId, TODAY, nowIso(), c.desk.id, nowIso());

  const visitOf = (date: string) => {
    serial += 1;
    const visitId = newId();
    c.db.prepare(`INSERT INTO visit (id, patient_id, chamber_id, visit_date, serial_no, arrived_at,
                    status, created_at, created_by, updated_at)
                  VALUES (?, ?, ?, ?, ?, ?, 'done', ?, ?, ?)`)
      .run(visitId, patientId, CHAMBER, date, serial, `${date}T17:00:00.000Z`, nowIso(), c.desk.id, nowIso());
    return visitId;
  };

  // An older visit, fully written up.
  const older = visitOf('2026-05-02');
  const olderEncounter = openEncounter(c.db, older, c.doctor);
  saveDraft(c.db, olderEncounter, {
    chiefComplaint: 'stomach pain after eating',
    examinationNotes: 'PLACEHOLDER — examination findings',
    workingDiagnosis: 'PLACEHOLDER — the clinician\'s own wording',
    decisionNotes: 'Eat before the tablet.',
    followUpAfterDays: 30,
  }, c.doctor);
  setMedications(c.db, olderEncounter, [
    { drugName: 'PLACEHOLDER DRUG 1', strength: '20 mg', dose: '1 tab', frequency: '1+0+0', durationDays: 30, instructions: null },
  ], c.doctor);
  setInvestigations(c.db, olderEncounter, ['CBC with ESR'], c.doctor);
  saveVitals(c.db, older, {
    systolic: 148, diastolic: 92, pulse: 84, temperature: { typed: 99.8, unit: 'F' },
    weightKg: 76.4, heightCm: null, randomBloodSugar: null, spo2: 97, notes: null,
  }, c.doctor);
  confirmEncounter(c.db, olderEncounter, c.doctor);

  // Today: an intake at the front desk, with a warning raised.
  const today = visitOf(TODAY);
  const intakeId = newId();
  c.db.prepare(`INSERT INTO intake (id, visit_id, recorded_by, started_at, completed_at, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(intakeId, today, c.desk.id, nowIso(), nowIso(), nowIso(), nowIso());
  c.db.prepare(`INSERT INTO intake_answer (id, intake_id, question_key, answer_value, answer_free_text,
                  was_skipped, created_at, updated_at)
                VALUES (?, ?, 'presenting_complaint', NULL, 'পেটে ব্যথা', 0, ?, ?)`)
    .run(newId(), intakeId, nowIso(), nowIso());
  c.db.prepare(`INSERT INTO intake_answer (id, intake_id, question_key, answer_value, answer_free_text,
                  was_skipped, created_at, updated_at)
                VALUES (?, ?, 'allergies', NULL, NULL, 1, ?, ?)`)
    .run(newId(), intakeId, nowIso(), nowIso());
  c.db.prepare(`INSERT INTO red_flag_event (id, intake_id, rule_id, rule_version, fired_at)
                VALUES (?, ?, 'placeholder_rule', '1', ?)`)
    .run(newId(), intakeId, nowIso());

  // A paper they brought in.
  const jpeg = Buffer.alloc(600, 0x20);
  jpeg[0] = 0xff; jpeg[1] = 0xd8; jpeg[2] = 0xff; jpeg[3] = 0xe0;
  addAttachment(c.db, {
    patientId, visitId: today, kind: 'report', caption: 'CBC from another centre',
    documentDate: '2026-08-12', content: jpeg, contentType: 'image/jpeg',
    width: 900, height: 1200, source: 'tablet',
  }, c.desk);

  recordConsent(c.db, {
    patientId, kind: 'care_record', version: 'consent-v1', decision: 'given',
    givenBy: 'self', givenByName: null, relationship: null, method: 'read_aloud', language: 'bn',
  }, c.desk);

  return patientId;
}

describe('a patient asking for their copy', () => {
  let c: ReturnType<typeof chamber>; let patientId = '';
  before(() => { c = chamber(); patientId = aPatientWithHistory(c); });
  after(() => { c.db.close(); c.cleanup(); });

  test('it holds who they are, including how the age is known', () => {
    const copy = buildPatientCopy(c.db, patientId, new Date(`${TODAY}T18:00:00Z`));
    assert.equal(copy.patient.nameBn, 'তাসলিমা বেগম');
    assert.equal(copy.patient.phone, '01711000000');
    assert.equal(copy.patient.ageYears, 44);
    assert.equal(copy.patient.ageIsApproximate, true);
  });

  test('every visit is there, newest first', () => {
    const copy = buildPatientCopy(c.db, patientId);
    assert.equal(copy.visits.length, 2);
    assert.equal(copy.visits[0]!.visitDate, TODAY);
    assert.equal(copy.visits[1]!.visitDate, '2026-05-02');
  });

  test('what the doctor wrote is in it, in his own words', () => {
    const copy = buildPatientCopy(c.db, patientId);
    const older = copy.visits[1]!;
    assert.equal(older.complaint, 'stomach pain after eating');
    assert.equal(older.diagnosis, 'PLACEHOLDER — the clinician\'s own wording');
    assert.equal(older.decision, 'Eat before the tablet.');
    assert.equal(older.followUpAfterDays, 30);
    assert.equal(older.confirmedByDoctor, true);
    assert.equal(older.medications[0]!.drugName, 'PLACEHOLDER DRUG 1');
    assert.equal(older.investigations[0]!.testName, 'CBC with ESR');
  });

  test('what was measured is there, in the scale it is stored in', () => {
    const copy = buildPatientCopy(c.db, patientId);
    const older = copy.visits[1]!;
    assert.equal(older.vitals!.systolic, 148);
    assert.equal(older.vitals!.temperatureC, 37.7);
    assert.equal(older.vitals!.randomBloodSugar, null, 'a reading nobody took is not invented');
  });

  test('what they told the front desk is there, in their own words', () => {
    const copy = buildPatientCopy(c.db, patientId);
    const today = copy.visits[0]!;
    const complaint = today.whatTheyTold.find((a) => a.questionKey === 'presenting_complaint');
    assert.equal(complaint!.freeText, 'পেটে ব্যথা');
    const allergies = today.whatTheyTold.find((a) => a.questionKey === 'allergies');
    assert.equal(allergies!.skipped, true);
  });

  test('the screening warnings are in the complete copy, because they are their data', () => {
    const copy = buildPatientCopy(c.db, patientId);
    assert.equal(copy.visits[0]!.warningsRaised.length, 1);
    assert.equal(copy.visits[0]!.warningsRaised[0]!.ruleId, 'placeholder_rule');
  });

  test('the papers they brought are listed, with the date on the paper', () => {
    const copy = buildPatientCopy(c.db, patientId);
    assert.equal(copy.papers.length, 1);
    assert.equal(copy.papers[0]!.documentDate, '2026-08-12');
    assert.match(copy.papers[0]!.fileName, /^paper-2026-08-12-.*\.jpg$/);
  });

  test('the pictures themselves come with it, so they get their reports back', () => {
    const copy = buildPatientCopy(c.db, patientId);
    const files = patientCopyFiles(c.db, copy);
    assert.equal(files.length, 1);
    assert.equal(files[0]!.name, copy.papers[0]!.fileName);
    assert.equal(files[0]!.content.length, 600);
  });

  test('what they agreed to, and when, is part of their copy', () => {
    const copy = buildPatientCopy(c.db, patientId);
    assert.equal(copy.permissions.length, 1);
    assert.equal(copy.permissions[0]!.kind, 'care_record');
    assert.equal(copy.permissions[0]!.decision, 'given');
  });

  test('a patient who is not there is refused rather than given an empty copy', () => {
    assert.throws(() => buildPatientCopy(c.db, 'no-such-patient'), PatientCopyError);
  });

  test('giving one is recorded, and says which form it was given in', () => {
    recordPatientCopyGiven(c.db, patientId, 'printed', c.doctor);
    recordPatientCopyGiven(c.db, patientId, 'file', c.doctor);
    const rows = (c.db.prepare(
      `SELECT details_json AS details FROM audit_log WHERE action = 'patient_copy_given' AND entity_id = ?
       ORDER BY id`,
    ).all(patientId) as Array<{ details: string }>).map((r) => JSON.parse(r.details) as { how: string });
    assert.deepEqual(rows.map((r) => r.how), ['printed', 'file']);
  });

  test('the front desk does not hand out whole records', () => {
    assert.throws(() => recordPatientCopyGiven(c.db, patientId, 'file', c.desk), NotAllowedError);
  });
});
