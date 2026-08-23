import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { provision } from '../src/main/db/provision';
import { nowIso } from '../src/main/db/clock';
import type { Db } from '../src/main/db/open';
import { registerPatient } from '../src/main/patients/register';
import { unassignedActor } from '../src/main/db/users';
import { loadConsentConfig } from '../src/main/consent/config';
import { recordConsent, consentState, withdrawConsent, patientsConsentingToResearch, ConsentRefusedError } from '../src/main/consent/store';
import { consentPath, consentAudioDir } from '../src/main/paths';
import { tempDir } from './helpers';

const ACTOR = unassignedActor('front_desk');
const VERSION = 'test-consent-v1';

function newChamber() {
  const t = tempDir();
  const db = provision(t.dir, 'passphrase', 'demo').db;
  return { dir: t.dir, db, cleanup: t.cleanup };
}
function addPatient(db: Db, name = 'Consent Patient') {
  return registerPatient(db, { fullNameBn: null, fullNameEn: name, phone: null, dob: null,
    approxAgeYears: 40, sex: 'male', addressFreeText: null }, ACTOR);
}

describe('the consent wording as shipped', () => {
  const c = newChamber();
  const outcome = loadConsentConfig(c.dir);
  after(() => { c.db.close(); c.cleanup(); });

  test('is readable and complete', () => {
    assert.deepEqual(outcome.problems, []);
    assert.ok(outcome.config);
    assert.ok(outcome.config!.careRecord.points.length >= 5);
    assert.ok(outcome.config!.research.points.length >= 3);
  });

  test('cannot be put to a real patient until somebody approves it', () => {
    // It describes what happens to a person's medical history, and
    // health information is sensitive personal data under Bangladeshi
    // law. Shipping it pre-approved would be me approving it.
    assert.ok(outcome.blocksLiveUse.length > 0);
    assert.ok(outcome.blocksLiveUse.some((b) => /approved the consent wording/i.test(b.reason)));
  });

  test('the refusal says a lawyer needs to see it, not just the doctor', () => {
    const block = outcome.blocksLiveUse.find((b) => /approved the consent wording/i.test(b.reason))!;
    assert.match(block.whatToDo, /lawyer/i);
    assert.match(block.whatToDo, /Personal Data Protection Act/i);
  });

  test('tells the patient the things the law requires them to be told', () => {
    const text = outcome.config!.careRecord.points.map((p) => `${p.bn} ${p.en}`).join(' ').toLowerCase();
    assert.match(text, /written down|লিখে রাখা/, 'what is collected');
    assert.match(text, /doctor can see|ডাক্তার/, 'what it is for');
    assert.match(text, /laptop|ল্যাপটপ/, 'where it is kept');
    assert.match(text, /nobody else|আর কেউ না/, 'who else can see it');
    assert.match(text, /say no|না বললে/, 'that refusing is allowed');
    assert.match(text, /copy|কপি/, 'how to get a copy');
    assert.match(text, /removed|মুছে/, 'how to ask for removal');
  });

  test('research is asked as a separate question and says so', () => {
    const text = outcome.config!.research.points.map((p) => `${p.bn} ${p.en}`).join(' ').toLowerCase();
    assert.match(text, /separate question|আলাদা/, 'it must not read as part of the first permission');
    assert.match(text, /changes nothing|পার্থক্য হবে না/, 'refusing must not sound risky');
  });

  test('knows when the spoken recording has not been made', () => {
    assert.equal(outcome.config!.careRecord.audioAvailable.bn, false);
  });

  test('and notices when it has', () => {
    mkdirSync(consentAudioDir(c.dir), { recursive: true });
    writeFileSync(join(consentAudioDir(c.dir), 'consent-care-bn.m4a'), 'not really audio');
    assert.equal(loadConsentConfig(c.dir).config!.careRecord.audioAvailable.bn, true);
  });
});

