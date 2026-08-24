import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { provision } from '../src/main/db/provision';
import { newId } from '../src/main/db/ids';
import { nowIso } from '../src/main/db/clock';
import type { Db } from '../src/main/db/open';
import { addStaff } from '../src/main/auth/staff';
import { recordConsent, withdrawConsent } from '../src/main/consent/store';
import { setVisitStatus } from '../src/main/queue/register';
import { openEncounter, saveDraft, confirmEncounter } from '../src/main/clinical/encounter';
import { buildPilotReport, share, TOO_FEW_FOR_A_PERCENTAGE } from '../src/main/report/pilot';
import { buildResearchExport, toCsv, researchReadme, recordResearchExport } from '../src/main/report/research';
import { NotAllowedError } from '../src/main/clinical/access';
import { patientAgeYears } from '../src/main/db/age';
import { tempDir } from './helpers';

/**
 * Milestone 13. The report the decision is made from.
 *
 * What these tests hold in place: it counts and never concludes, every
 * number carries its denominator, the failures are counted as
 * carefully as the successes, and the research export contains only
 * the patients who agreed to it and no free text at all.
 */

const system = { id: null, role: 'system' as const };
const CHAMBER = 'chamber-a';
const VERSION = 'consent-v1';

function chamber() {
  const t = tempDir();
  const db = provision(t.dir, 'passphrase', 'demo').db;
  const doctorId = addStaff(db, { displayName: 'Dr Ashraful', role: 'doctor', pin: '4021' }, system);
  const jahidId = addStaff(db, { displayName: 'Jahid', role: 'front_desk', pin: '6172' }, { id: doctorId, role: 'doctor' });
  const shopnaId = addStaff(db, { displayName: 'Shopna', role: 'front_desk', pin: '7483' }, { id: doctorId, role: 'doctor' });
  db.prepare('INSERT INTO chamber (id, name, created_at) VALUES (?, ?, ?)').run(CHAMBER, 'Popular Chamber', nowIso());
  return {
    db, dir: t.dir, cleanup: t.cleanup,
    doctor: { id: doctorId, role: 'doctor' as const },
    jahid: { id: jahidId, role: 'front_desk' as const },
    shopna: { id: shopnaId, role: 'front_desk' as const },
  };
}

let serial = 0;
function addPatient(db: Db, createdBy: string): string {
  const id = newId();
  db.prepare(`INSERT INTO patient (id, full_name_bn, search_name_en, approx_age_years,
                approx_age_recorded_on, sex, created_at, created_by, updated_at)
              VALUES (?, 'রোগী', 'patient', 40, '2026-08-01', 'female', ?, ?, ?)`)
    .run(id, nowIso(), createdBy, nowIso());
  return id;
}

function addVisit(db: Db, patientId: string, date: string, createdBy: string, opts: { seenAfterMinutes?: number } = {}): string {
  serial += 1;
  const id = newId();
  const arrivedAt = `${date}T17:00:00.000Z`;
  const seenAt = opts.seenAfterMinutes === undefined ? null
    : new Date(Date.parse(arrivedAt) + opts.seenAfterMinutes * 60000).toISOString();
  db.prepare(`INSERT INTO visit (id, patient_id, chamber_id, visit_date, serial_no, arrived_at, seen_at,
                status, created_at, created_by, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, 'waiting', ?, ?, ?)`)
    .run(id, patientId, CHAMBER, date, serial, arrivedAt, seenAt, nowIso(), createdBy, nowIso());
  return id;
}

