import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { provision, openWithPassphrase, openWithRecoveryKey, isProvisioned } from '../src/main/db/provision';
import { dbPath, keystorePath } from '../src/main/paths';
import { schemaVersion, dataMode, getMeta, type Db } from '../src/main/db/open';
import { recordAudit, recentAudit } from '../src/main/db/audit';
import { newId } from '../src/main/db/ids';
import { nowIso } from '../src/main/db/clock';
import { DatabaseUnreadableError, WrongPassphraseError, KeystoreMissingError } from '../src/shared/errors';
import { tempDir } from './helpers';

const PASSPHRASE = 'chamber passphrase 2026';

function freshInstallation() {
  const { dir, cleanup } = tempDir();
  const { db, recoveryKey } = provision(dir, PASSPHRASE, 'demo');
  return { dir, db, recoveryKey, cleanup };
}

/** Minimal rows so the foreign keys of the table under test are satisfied. */
function scaffold(db: Db) {
  const userId = newId();
  const chamberId = newId();
  const patientId = newId();
  db.prepare('INSERT INTO app_user (id, display_name, role, is_active, created_at) VALUES (?, ?, ?, 1, ?)')
    .run(userId, 'Test Doctor', 'doctor', nowIso());
  db.prepare('INSERT INTO chamber (id, name, created_at) VALUES (?, ?, ?)').run(chamberId, 'Test Chamber', nowIso());
  db.prepare(`INSERT INTO patient (id, full_name_en, search_name_en, created_at, created_by, updated_at)
              VALUES (?, ?, ?, ?, ?, ?)`).run(patientId, 'Test Patient', 'test patient', nowIso(), userId, nowIso());
  return { userId, chamberId, patientId };
}

function addVisit(db: Db, ids: ReturnType<typeof scaffold>, date: string, serial: number) {
  const id = newId();
  db.prepare(`INSERT INTO visit (id, patient_id, chamber_id, visit_date, serial_no, arrived_at, status, created_at, created_by, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, 'waiting', ?, ?, ?)`)
    .run(id, ids.patientId, ids.chamberId, date, serial, nowIso(), nowIso(), ids.userId, nowIso());
  return id;
}

describe('provisioning a new installation', () => {
  const { dir, db, recoveryKey, cleanup } = freshInstallation();
  after(() => { db.close(); cleanup(); });

  test('creates the database and the key file', () => {
    assert.equal(isProvisioned(dir), true);
  });

  test('applies the schema at version 1', () => {
    assert.equal(schemaVersion(db), 1);
  });

  test('starts in demo mode unless told otherwise', () => {
    assert.equal(dataMode(db), 'demo');
    assert.ok(getMeta(db, 'created_at'));
  });

  test('records its own creation in the audit log', () => {
    const entries = recentAudit(db);
    assert.ok(entries.some((e) => e.action === 'database_created'));
  });

  test('will not overwrite an installation that already exists', () => {
    assert.throws(() => provision(dir, 'another passphrase', 'demo'), /Refusing to overwrite/);
  });

  test('the recovery key printed at setup really opens it', () => {
    const reopened = openWithRecoveryKey(dir, recoveryKey);
    assert.equal(schemaVersion(reopened), 1);
    reopened.close();
  });
});

describe('encryption at rest', () => {
  test('patient text is not readable in the database file', () => {
    const { dir, db, cleanup } = freshInstallation();
    const ids = scaffold(db);
    db.prepare('UPDATE patient SET full_name_en = ?, search_name_en = ? WHERE id = ?')
      .run('Distinctive Patient Name', 'distinctive patient name', ids.patientId);
    // Force everything out of the write-ahead log into the main file.
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.close();

    const raw = readFileSync(dbPath(dir));
    assert.equal(raw.includes(Buffer.from('Distinctive Patient Name')), false,
      'a patient name was found in plain text inside the encrypted database file');
    // A plain unencrypted SQLite file starts with this string.
    assert.equal(raw.subarray(0, 15).toString('latin1').startsWith('SQLite format'), false,
      'the file is not encrypted at all');
    cleanup();
  });

  test('a wrong passphrase does not open the database', () => {
    const { dir, db, cleanup } = freshInstallation();
    db.close();
    assert.throws(() => openWithPassphrase(dir, 'the wrong passphrase'), WrongPassphraseError);
    cleanup();
  });

  test('the right passphrase reopens it with the data intact', () => {
    const { dir, db, cleanup } = freshInstallation();
    const ids = scaffold(db);
    db.close();
    const reopened = openWithPassphrase(dir, PASSPHRASE);
    const row = reopened.prepare('SELECT full_name_en FROM patient WHERE id = ?').get(ids.patientId) as { full_name_en: string };
    assert.equal(row.full_name_en, 'Test Patient');
    reopened.close();
    cleanup();
  });

  test('a missing key file is reported as a missing key file', () => {
    // The user must be told to restore a backup, not to retype a password.
    const { dir, db, cleanup } = freshInstallation();
    db.close();
    require('node:fs').rmSync(keystorePath(dir));
    assert.throws(() => openWithPassphrase(dir, PASSPHRASE), KeystoreMissingError);
    cleanup();
  });

  test('a damaged database file is reported as unreadable, in plain language', () => {
    const { dir, db, cleanup } = freshInstallation();
    db.close();
    require('node:fs').writeFileSync(dbPath(dir), Buffer.alloc(8192, 7));
    try {
      openWithPassphrase(dir, PASSPHRASE);
      assert.fail('expected the damaged file to be refused');
    } catch (error) {
      assert.ok(error instanceof DatabaseUnreadableError);
      assert.match(error.whatToDo, /backup/i);
    }
    cleanup();
  });
});