describe('a consent file that is not fit to use', () => {
  test('missing wording blocks everything and says so', () => {
    const c = newChamber();
    require('node:fs').rmSync(consentPath(c.dir));
    const outcome = loadConsentConfig(c.dir);
    assert.equal(outcome.config, null);
    assert.ok(outcome.blocksLiveUse.length > 0);
    c.db.close(); c.cleanup();
  });

  test('a point written in only one language is refused', () => {
    const c = newChamber();
    const text = readFileSync(consentPath(c.dir), 'utf8')
      .replace('    - bn: "ডাক্তার দেখানোর আগে আমরা আপনাকে কয়েকটি প্রশ্ন করব। আপনি যা বলবেন তা লিখে রাখা হবে।"\n      en: "Before you see the doctor we will ask you a few questions. What you say will be written down."',
               '    - bn: "ডাক্তার দেখানোর আগে আমরা আপনাকে কয়েকটি প্রশ্ন করব।"');
    writeFileSync(consentPath(c.dir), text, 'utf8');
    const outcome = loadConsentConfig(c.dir);
    assert.ok(outcome.problems.some((p) => /both languages/i.test(p.problem)));
    c.db.close(); c.cleanup();
  });

  test('wording still marked a draft blocks live use', () => {
    const c = newChamber();
    const text = readFileSync(consentPath(c.dir), 'utf8')
      .replace('approved_by: ""', 'approved_by: "Dr Test"')
      .replace('approved_on: ""', 'approved_on: "2026-09-01"');
    writeFileSync(consentPath(c.dir), text, 'utf8');
    const outcome = loadConsentConfig(c.dir);
    assert.ok(outcome.blocksLiveUse.some((b) => /draft/i.test(b.reason)),
      'approving a draft without renaming it must not be enough');
    c.db.close(); c.cleanup();
  });

  test('approved, dated and no longer a draft passes', () => {
    const c = newChamber();
    const text = readFileSync(consentPath(c.dir), 'utf8')
      .replace('approved_by: ""', 'approved_by: "Dr Test and Adv. Test"')
      .replace('approved_on: ""', 'approved_on: "2026-09-01"')
      .replace('version: "care-and-research-2026-08-draft-1"', 'version: "care-and-research-2026-09"');
    writeFileSync(consentPath(c.dir), text, 'utf8');
    assert.deepEqual(loadConsentConfig(c.dir).blocksLiveUse, []);
    c.db.close(); c.cleanup();
  });
});

describe('recording what a patient decided', () => {
  let db: Db; let cleanup: () => void; let patientId: string;
  before(() => { const c = newChamber(); db = c.db; cleanup = c.cleanup; patientId = addPatient(db); });
  after(() => { db.close(); cleanup(); });

  test('a patient who has never been asked is shown as never asked', () => {
    const state = consentState(db, patientId, VERSION);
    assert.equal(state.careRecord, 'not_asked');
    assert.equal(state.research, 'not_asked');
  });

  test('agreeing is recorded with how they were told and who answered', () => {
    recordConsent(db, { patientId, kind: 'care_record', version: VERSION, decision: 'given',
      method: 'audio', language: 'bn', givenBy: 'family_member', relationship: 'son' }, ACTOR);
    const state = consentState(db, patientId, VERSION);
    assert.equal(state.careRecord, 'given');
    assert.equal(state.latest.careRecord!.method, 'audio');
    assert.equal(state.latest.careRecord!.givenBy, 'family_member');
    assert.equal(state.latest.careRecord!.relationship, 'son');
  });

  test('the two permissions are answered separately', () => {
    // Agreeing to a history being kept says nothing about research.
    assert.equal(consentState(db, patientId, VERSION).research, 'not_asked');
    recordConsent(db, { patientId, kind: 'research', version: VERSION, decision: 'declined',
      method: 'read_aloud', language: 'bn' }, ACTOR);
    const state = consentState(db, patientId, VERSION);
    assert.equal(state.careRecord, 'given');
    assert.equal(state.research, 'declined');
  });

  test('it is written to the audit log', () => {
    const row = db.prepare(`SELECT count(*) AS n FROM audit_log WHERE action IN ('consent_given', 'consent_declined')`)
      .get() as { n: number };
    assert.equal(row.n, 2);
  });

  test('a decision can never be edited or removed afterwards', () => {
    assert.throws(() => db.prepare(`UPDATE patient_consent SET decision = 'given'`).run(), /append-only/);
    assert.throws(() => db.prepare('DELETE FROM patient_consent').run(), /append-only/);
  });

  test('changing the wording asks the patient again', () => {
    // Consent against last year's words is not consent to this year's.
    const state = consentState(db, patientId, 'a-newer-version');
    assert.equal(state.careRecord, 'out_of_date');
    assert.equal(state.research, 'out_of_date');
  });

  test('consent recorded by nobody is refused', () => {
    assert.throws(() => recordConsent(db, { patientId, kind: 'care_record', version: VERSION,
      decision: 'given', method: 'audio', language: 'bn' }, { id: null, role: 'front_desk' }),
      ConsentRefusedError);
  });

  test('consent with no version is refused', () => {
    assert.throws(() => recordConsent(db, { patientId, kind: 'care_record', version: '  ',
      decision: 'given', method: 'audio', language: 'bn' }, ACTOR), ConsentRefusedError);
  });
});

