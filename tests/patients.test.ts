import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { provision } from '../src/main/db/provision';
import { newId } from '../src/main/db/ids';
import { nowIso } from '../src/main/db/clock';
import type { Db } from '../src/main/db/open';
import { searchPatients, patientById, resolveToSurvivingPatient } from '../src/main/patients/search';
import { registerPatient, updatePatient, PatientNotValidError } from '../src/main/patients/register';
import { previewMerge, mergePatients, undoMerge, MergeRefusedError } from '../src/main/patients/merge';
import { searchablePhone } from '../src/main/db/names';
import { tempDir } from './helpers';

const DESK = { id: 'user-desk', role: 'front_desk' as const };
// Deliberately the real clock, not a fixed date. Patients registered by
// this test get today's date stamped on their estimated age, and a
// fixed AS_OF silently starts returning "age unknown" the first time
// the test runs after midnight.
const AS_OF = new Date();

function newChamber() {
  const t = tempDir();
  const db = provision(t.dir, 'passphrase', 'demo').db;
  db.prepare('INSERT INTO app_user (id, display_name, role, is_active, created_at) VALUES (?, ?, ?, 1, ?)')
    .run(DESK.id, 'Jahid', 'front_desk', nowIso());
  db.prepare('INSERT INTO chamber (id, name, created_at) VALUES (?, ?, ?)').run('ch-a', 'Green Life Chamber', nowIso());
  db.prepare('INSERT INTO chamber (id, name, created_at) VALUES (?, ?, ?)').run('ch-b', 'Al-Shifa Chamber', nowIso());
  return { db, cleanup: t.cleanup };
}

let serial = 0;
function addVisit(db: Db, patientId: string, date: string, chamberId = 'ch-a') {
  const id = newId();
  serial += 1;
  db.prepare(`INSERT INTO visit (id, patient_id, chamber_id, visit_date, serial_no, arrived_at, status, created_at, created_by, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, 'done', ?, ?, ?)`)
    .run(id, patientId, chamberId, date, serial, `${date}T17:00:00Z`, nowIso(), DESK.id, nowIso());
  return id;
}