describe('the audit log is append-only', () => {
  const { db, cleanup } = freshInstallation();
  after(() => { db.close(); cleanup(); });

  test('entries can be written', () => {
    recordAudit(db, { actor: { id: null, role: 'doctor' }, action: 'test_action', entity: 'patient', entityId: 'p1', details: { note: 'hello' } });
    assert.ok(recentAudit(db).some((e) => e.action === 'test_action'));
  });

  test('an entry can never be changed, even by direct sql', () => {
    assert.throws(() => db.prepare(`UPDATE audit_log SET action = 'tampered' WHERE action = 'test_action'`).run(),
      /append-only/);
  });

  test('an entry can never be deleted, even by direct sql', () => {
    assert.throws(() => db.prepare(`DELETE FROM audit_log WHERE action = 'test_action'`).run(), /append-only/);
  });

  test('the whole table cannot be emptied', () => {
    assert.throws(() => db.prepare('DELETE FROM audit_log').run(), /append-only/);
  });

  test('details survive as readable json', () => {
    const entry = recentAudit(db).find((e) => e.action === 'test_action');
    assert.deepEqual(JSON.parse(entry!.details_json!), { note: 'hello' });
  });
});

describe('nothing is ever hard deleted', () => {
  const { db, cleanup } = freshInstallation();
  const ids = scaffold(db);
  after(() => { db.close(); cleanup(); });

  // A BEFORE DELETE trigger only fires when there is a row to delete, so
  // every protected table needs a real row in it before this means
  // anything. An earlier version of this test checked empty tables and
  // passed without proving a thing.
  const visitId = addVisit(db, ids, '2026-05-01', 1);
  const intakeId = newId();
  const encounterId = newId();

  db.prepare(`INSERT INTO intake (id, visit_id, recorded_by, started_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(intakeId, visitId, ids.userId, nowIso(), nowIso(), nowIso());
  db.prepare(`INSERT INTO intake_answer (id, intake_id, question_key, answer_value, was_skipped, created_at, updated_at)
              VALUES (?, ?, 'duration', '1-2 days', 0, ?, ?)`).run(newId(), intakeId, nowIso(), nowIso());
  db.prepare(`INSERT INTO red_flag_event (id, intake_id, rule_id, rule_version, fired_at) VALUES (?, ?, 'r', 'v1', ?)`)
    .run(newId(), intakeId, nowIso());
  db.prepare(`INSERT INTO vitals (id, visit_id, recorded_by, recorded_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(newId(), visitId, ids.userId, nowIso(), nowIso(), nowIso());
  db.prepare(`INSERT INTO encounter (id, visit_id, entered_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
    .run(encounterId, visitId, ids.userId, nowIso(), nowIso());
  db.prepare(`INSERT INTO medication (id, encounter_id, drug_name, sort_order, created_at, updated_at) VALUES (?, ?, 'PLACEHOLDER DRUG 1', 0, ?, ?)`)
    .run(newId(), encounterId, nowIso(), nowIso());
  db.prepare(`INSERT INTO investigation (id, encounter_id, test_name, ordered_date, created_at, updated_at) VALUES (?, ?, 'PLACEHOLDER TEST 1', '2026-05-01', ?, ?)`)
    .run(newId(), encounterId, nowIso(), nowIso());
  db.prepare(`INSERT INTO attachment (id, patient_id, file_path, kind, captured_at, created_at, created_by) VALUES (?, ?, 'x.jpg', 'report', ?, ?, ?)`)
    .run(newId(), ids.patientId, nowIso(), nowIso(), ids.userId);

  const protectedTables = ['patient', 'visit', 'intake', 'intake_answer', 'red_flag_event', 'vitals',
    'encounter', 'medication', 'investigation', 'attachment', 'app_user', 'chamber'];

  for (const table of protectedTables) {
    test(`${table} holds a row, and that row cannot be deleted`, () => {
      const count = db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number };
      assert.ok(count.n > 0, `${table} is empty, so this test would prove nothing`);
      assert.throws(() => db.prepare(`DELETE FROM ${table}`).run(), /never deleted/);
    });
  }

  test('soft delete is how something is removed from view', () => {
    db.prepare('UPDATE patient SET deleted_at = ? WHERE id = ?').run(nowIso(), ids.patientId);
    const row = db.prepare('SELECT deleted_at FROM patient WHERE id = ?').get(ids.patientId) as { deleted_at: string };
    assert.ok(row.deleted_at);
    db.prepare('UPDATE patient SET deleted_at = NULL WHERE id = ?').run(ids.patientId);
  });
});

describe('the register cannot issue the same serial twice', () => {
  const { db, cleanup } = freshInstallation();
  const ids = scaffold(db);
  after(() => { db.close(); cleanup(); });

  test('a serial is unique within one chamber on one day', () => {
    addVisit(db, ids, '2026-03-01', 1);
    assert.throws(() => addVisit(db, ids, '2026-03-01', 1), /UNIQUE/);
  });

  test('the same serial is fine on a different day', () => {
    assert.ok(addVisit(db, ids, '2026-03-02', 1));
  });

  test('a soft-deleted visit keeps its serial reserved', () => {
    const id = addVisit(db, ids, '2026-03-03', 1);
    db.prepare('UPDATE visit SET deleted_at = ? WHERE id = ?').run(nowIso(), id);
    assert.throws(() => addVisit(db, ids, '2026-03-03', 1), /UNIQUE/,
      'a crossed-out line in a paper register does not free up that number either');
  });
});

describe('the schema refuses records that would mislead a clinician', () => {
  const { db, cleanup } = freshInstallation();
  const ids = scaffold(db);
  after(() => { db.close(); cleanup(); });

  test('a patient must have a name in at least one script', () => {
    assert.throws(() => db.prepare(`INSERT INTO patient (id, created_at, created_by, updated_at) VALUES (?, ?, ?, ?)`)
      .run(newId(), nowIso(), ids.userId, nowIso()), /CHECK/);
  });

  test('an approximate age cannot be stored without the date it was taken', () => {
    // Otherwise "45" recorded three years ago silently reads as 45 today.
    assert.throws(() => db.prepare(`INSERT INTO patient (id, full_name_en, approx_age_years, created_at, created_by, updated_at)
                                    VALUES (?, ?, ?, ?, ?, ?)`)
      .run(newId(), 'Someone', 45, nowIso(), ids.userId, nowIso()), /CHECK/);
  });

  test('every clinical row records who entered it', () => {
    assert.throws(() => db.prepare(`INSERT INTO vitals (id, visit_id, recorded_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
      .run(newId(), addVisit(db, ids, '2026-04-01', 1), nowIso(), nowIso(), nowIso()), /NOT NULL/);
  });

  test('partial vitals are accepted, because that is the normal case', () => {
    const visitId = addVisit(db, ids, '2026-04-02', 1);
    db.prepare(`INSERT INTO vitals (id, visit_id, recorded_by, recorded_at, systolic_bp, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)`).run(newId(), visitId, ids.userId, nowIso(), 128, nowIso(), nowIso());
    const row = db.prepare('SELECT systolic_bp, pulse FROM vitals WHERE visit_id = ?').get(visitId) as { systolic_bp: number; pulse: null };
    assert.equal(row.systolic_bp, 128);
    assert.equal(row.pulse, null);
  });

  test('a visit cannot point at a patient who does not exist', () => {
    assert.throws(() => db.prepare(`INSERT INTO visit (id, patient_id, chamber_id, visit_date, serial_no, arrived_at, status, created_at, created_by, updated_at)
                                    VALUES (?, 'no-such-patient', ?, '2026-04-03', 1, ?, 'waiting', ?, ?, ?)`)
      .run(newId(), ids.chamberId, nowIso(), nowIso(), ids.userId, nowIso()), /FOREIGN KEY/);
  });

  test('a fired red flag can never be altered afterwards', () => {
    const visitId = addVisit(db, ids, '2026-04-04', 1);
    const intakeId = newId();
    db.prepare(`INSERT INTO intake (id, visit_id, recorded_by, started_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(intakeId, visitId, ids.userId, nowIso(), nowIso(), nowIso());
    const flagId = newId();
    db.prepare(`INSERT INTO red_flag_event (id, intake_id, rule_id, rule_version, fired_at) VALUES (?, ?, ?, ?, ?)`)
      .run(flagId, intakeId, 'rule-x', 'v1', nowIso());

    assert.throws(() => db.prepare(`UPDATE red_flag_event SET rule_id = 'rule-y' WHERE id = ?`).run(flagId), /never be altered/);
    assert.throws(() => db.prepare(`DELETE FROM red_flag_event WHERE id = ?`).run(flagId), /never deleted/);

    // Acknowledging it is the one change allowed.
    db.prepare(`UPDATE red_flag_event SET acknowledged_by = ?, acknowledged_at = ? WHERE id = ?`).run(ids.userId, nowIso(), flagId);
    const row = db.prepare('SELECT acknowledged_by FROM red_flag_event WHERE id = ?').get(flagId) as { acknowledged_by: string };
    assert.equal(row.acknowledged_by, ids.userId);
  });
});