describe('a patient changing their mind', () => {
  let db: Db; let cleanup: () => void; let patientId: string; let otherId: string;
  before(() => {
    const c = newChamber(); db = c.db; cleanup = c.cleanup;
    patientId = addPatient(db, 'Changed Mind');
    otherId = addPatient(db, 'Still Agreed');
    for (const id of [patientId, otherId]) {
      recordConsent(db, { patientId: id, kind: 'care_record', version: VERSION, decision: 'given', method: 'audio', language: 'bn' }, ACTOR);
      recordConsent(db, { patientId: id, kind: 'research', version: VERSION, decision: 'given', method: 'audio', language: 'bn' }, ACTOR);
    }
  });
  after(() => { db.close(); cleanup(); });

  test('both patients start in the research list', () => {
    assert.deepEqual(patientsConsentingToResearch(db, VERSION).sort(), [patientId, otherId].sort());
  });

  test('withdrawing is recorded as its own decision, leaving the earlier one intact', () => {
    withdrawConsent(db, patientId, 'research', ACTOR, 'asked at the desk');
    const rows = db.prepare(
      `SELECT decision FROM patient_consent WHERE patient_id = ? AND kind = 'research' ORDER BY rowid`)
      .all(patientId) as Array<{ decision: string }>;
    assert.deepEqual(rows.map((r) => r.decision), ['given', 'withdrawn']);
  });

  test('and they come out of the research list at once', () => {
    assert.deepEqual(patientsConsentingToResearch(db, VERSION), [otherId]);
  });

  test('withdrawing research does not touch the permission to keep a history', () => {
    assert.equal(consentState(db, patientId, VERSION).careRecord, 'given');
  });

  test('a withdrawn permission reads as withdrawn, not as never asked', () => {
    assert.equal(consentState(db, patientId, VERSION).research, 'withdrawn');
  });

  test('withdrawing something never given is refused clearly', () => {
    const fresh = addPatient(db, 'Never Asked');
    assert.throws(() => withdrawConsent(db, fresh, 'research', ACTOR), ConsentRefusedError);
  });

  test('withdrawing twice is harmless', () => {
    withdrawConsent(db, patientId, 'research', ACTOR);
    const rows = db.prepare(
      `SELECT count(*) AS n FROM patient_consent WHERE patient_id = ? AND kind = 'research'`).get(patientId) as { n: number };
    assert.equal(rows.n, 2, 'a second withdrawal adds nothing');
  });

  test('the research list is built from who said yes, never from who to leave out', () => {
    // A mistake in an opt-out list quietly includes somebody who
    // refused. The same mistake here quietly leaves out somebody who
    // agreed, which harms nobody.
    const declined = addPatient(db, 'Said No');
    recordConsent(db, { patientId: declined, kind: 'research', version: VERSION, decision: 'declined', method: 'audio', language: 'bn' }, ACTOR);
    assert.equal(patientsConsentingToResearch(db, VERSION).includes(declined), false);

    const neverAsked = addPatient(db, 'Never Asked At All');
    assert.equal(patientsConsentingToResearch(db, VERSION).includes(neverAsked), false);
  });

  test('consent against older wording does not count for research either', () => {
    assert.deepEqual(patientsConsentingToResearch(db, 'some-newer-version'), []);
  });
});