describe('finding a patient', () => {
  let db: Db; let cleanup: () => void;
  let rafiq: string; let fatema: string; let noPhone: string;

  before(() => {
    const c = newChamber(); db = c.db; cleanup = c.cleanup;
    rafiq = registerPatient(db, {
      fullNameBn: 'মোহাম্মদ রফিক', fullNameEn: 'Mohammad Rafiq', phone: '01712-345678',
      dob: null, approxAgeYears: 52, sex: 'male', addressFreeText: 'Mirpur',
    }, DESK);
    fatema = registerPatient(db, {
      fullNameBn: 'ফাতেমা বেগম', fullNameEn: 'Fatema Begum', phone: '+8801812999888',
      dob: '1990-04-01', approxAgeYears: null, sex: 'female', addressFreeText: null,
    }, DESK);
    noPhone = registerPatient(db, {
      fullNameBn: 'নাম আছে ফোন নেই', fullNameEn: null, phone: null,
      dob: null, approxAgeYears: null, sex: null, addressFreeText: null,
    }, DESK);
    addVisit(db, rafiq, '2026-01-10', 'ch-b');
    addVisit(db, rafiq, '2026-07-04', 'ch-a');
    addVisit(db, fatema, '2025-12-01');
  });
  after(() => { db.close(); cleanup(); });

  test('a single match is still returned as a list', () => {
    // Nothing in this system selects a patient on the assistant's
    // behalf. There is no code path here that can return one patient
    // for a search term.
    const results = searchPatients(db, 'Fatema', { asOf: AS_OF });
    assert.equal(Array.isArray(results), true);
    assert.equal(results.length, 1);
  });

  test('matches part of an English name, ignoring capitals', () => {
    assert.equal(searchPatients(db, 'rafiq', { asOf: AS_OF })[0]!.id, rafiq);
    assert.equal(searchPatients(db, 'RAFIQ', { asOf: AS_OF })[0]!.id, rafiq);
    assert.equal(searchPatients(db, 'moham', { asOf: AS_OF })[0]!.id, rafiq);
  });

  test('matches part of a Bangla name', () => {
    assert.equal(searchPatients(db, 'রফিক', { asOf: AS_OF })[0]!.id, rafiq);
    assert.equal(searchPatients(db, 'ফাতেমা', { asOf: AS_OF })[0]!.id, fatema);
  });

  test('the same Bangla name typed on a different keyboard still matches', () => {
    // The same visible name can arrive as different code points. Without
    // normalisation these two would be different people.
    assert.equal(searchPatients(db, 'রফিক'.normalize('NFD'), { asOf: AS_OF })[0]!.id, rafiq);
  });

  describe('matches a phone number however it was written', () => {
    for (const written of ['01712345678', '01712-345678', '+8801712345678', '0171 234 5678', '8801712345678']) {
      test(written, () => {
        assert.equal(searchPatients(db, written, { asOf: AS_OF })[0]!.id, rafiq);
      });
    }
    test('and matches on the last few digits an assistant remembers', () => {
      assert.equal(searchPatients(db, '345678', { asOf: AS_OF })[0]!.id, rafiq);
    });
    test('a number stored with the country code is found without it', () => {
      assert.equal(searchPatients(db, '01812999888', { asOf: AS_OF })[0]!.id, fatema);
    });
  });

  test('every result row carries what the assistant needs to tell people apart', () => {
    const [result] = searchPatients(db, 'rafiq', { asOf: AS_OF });
    assert.equal(result!.nameBn, 'মোহাম্মদ রফিক');
    assert.equal(result!.ageYears, 52);
    assert.equal(result!.ageIsApproximate, true);
    assert.equal(result!.sex, 'male');
    assert.equal(result!.visitCount, 2);
    assert.equal(result!.lastVisitDate, '2026-07-04');
    assert.equal(result!.lastChamberName, 'Green Life Chamber');
  });

  test('a patient who has never been seen has no last visit rather than a wrong one', () => {
    const [result] = searchPatients(db, 'ফোন নেই', { asOf: AS_OF });
    assert.equal(result!.id, noPhone);
    assert.equal(result!.lastVisitDate, null);
    assert.equal(result!.visitCount, 0);
  });

  test('there is no phonetic matching, and that is on purpose', () => {
    // "Md." and "Mohammad" are the same man to a human and must not be
    // to this software. A confident wrong first result is far more
    // dangerous than making the assistant type another letter.
    assert.deepEqual(searchPatients(db, 'Md. Rafiq', { asOf: AS_OF }), []);
    assert.deepEqual(searchPatients(db, 'Rofik', { asOf: AS_OF }), []);
  });

  test('an empty or meaningless search returns nothing rather than everybody', () => {
    assert.deepEqual(searchPatients(db, '', { asOf: AS_OF }), []);
    assert.deepEqual(searchPatients(db, '   ', { asOf: AS_OF }), []);
  });

  test('a soft-deleted patient does not appear', () => {
    db.prepare('UPDATE patient SET deleted_at = ? WHERE id = ?').run(nowIso(), noPhone);
    assert.deepEqual(searchPatients(db, 'ফোন নেই', { asOf: AS_OF }), []);
    db.prepare('UPDATE patient SET deleted_at = NULL WHERE id = ?').run(noPhone);
  });

  test('the most recently seen patient comes first', () => {
    const results = searchPatients(db, '1', { asOf: AS_OF }).filter((r) => r.lastVisitDate !== null);
    assert.deepEqual(results.map((r) => r.lastVisitDate), ['2026-07-04', '2025-12-01']);
  });

  test('a search that reduces to nothing finds nothing rather than everybody', () => {
    // A lone trunk zero is not a phone number: stripping it leaves an
    // empty string, and an empty LIKE pattern would match every patient
    // in the chamber.
    assert.deepEqual(searchPatients(db, '0', { asOf: AS_OF }), []);
    assert.deepEqual(searchPatients(db, '+880', { asOf: AS_OF }), []);
    assert.deepEqual(searchPatients(db, '-', { asOf: AS_OF }), []);
  });
});