function addIntake(
  db: Db, visitId: string, by: string,
  opts: { finished?: boolean; skipped?: number; answered?: number; minutes?: number; flagged?: boolean } = {},
): string {
  const id = newId();
  const startedAt = nowIso();
  const completedAt = opts.finished === false ? null
    : new Date(Date.parse(startedAt) + (opts.minutes ?? 3) * 60000).toISOString();
  db.prepare(`INSERT INTO intake (id, visit_id, recorded_by, started_at, completed_at, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id, visitId, by, startedAt, completedAt, startedAt, startedAt);
  for (let i = 0; i < (opts.answered ?? 3); i++) {
    db.prepare(`INSERT INTO intake_answer (id, intake_id, question_key, answer_value, was_skipped, created_at, updated_at)
                VALUES (?, ?, ?, 'mild', 0, ?, ?)`).run(newId(), id, `q${i}`, startedAt, startedAt);
  }
  for (let i = 0; i < (opts.skipped ?? 0); i++) {
    db.prepare(`INSERT INTO intake_answer (id, intake_id, question_key, answer_value, was_skipped, created_at, updated_at)
                VALUES (?, ?, ?, NULL, 1, ?, ?)`).run(newId(), id, `s${i}`, startedAt, startedAt);
  }
  if (opts.flagged === true) {
    db.prepare(`INSERT INTO red_flag_event (id, intake_id, rule_id, rule_version, fired_at)
                VALUES (?, ?, 'placeholder_rule', '1', ?)`).run(newId(), id, startedAt);
  }
  return id;
}

describe('counting without concluding', () => {
  let c: ReturnType<typeof chamber>;
  before(() => {
    c = chamber();
    // Two assistants with different habits, which is the whole reason
    // the numbers are broken out per person.
    for (let i = 0; i < 4; i++) {
      const patientId = addPatient(c.db, c.jahid.id);
      const visitId = addVisit(c.db, patientId, '2026-08-20', c.jahid.id, { seenAfterMinutes: 20 + i });
      addIntake(c.db, visitId, c.jahid.id, { answered: 6, skipped: 0, minutes: 4 });
    }
    for (let i = 0; i < 3; i++) {
      const patientId = addPatient(c.db, c.shopna.id);
      const visitId = addVisit(c.db, patientId, '2026-08-21', c.shopna.id, { seenAfterMinutes: 40 });
      addIntake(c.db, visitId, c.shopna.id, { answered: 2, skipped: 4, minutes: 1, finished: i !== 2 });
    }
    // Somebody nobody asked anything.
    addVisit(c.db, addPatient(c.db, c.jahid.id), '2026-08-21', c.jahid.id);
  });
  after(() => { c.db.close(); c.cleanup(); });

  test('the period is the days there were actually patients', () => {
    const report = buildPilotReport(c.db);
    assert.equal(report.firstDay, '2026-08-20');
    assert.equal(report.lastDay, '2026-08-21');
    assert.equal(report.eveningsHeld, 2);
    assert.deepEqual(report.chambers, ['Popular Chamber']);
  });

  test('coverage is counted against arrivals, not against itself', () => {
    const report = buildPilotReport(c.db);
    assert.equal(report.screening.arrivals, 8);
    assert.equal(report.screening.intakesStarted, 7);
    assert.equal(report.screening.intakesFinished, 6);
  });

  test('the two assistants are counted separately, because that is the point', () => {
    const report = buildPilotReport(c.db);
    const jahid = report.screening.perPerson.find((p) => p.name === 'Jahid')!;
    const shopna = report.screening.perPerson.find((p) => p.name === 'Shopna')!;

    assert.equal(jahid.questionsSkipped, 0);
    assert.equal(jahid.questionsAsked, 24);
    assert.equal(shopna.questionsSkipped, 12);
    assert.equal(jahid.medianMinutes, 4);
    assert.equal(shopna.medianMinutes, 1);
  });

  test('waiting time is the middle of the range, with how many it came from', () => {
    const report = buildPilotReport(c.db);
    assert.equal(report.waiting.counted, 7);
    assert.equal(report.waiting.medianMinutes, 23, 'the middle of 20,21,22,23,40,40,40');
    assert.equal(report.waiting.longestMinutes, 40);
  });

  test('a visit nobody screened is counted as a gap, not left out', () => {
    const report = buildPilotReport(c.db);
    const gap = report.gaps.find((g) => g.what === 'Visits with no intake at all');
    assert.equal(gap?.count, 1);
    assert.match(gap!.why, /no red flag rule was ever checked/);
  });

  test('an abandoned intake is counted as a gap', () => {
    const report = buildPilotReport(c.db);
    assert.equal(report.gaps.find((g) => g.what === 'Intakes started and never finished')?.count, 1);
  });

  test('nothing in the report is a verdict', () => {
    const report = buildPilotReport(c.db);
    const text = JSON.stringify(report).toLowerCase();
    for (const word of ['success', 'successful', 'failed the pilot', 'recommend', 'score', 'rating', 'grade']) {
      assert.ok(!text.includes(word), `the report used the word "${word}"`);
    }
  });
});

describe('small numbers', () => {
  test('below twenty there is no percentage, because a percentage of seven is not evidence', () => {
    assert.equal(share(4, 7), '4 of 7');
    assert.equal(share(0, 0), 'none yet');
    assert.equal(share(1, TOO_FEW_FOR_A_PERCENTAGE), `5% (1 of ${TOO_FEW_FOR_A_PERCENTAGE})`);
  });

  test('and above it the count is still shown beside the percentage', () => {
    assert.equal(share(30, 60), '50% (30 of 60)');
  });
});

describe('the number that matters most', () => {
  let c: ReturnType<typeof chamber>;
  before(() => { c = chamber(); });
  after(() => { c.db.close(); c.cleanup(); });

  test('a flagged patient who goes home is counted, by itself, near the top', () => {
    const patientId = addPatient(c.db, c.jahid.id);
    const visitId = addVisit(c.db, patientId, '2026-08-22', c.jahid.id);
    addIntake(c.db, visitId, c.jahid.id, { flagged: true });
    setVisitStatus(c.db, visitId, 'left', c.jahid);

    const report = buildPilotReport(c.db);
    assert.equal(report.safety.flagsFired, 1);
    assert.equal(report.safety.visitsFlagged, 1);
    assert.equal(report.safety.flaggedLeftUnseen, 1);

    const gap = report.gaps.find((g) => g.what === 'Flagged patients who left without being seen');
    assert.equal(gap?.count, 1);
    assert.match(gap!.why, /by name/);
  });

  test('an unconfirmed consultation is counted as a draft, not as a consultation', () => {
    const patientId = addPatient(c.db, c.jahid.id);
    const visitId = addVisit(c.db, patientId, '2026-08-22', c.jahid.id);
    const encounterId = openEncounter(c.db, visitId, c.doctor);
    saveDraft(c.db, encounterId, {
      chiefComplaint: 'a complaint', examinationNotes: null, workingDiagnosis: null,
      decisionNotes: null, followUpAfterDays: null,
    }, c.doctor);

    const before = buildPilotReport(c.db);
    assert.equal(before.record.encountersWritten, 1);
    assert.equal(before.record.encountersConfirmed, 0);
    assert.equal(before.gaps.find((g) => g.what === 'Consultations written and never confirmed')?.count, 1);

    confirmEncounter(c.db, encounterId, c.doctor);
    const after = buildPilotReport(c.db);
    assert.equal(after.record.encountersConfirmed, 1);
    assert.equal(after.gaps.find((g) => g.what === 'Consultations written and never confirmed'), undefined);
  });
});

describe('the export the research consent was for', () => {
  let c: ReturnType<typeof chamber>;
  let yes = ''; let no = ''; let neverAsked = ''; let withdrew = '';

  before(() => {
    c = chamber();
    const setUp = (decision: 'given' | 'declined' | null) => {
      const patientId = addPatient(c.db, c.jahid.id);
      const visitId = addVisit(c.db, patientId, '2026-08-23', c.jahid.id, { seenAfterMinutes: 25 });
      addIntake(c.db, visitId, c.jahid.id, { answered: 4, skipped: 1, flagged: true });
      if (decision !== null) {
        recordConsent(c.db, {
          patientId, kind: 'research', version: VERSION, decision,
          givenBy: 'self', givenByName: null, relationship: null, method: 'read_aloud', language: 'bn',
        }, c.jahid);
      }
      return patientId;
    };
    yes = setUp('given');
    no = setUp('declined');
    neverAsked = setUp(null);
    withdrew = setUp('given');
    withdrawConsent(c.db, withdrew, 'research', c.doctor, 'changed their mind');
  });
  after(() => { c.db.close(); c.cleanup(); });

  test('only the patients who said yes are in it', () => {
    const exported = buildResearchExport(c.db, VERSION);
    assert.equal(exported.patientsIncluded, 1);
    assert.equal(exported.patientsExcluded, 3);
    assert.equal(exported.rows.length, 1);
  });

  test('somebody who withdrew is out of every export made afterwards', () => {
    const exported = buildResearchExport(c.db, VERSION);
    const codes = new Set(exported.rows.map((r) => r.patient_code));
    assert.equal(codes.size, 1);
    // And the excluded ones are the three who did not agree, one of
    // whom had agreed once.
    assert.equal(exported.patientsExcluded, 3);
    assert.notEqual(yes, withdrew);
    assert.notEqual(no, neverAsked);
  });

  test('there is no name, no phone number and no free text anywhere in it', () => {
    const csv = toCsv(buildResearchExport(c.db, VERSION));
    for (const forbidden of ['রোগী', 'patient_name', 'phone', 'complaint', 'diagnosis', 'notes']) {
      assert.ok(!csv.includes(forbidden), `the export contained "${forbidden}"`);
    }
  });

  test('what it does carry is countable: coded answers, rules, numbers', () => {
    const exported = buildResearchExport(c.db, VERSION);
    const row = exported.rows[0]!;
    assert.equal(row.questions_answered, 4);
    assert.equal(row.questions_skipped, 1);
    assert.equal(row.rules_fired, 1);
    assert.equal(row.rule_ids, 'placeholder_rule@1');
    assert.equal(row.waited_minutes, 25);
    assert.equal(row.age_years, 40);
  });

  test('the patient code is meaningless outside the file, and different every time', () => {
    const first = buildResearchExport(c.db, VERSION).rows[0]!.patient_code;
    const second = buildResearchExport(c.db, VERSION).rows[0]!.patient_code;
    assert.notEqual(first, second);
    assert.notEqual(first, yes, 'the code must not be the patient id');
  });

  test('the note in the folder says it is de-identified rather than anonymous', () => {
    const readme = researchReadme(buildResearchExport(c.db, VERSION), '2026-08-25T19:00:00.000Z');
    assert.match(readme, /DE-IDENTIFIED, NOT ANONYMOUS/);
    assert.match(readme, /no free text of any kind/i);
    assert.match(readme, /do not email it/i);
  });

  test('the front desk cannot make one', () => {
    const exported = buildResearchExport(c.db, VERSION);
    assert.throws(() => recordResearchExport(c.db, exported, c.jahid), NotAllowedError);
  });

  test('making one is recorded, with how many patients were left out', () => {
    const exported = buildResearchExport(c.db, VERSION);
    recordResearchExport(c.db, exported, c.doctor);
    const row = c.db.prepare(
      `SELECT details_json AS details FROM audit_log WHERE action = 'research_export_made'`).get() as { details: string };
    const details = JSON.parse(row.details) as { patients: number; excluded: number };
    assert.equal(details.patients, 1);
    assert.equal(details.excluded, 3);
  });
});

describe('an age estimated on one day, asked about another', () => {
  test('ages forward, which is the case that goes wrong quietly', () => {
    const source = { dob: null, approx_age_years: 45, approx_age_recorded_on: '2023-08-22' };
    assert.equal(patientAgeYears(source, new Date('2026-08-25T00:00:00Z')), 48);
  });

  test('and backwards, because the report asks about visits before it was written down', () => {
    const source = { dob: null, approx_age_years: 45, approx_age_recorded_on: '2026-08-22' };
    assert.equal(patientAgeYears(source, new Date('2024-08-25T00:00:00Z')), 43);
  });

  test('but never to before they were born', () => {
    const source = { dob: null, approx_age_years: 2, approx_age_recorded_on: '2026-08-22' };
    assert.equal(patientAgeYears(source, new Date('2020-08-25T00:00:00Z')), null);
  });
});