describe('normalising a phone number', () => {
  test('every way of writing one number reduces to the same thing', () => {
    const forms = ['01712345678', '01712-345678', '+8801712345678', '0171 234 5678', '8801712345678', '008801712345678'];
    const reduced = new Set(forms.map((f) => searchablePhone(f)));
    assert.equal(reduced.size, 1, `expected one form, got ${[...reduced].join(', ')}`);
    assert.equal([...reduced][0], '1712345678');
  });
  test('nothing at all reduces to nothing', () => {
    assert.equal(searchablePhone(''), null);
    assert.equal(searchablePhone('   '), null);
    assert.equal(searchablePhone(null), null);
  });
});

describe('registering a patient', () => {
  let db: Db; let cleanup: () => void;
  before(() => { const c = newChamber(); db = c.db; cleanup = c.cleanup; });
  after(() => { db.close(); cleanup(); });

  test('a name in either script is enough, and nothing else is required', () => {
    const id = registerPatient(db, {
      fullNameBn: 'শুধু নাম', fullNameEn: null, phone: null, dob: null,
      approxAgeYears: null, sex: null, addressFreeText: null,
    }, DESK);
    assert.ok(patientById(db, id));
  });

  test('a patient with no name at all is refused, in plain words', () => {
    try {
      registerPatient(db, { fullNameBn: '  ', fullNameEn: '', phone: '01711111111', dob: null,
        approxAgeYears: null, sex: null, addressFreeText: null }, DESK);
      assert.fail('expected a refusal');
    } catch (error) {
      assert.ok(error instanceof PatientNotValidError);
      assert.match(error.whatToDo, /Bangla or in English/);
    }
  });

  test('a date of birth and an estimated age together are refused', () => {
    assert.throws(() => registerPatient(db, { fullNameEn: 'Both', fullNameBn: null, phone: null,
      dob: '1980-01-01', approxAgeYears: 46, sex: null, addressFreeText: null }, DESK), PatientNotValidError);
  });

  test('an impossible age is refused', () => {
    assert.throws(() => registerPatient(db, { fullNameEn: 'Old', fullNameBn: null, phone: null,
      dob: null, approxAgeYears: 250, sex: null, addressFreeText: null }, DESK), PatientNotValidError);
  });

  test('an estimated age is stored with the day it was given', () => {
    const id = registerPatient(db, { fullNameEn: 'Estimated', fullNameBn: null, phone: null,
      dob: null, approxAgeYears: 40, sex: null, addressFreeText: null }, DESK);
    const row = db.prepare('SELECT approx_age_recorded_on FROM patient WHERE id = ?').get(id) as { approx_age_recorded_on: string };
    assert.match(row.approx_age_recorded_on, /^\d{4}-\d{2}-\d{2}$/);
  });

  test('a newly registered patient is findable by phone immediately, in any format', () => {
    // The moment the assistant feels the tool beat the paper book.
    registerPatient(db, { fullNameEn: 'Findable Now', fullNameBn: null, phone: '01911 222333',
      dob: null, approxAgeYears: 30, sex: 'male', addressFreeText: null }, DESK);
    for (const form of ['01911222333', '+8801911222333', '222333']) {
      assert.equal(searchPatients(db, form)[0]?.nameEn, 'Findable Now', `not found by ${form}`);
    }
  });

  test('registering is written to the audit log', () => {
    const row = db.prepare(`SELECT count(*) AS n FROM audit_log WHERE action = 'patient_registered'`).get() as { n: number };
    assert.ok(row.n > 0);
  });

  test('correcting a detail records what changed, from what, to what', () => {
    const id = registerPatient(db, { fullNameEn: 'Wrong Number', fullNameBn: null, phone: '01700000000',
      dob: null, approxAgeYears: 30, sex: null, addressFreeText: null }, DESK);
    updatePatient(db, id, { phone: '01755555555' }, DESK);

    const row = db.prepare(`SELECT details_json FROM audit_log WHERE action = 'patient_updated' AND entity_id = ?`)
      .get(id) as { details_json: string };
    assert.deepEqual(JSON.parse(row.details_json).changed.phone, { from: '01700000000', to: '01755555555' });
    assert.equal(searchPatients(db, '01755555555')[0]!.id, id, 'the new number must be searchable at once');
  });
});

describe('merging two records that are the same person', () => {
  let db: Db; let cleanup: () => void;
  let keep: string; let duplicate: string; let unrelated: string;
  let keepVisit: string; let dupVisit1: string; let dupVisit2: string;

  before(() => {
    const c = newChamber(); db = c.db; cleanup = c.cleanup;
    keep = registerPatient(db, { fullNameBn: 'মোহাম্মদ রফিক', fullNameEn: 'Mohammad Rafiq',
      phone: '01712345678', dob: null, approxAgeYears: 52, sex: 'male', addressFreeText: 'Mirpur' }, DESK);
    duplicate = registerPatient(db, { fullNameBn: 'মোহাম্মদ রফিক', fullNameEn: 'Md. Rafiq',
      phone: '01998887777', dob: null, approxAgeYears: 53, sex: 'male', addressFreeText: null }, DESK);
    unrelated = registerPatient(db, { fullNameEn: 'Someone Else', fullNameBn: null, phone: '01611110000',
      dob: null, approxAgeYears: 20, sex: 'female', addressFreeText: null }, DESK);

    keepVisit = addVisit(db, keep, '2025-01-05');
    dupVisit1 = addVisit(db, duplicate, '2025-06-11');
    dupVisit2 = addVisit(db, duplicate, '2026-02-20', 'ch-b');
    addVisit(db, unrelated, '2026-03-03');
  });
  after(() => { db.close(); cleanup(); });

  test('the preview shows both records side by side and flags what differs', () => {
    const preview = previewMerge(db, keep, duplicate, AS_OF);
    assert.deepEqual(preview.blockers, []);
    assert.equal(preview.visitsToMove, 2);

    const byField = Object.fromEntries(preview.comparison.map((c) => [c.field, c]));
    assert.equal(byField['full_name_bn']!.differs, false, 'the Bangla names are identical');
    assert.equal(byField['full_name_en']!.differs, true, 'the English spellings differ and a person should look');
    assert.equal(byField['phone']!.differs, true);
  });

  test('a record cannot be merged into itself', () => {
    assert.ok(previewMerge(db, keep, keep, AS_OF).blockers.length > 0);
    assert.throws(() => mergePatients(db, keep, keep, DESK), MergeRefusedError);
  });

  test('merging moves the visits and leaves the duplicate record in place', () => {
    const outcome = mergePatients(db, keep, duplicate, DESK, 'same man, two spellings');
    assert.equal(outcome.visitsMoved, 2);

    const moved = db.prepare('SELECT patient_id FROM visit WHERE id IN (?, ?)').all(dupVisit1, dupVisit2) as Array<{ patient_id: string }>;
    assert.ok(moved.every((v) => v.patient_id === keep));
    assert.equal(patientById(db, keep)!.visitCount, 3);
    assert.ok(patientById(db, duplicate), 'the duplicate record still exists and was not deleted');
  });

  test('the duplicate stays searchable, marked with what it became', () => {
    // The duplicate often holds the phone number the patient actually
    // gives at the desk. Hiding it would make them unfindable by it.
    const [found] = searchPatients(db, '01998887777');
    assert.equal(found!.id, duplicate);
    assert.equal(found!.mergedIntoPatientId, keep);
    assert.equal(found!.mergedIntoName, 'মোহাম্মদ রফিক');
  });

  test('following a merged record leads to the record in use', () => {
    assert.equal(resolveToSurvivingPatient(db, duplicate), keep);
    assert.equal(resolveToSurvivingPatient(db, keep), keep);
  });

  test('the surviving record keeps its own details exactly as they were', () => {
    // Nothing is combined and nothing is invented.
    const row = db.prepare('SELECT full_name_en, phone, approx_age_years FROM patient WHERE id = ?').get(keep) as
      { full_name_en: string; phone: string; approx_age_years: number };
    assert.equal(row.full_name_en, 'Mohammad Rafiq');
    assert.equal(row.phone, '01712345678');
    assert.equal(row.approx_age_years, 52);
  });

  test('the merge is written to the audit log with every id that moved', () => {
    const row = db.prepare(`SELECT details_json FROM audit_log WHERE action = 'patients_merged' AND entity_id = ?`)
      .get(duplicate) as { details_json: string };
    const details = JSON.parse(row.details_json);
    assert.equal(details.surviving_patient_id, keep);
    assert.deepEqual([...details.moved_visit_ids].sort(), [dupVisit1, dupVisit2].sort());
    assert.equal(details.note, 'same man, two spellings');
  });

  test('a record already merged cannot be merged again', () => {
    assert.throws(() => mergePatients(db, unrelated, duplicate, DESK), MergeRefusedError);
  });

  test('undoing puts back exactly what was moved, and nothing else', () => {
    // The case this protects against: two different people merged by
    // mistake. An undo that moved back everything the surviving record
    // had by then would take the wrong visits with it.
    const outcome = undoMerge(db, duplicate, DESK);
    assert.equal(outcome.visitsMoved, 2);

    const back = db.prepare('SELECT patient_id FROM visit WHERE id IN (?, ?)').all(dupVisit1, dupVisit2) as Array<{ patient_id: string }>;
    assert.ok(back.every((v) => v.patient_id === duplicate));

    const kept = db.prepare('SELECT patient_id FROM visit WHERE id = ?').get(keepVisit) as { patient_id: string };
    assert.equal(kept.patient_id, keep, "the surviving record's own visit must not move");
    assert.equal(patientById(db, duplicate)!.mergedIntoPatientId, null);
  });

  test('undoing is written to the audit log, and the merge entry is still there', () => {
    const actions = (db.prepare(`SELECT action FROM audit_log WHERE entity_id = ? ORDER BY id`).all(duplicate) as Array<{ action: string }>)
      .map((r) => r.action);
    assert.ok(actions.includes('patients_merged'));
    assert.ok(actions.includes('patients_merge_undone'));
  });

  test('undoing something that was never merged is refused clearly', () => {
    assert.throws(() => undoMerge(db, unrelated, DESK), MergeRefusedError);
  });

  test('a merge can be redone after being undone', () => {
    mergePatients(db, keep, duplicate, DESK);
    assert.equal(patientById(db, keep)!.visitCount, 3);
  });
});

describe('the application can actually write, not just read', () => {
  // This is here because of a real bug: the running program used an
  // actor with no id, and patient.created_by is NOT NULL, so
  // registering anybody from the front desk screen failed on the
  // constraint. Searching worked, so screenshots of the search screen
  // looked fine and nothing caught it.
  //
  // Every test that stands in for the application now uses the same
  // actor the application uses.
  test('registering with the actor the program itself uses succeeds', async () => {
    const { unassignedActor } = await import('../src/main/db/users');
    const c = newChamber();
    const actor = unassignedActor('front_desk');

    const id = registerPatient(c.db, {
      fullNameBn: 'নতুন রোগী', fullNameEn: 'New Patient', phone: '01700000001',
      dob: null, approxAgeYears: 33, sex: 'male', addressFreeText: null,
    }, actor);

    assert.ok(patientById(c.db, id));
    const row = c.db.prepare('SELECT created_by FROM patient WHERE id = ?').get(id) as { created_by: string };
    assert.equal(row.created_by, 'unassigned-front-desk');
    c.db.close(); c.cleanup();
  });

  test('and the name it records says plainly that nobody was signed in', () => {
    const c = newChamber();
    const row = c.db.prepare(`SELECT display_name AS n FROM app_user WHERE id = 'unassigned-front-desk'`)
      .get() as { n: string };
    assert.match(row.n, /before sign-in/i);
    c.db.close(); c.cleanup();
  });
});
