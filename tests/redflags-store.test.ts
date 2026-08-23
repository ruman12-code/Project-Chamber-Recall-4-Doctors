import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { provision, openWithPassphrase } from '../src/main/db/provision';
import { rulebookPath } from '../src/main/paths';
import { newId } from '../src/main/db/ids';
import { nowIso } from '../src/main/db/clock';
import { schemaVersion, migrate, latestSchemaVersion, type Db } from '../src/main/db/open';
import { loadRulebook } from '../src/main/redflags/rulebook';
import { loadRulebookFromDisk } from '../src/main/redflags/store';
import { screenIntake, acknowledgeRedFlag, activeQueueFlags, factsForIntake } from '../src/main/redflags/store';
import { blocksLiveUse } from '../src/main/redflags/guard';
import { tempDir } from './helpers';

const RULES = `
approved_by: "Dr Test"
approved_on: "2026-09-01"
rules:
  - id: fires_on_severe
    version: 1
    status: approved
    message: { bn: "এখনই ডাক্তারকে জানান।", en: "Tell the doctor now." }
    when: { question: severity, equals: severe }
  - id: never_fires_here
    version: 1
    status: approved
    message: { bn: "খ", en: "B" }
    when: { question: body_region, equals: throat }
  - id: needs_a_skipped_answer
    version: 4
    status: approved
    message: { bn: "গ", en: "C" }
    when: { question: allergies, equals: yes_known }
`;

const rulebook = (() => {
  const { rulebook, problems } = loadRulebook(RULES, 'test.yaml');
  assert.deepEqual(problems, []);
  return rulebook!;
})();

const doctor = { id: 'user-doctor', role: 'doctor' as const };
const desk = { id: 'user-desk', role: 'front_desk' as const };

function chamber() {
  const t = tempDir();
  const db = provision(t.dir, 'passphrase', 'demo').db;
  db.prepare('INSERT INTO app_user (id, display_name, role, is_active, created_at) VALUES (?, ?, ?, 1, ?)')
    .run(desk.id, 'Front desk', 'front_desk', nowIso());
  db.prepare('INSERT INTO app_user (id, display_name, role, is_active, created_at) VALUES (?, ?, ?, 1, ?)')
    .run(doctor.id, 'Doctor', 'doctor', nowIso());
  db.prepare('INSERT INTO chamber (id, name, created_at) VALUES (?, ?, ?)').run('chamber-1', 'Test Chamber', nowIso());
  return { dir: t.dir, db, cleanup: t.cleanup };
}

/** One patient, one visit, one intake with the given answers. */
function intakeWith(db: Db, answers: Record<string, { value?: string; free?: string; skipped?: boolean }>,
                    opts: { visitDate?: string; status?: string; age?: number } = {}) {
  const patientId = newId();
  const visitId = newId();
  const intakeId = newId();
  const visitDate = opts.visitDate ?? '2026-08-22';

  db.prepare(`INSERT INTO patient (id, full_name_bn, search_name_bn, approx_age_years, approx_age_recorded_on, sex, created_at, created_by, updated_at)
              VALUES (?, ?, ?, ?, ?, 'female', ?, ?, ?)`)
    .run(patientId, 'পরীক্ষা রোগী', 'পরীক্ষা রোগী', opts.age ?? 40, visitDate, nowIso(), desk.id, nowIso());
  const serial = (db.prepare('SELECT count(*) AS n FROM visit WHERE visit_date = ?').get(visitDate) as { n: number }).n + 1;
  db.prepare(`INSERT INTO visit (id, patient_id, chamber_id, visit_date, serial_no, arrived_at, status, created_at, created_by, updated_at)
              VALUES (?, ?, 'chamber-1', ?, ?, ?, ?, ?, ?, ?)`)
    .run(visitId, patientId, visitDate, serial, nowIso(), opts.status ?? 'waiting', nowIso(), desk.id, nowIso());
  db.prepare(`INSERT INTO intake (id, visit_id, recorded_by, started_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(intakeId, visitId, desk.id, nowIso(), nowIso(), nowIso());
  for (const [key, a] of Object.entries(answers)) {
    db.prepare(`INSERT INTO intake_answer (id, intake_id, question_key, answer_value, answer_free_text, was_skipped, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(newId(), intakeId, key, a.value ?? null, a.free ?? null, a.skipped === true ? 1 : 0, nowIso(), nowIso());
  }
  return { patientId, visitId, intakeId };
}

describe('screening one intake', () => {
  let db: Db; let cleanup: () => void; let intakeId: string;
  let outcome: ReturnType<typeof screenIntake>;

  before(() => {
    const c = chamber(); db = c.db; cleanup = c.cleanup;
    intakeId = intakeWith(db, {
      severity: { value: 'severe' },
      body_region: { value: 'chest' },
      allergies: { value: 'something', skipped: true },
    }).intakeId;
    outcome = screenIntake(db, rulebook, intakeId, desk);
  });
  after(() => { db.close(); cleanup(); });

  test('the matching rule fires', () => {
    assert.deepEqual(outcome.firedFlags.map((f) => f.ruleId), ['fires_on_severe']);
  });

  test('EVERY rule is written down, not only the one that fired', () => {
    // Explaining why a patient was not moved up the queue needs the
    // rules that did not fire just as much as the one that did.
    const rows = db.prepare('SELECT rule_id, outcome FROM red_flag_evaluation WHERE intake_id = ? ORDER BY rule_id').all(intakeId);
    assert.deepEqual(rows, [
      { rule_id: 'fires_on_severe', outcome: 'fired' },
      { rule_id: 'needs_a_skipped_answer', outcome: 'could_not_check' },
      { rule_id: 'never_fires_here', outcome: 'did_not_fire' },
    ]);
  });

  test('each evaluation records the rule version and the rulebook it came from', () => {
    const row = db.prepare(`SELECT rule_version, rulebook_checksum FROM red_flag_evaluation WHERE rule_id = 'needs_a_skipped_answer'`)
      .get() as { rule_version: string; rulebook_checksum: string };
    assert.equal(row.rule_version, '4');
    assert.equal(row.rulebook_checksum, rulebook.checksum);
  });

  test('a rule blocked by a skipped question names the question', () => {
    const row = db.prepare(`SELECT unknown_questions FROM red_flag_evaluation WHERE rule_id = 'needs_a_skipped_answer'`)
      .get() as { unknown_questions: string };
    assert.equal(row.unknown_questions, 'allergies');
  });

  test('the screening is reported as incomplete', () => {
    assert.equal(outcome.screeningIncomplete, true);
    assert.deepEqual(outcome.missingQuestions, ['allergies']);
  });

  test('an incomplete screening is written to the audit log', () => {
    const row = db.prepare(`SELECT details_json FROM audit_log WHERE action = 'red_flag_screening_incomplete'`).get() as { details_json: string };
    assert.deepEqual(JSON.parse(row.details_json).missing_questions, ['allergies']);
  });

  test('the alert itself is recorded as an event with its rule version', () => {
    const row = db.prepare('SELECT rule_id, rule_version, acknowledged_at FROM red_flag_event WHERE intake_id = ?').get(intakeId) as
      { rule_id: string; rule_version: string; acknowledged_at: string | null };
    assert.equal(row.rule_id, 'fires_on_severe');
    assert.equal(row.rule_version, '1');
    assert.equal(row.acknowledged_at, null, 'a new alert starts unacknowledged');
  });

  test('firing is written to the audit log', () => {
    const row = db.prepare(`SELECT details_json FROM audit_log WHERE action = 'red_flag_fired'`).get() as { details_json: string };
    assert.equal(JSON.parse(row.details_json).rule_id, 'fires_on_severe');
  });

  test('the record of what each rule decided can never be edited or removed', () => {
    assert.throws(() => db.prepare(`UPDATE red_flag_evaluation SET outcome = 'did_not_fire'`).run(), /append-only/);
    assert.throws(() => db.prepare('DELETE FROM red_flag_evaluation').run(), /append-only/);
  });
});

describe('acknowledging an alert', () => {
  let db: Db; let cleanup: () => void;
  before(() => { const c = chamber(); db = c.db; cleanup = c.cleanup; });
  after(() => { db.close(); cleanup(); });

  test('records who tapped it and when', () => {
    const { intakeId } = intakeWith(db, { severity: { value: 'severe' } });
    const [flag] = screenIntake(db, rulebook, intakeId, desk).firedFlags;
    acknowledgeRedFlag(db, flag!.eventId, desk);

    const row = db.prepare('SELECT acknowledged_by, acknowledged_at FROM red_flag_event WHERE id = ?').get(flag!.eventId) as
      { acknowledged_by: string; acknowledged_at: string };
    assert.equal(row.acknowledged_by, desk.id);
    assert.ok(row.acknowledged_at);
  });

  test('is written to the audit log', () => {
    const row = db.prepare(`SELECT count(*) AS n FROM audit_log WHERE action = 'red_flag_acknowledged'`).get() as { n: number };
    assert.equal(row.n, 1);
  });

  test('the first acknowledgement is the one that counts and is never overwritten', () => {
    const { intakeId } = intakeWith(db, { severity: { value: 'severe' } });
    const [flag] = screenIntake(db, rulebook, intakeId, desk).firedFlags;
    acknowledgeRedFlag(db, flag!.eventId, desk, '2026-08-22T18:00:00.000Z');
    acknowledgeRedFlag(db, flag!.eventId, doctor, '2026-08-22T19:00:00.000Z');

    const row = db.prepare('SELECT acknowledged_by, acknowledged_at FROM red_flag_event WHERE id = ?').get(flag!.eventId) as
      { acknowledged_by: string; acknowledged_at: string };
    assert.equal(row.acknowledged_by, desk.id);
    assert.equal(row.acknowledged_at, '2026-08-22T18:00:00.000Z');
  });

  test('acknowledging an alert that does not exist fails loudly', () => {
    assert.throws(() => acknowledgeRedFlag(db, 'no-such-event', desk), /no red flag event/);
  });
});

describe("the doctor's alert cannot be dismissed away", () => {
  let db: Db; let cleanup: () => void;
  before(() => { const c = chamber(); db = c.db; cleanup = c.cleanup; });
  after(() => { db.close(); cleanup(); });

  test('an acknowledged alert still shows while the patient is waiting', () => {
    // The assistant tapping through the warning on the tablet clears
    // the tablet. It must not clear the doctor's screen.
    const { intakeId } = intakeWith(db, { severity: { value: 'severe' } }, { visitDate: '2026-08-22' });
    const [flag] = screenIntake(db, rulebook, intakeId, desk).firedFlags;
    acknowledgeRedFlag(db, flag!.eventId, desk);

    const active = activeQueueFlags(db, '2026-08-22');
    assert.equal(active.length, 1);
    assert.ok(active[0]!.acknowledgedAt, 'the acknowledgement is visible, but the alert remains');
  });

  test('the alert leaves the queue only once the patient has been seen', () => {
    const { intakeId, visitId } = intakeWith(db, { severity: { value: 'severe' } }, { visitDate: '2026-08-23' });
    screenIntake(db, rulebook, intakeId, desk);
    assert.equal(activeQueueFlags(db, '2026-08-23').length, 1);

    db.prepare(`UPDATE visit SET status = 'done' WHERE id = ?`).run(visitId);
    assert.equal(activeQueueFlags(db, '2026-08-23').length, 0);
  });

  test('the alert carries the patient name so the doctor knows who it is', () => {
    const { intakeId } = intakeWith(db, { severity: { value: 'severe' } }, { visitDate: '2026-08-24' });
    screenIntake(db, rulebook, intakeId, desk);
    assert.equal(activeQueueFlags(db, '2026-08-24')[0]!.patientName, 'পরীক্ষা রোগী');
  });
});

describe('gathering the facts a rule is allowed to see', () => {
  let db: Db; let cleanup: () => void;
  before(() => { const c = chamber(); db = c.db; cleanup = c.cleanup; });
  after(() => { db.close(); cleanup(); });

  test('an approximate age is aged forward from the day it was recorded', () => {
    const { intakeId } = intakeWith(db, {}, { visitDate: '2023-08-22', age: 40 });
    const facts = factsForIntake(db, intakeId, new Date('2026-08-22T00:00:00Z'));
    assert.equal(facts.patient.ageYears, 43);
  });

  test('a skipped answer arrives marked as skipped, not as missing', () => {
    const { intakeId } = intakeWith(db, { severity: { value: 'severe', skipped: true } }, { visitDate: '2026-09-01' });
    assert.equal(factsForIntake(db, intakeId).answers['severity']!.skipped, true);
  });
});

describe('the rules file in the data folder', () => {
  test('a template is put beside the database when the installation is created', () => {
    const t = tempDir();
    const db = provision(t.dir, 'passphrase', 'demo').db;
    const { rulebook, problems } = loadRulebookFromDisk(t.dir);
    assert.deepEqual(problems, []);
    assert.ok(rulebook!.rules.length > 0);
    assert.ok(blocksLiveUse(rulebook, problems).length > 0, 'the template must not be usable for real patients');
    db.close(); t.cleanup();
  });

  test('rules a doctor has written are never overwritten by reinstalling', () => {
    const t = tempDir();
    const db = provision(t.dir, 'passphrase', 'demo').db;
    writeFileSync(rulebookPath(t.dir), RULES, 'utf8');
    db.close();

    openWithPassphrase(t.dir, 'passphrase').close();
    assert.equal(readFileSync(rulebookPath(t.dir), 'utf8'), RULES);
    t.cleanup();
  });

  test('a missing rules file is reported as missing, and blocks live use', () => {
    const t = tempDir();
    const db = provision(t.dir, 'passphrase', 'demo').db;
    require('node:fs').rmSync(rulebookPath(t.dir));
    const { rulebook, problems } = loadRulebookFromDisk(t.dir);
    assert.equal(rulebook, null);
    assert.match(problems[0]!.problem, /missing/i);
    assert.ok(blocksLiveUse(rulebook, problems).length > 0);
    db.close(); t.cleanup();
  });
});

describe('upgrading an older database', () => {
  test('a database created before this milestone gains the new table', () => {
    const t = tempDir();
    const db = provision(t.dir, 'passphrase', 'demo').db;
    assert.equal(schemaVersion(db), latestSchemaVersion());
    assert.ok(latestSchemaVersion() >= 2);
    db.close(); t.cleanup();
  });

  test('running the upgrade twice changes nothing the second time', () => {
    const t = tempDir();
    const db = provision(t.dir, 'passphrase', 'demo').db;
    assert.deepEqual(migrate(db), [], 'a database already up to date must not be touched again');
    db.close(); t.cleanup();
  });

  test('an upgraded database ends up identical to a fresh one', () => {
    // Otherwise a chamber running since last year slowly drifts away
    // from a chamber installed today, and only one of them gets tested.
    //
    // The old database is made by wiping a fresh one back to the
    // baseline schema and setting the version to 1 - which is exactly
    // what a version 1 installation was. Done generically, so this
    // still works when there are ten migrations rather than two.
    const fresh = tempDir();
    const freshDb = provision(fresh.dir, 'passphrase', 'demo').db;
    const freshSchema = freshDb.prepare(`SELECT type, name, sql FROM sqlite_master ORDER BY type, name`).all();
    const latest = latestSchemaVersion();
    freshDb.close();

    const old = tempDir();
    const oldDb = provision(old.dir, 'passphrase', 'demo').db;
    oldDb.pragma('foreign_keys = OFF');
    for (const kind of ['trigger', 'index', 'view', 'table'] as const) {
      const objects = oldDb.prepare(
        `SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE 'sqlite_%'`).all(kind) as Array<{ name: string }>;
      for (const object of objects) oldDb.exec(`DROP ${kind.toUpperCase()} IF EXISTS "${object.name}"`);
    }
    oldDb.exec(readFileSync(join(__dirname, '..', '..', 'src', 'main', 'db', 'schema.sql'), 'utf8'));
    oldDb.exec('PRAGMA user_version = 1');
    oldDb.pragma('foreign_keys = ON');

    const applied = migrate(oldDb);
    const migratedSchema = oldDb.prepare(`SELECT type, name, sql FROM sqlite_master ORDER BY type, name`).all();
    oldDb.close();

    assert.deepEqual(applied, Array.from({ length: latest - 1 }, (_, i) => i + 2),
      'every migration after the baseline should have run');
    assert.deepEqual(migratedSchema, freshSchema);
    fresh.cleanup(); old.cleanup();
  });
});

describe('screening the same intake more than once', () => {
  // The tablet re-screens after every answer, so an alert appears as
  // early as possible instead of at the end of the questions. That
  // makes repeat screening the normal case, not an edge case.
  let db: Db; let cleanup: () => void; let intakeId: string;
  before(() => {
    const c = chamber(); db = c.db; cleanup = c.cleanup;
    intakeId = intakeWith(db, { severity: { value: 'severe' } }).intakeId;
  });
  after(() => { db.close(); cleanup(); });

  test('the assistant is not shown the same warning twice', () => {
    screenIntake(db, rulebook, intakeId, desk);
    screenIntake(db, rulebook, intakeId, desk);
    screenIntake(db, rulebook, intakeId, desk);
    const row = db.prepare(`SELECT count(*) AS n FROM red_flag_event WHERE intake_id = ? AND rule_id = 'fires_on_severe'`)
      .get(intakeId) as { n: number };
    assert.equal(row.n, 1);
  });

  test('the alert keeps the same identity, so acknowledging it still works', () => {
    const first = screenIntake(db, rulebook, intakeId, desk).firedFlags[0]!;
    const later = screenIntake(db, rulebook, intakeId, desk).firedFlags[0]!;
    assert.equal(later.eventId, first.eventId);
    acknowledgeRedFlag(db, later.eventId, desk);
    assert.equal(activeQueueFlags(db, '2026-08-22').length, 1);
  });

  test('an acknowledged alert is not raised again by a later answer', () => {
    const before = db.prepare(`SELECT count(*) AS n FROM red_flag_event WHERE intake_id = ?`).get(intakeId) as { n: number };
    screenIntake(db, rulebook, intakeId, desk);
    const after = db.prepare(`SELECT count(*) AS n FROM red_flag_event WHERE intake_id = ?`).get(intakeId) as { n: number };
    assert.equal(after.n, before.n);
  });

  test('but every one of those screenings is still written down', () => {
    // The alert is raised once. The record of what the rules decided is
    // kept every single time they ran.
    const row = db.prepare('SELECT count(*) AS n FROM red_flag_evaluation WHERE intake_id = ?').get(intakeId) as { n: number };
    assert.ok(row.n >= rulebook.rules.length * 5, `expected a row per rule per screening, got ${row.n}`);
  });

  test('a rule whose version changed raises a fresh alert', () => {
    // A changed rule is a different rule. If the doctor revises one and
    // increases its version, the new version must be able to fire even
    // though the old one already did.
    const revised = loadRulebook(RULES.replace(`  - id: fires_on_severe
    version: 1`, `  - id: fires_on_severe
    version: 2`), 'test.yaml').rulebook!;
    screenIntake(db, revised, intakeId, desk);
    const versions = db.prepare(
      `SELECT rule_version FROM red_flag_event WHERE intake_id = ? AND rule_id = 'fires_on_severe' ORDER BY rule_version`)
      .all(intakeId) as Array<{ rule_version: string }>;
    assert.deepEqual(versions.map((v) => v.rule_version), ['1', '2']);
  });
});

describe('opening an installation that was created by older software', () => {
  // Found the hard way: provisioning ran the migrations but opening an
  // existing database did not, so a chamber running since last year
  // would open its database happily and then fail on the first query
  // touching anything added since.
  test('an old database is brought up to date when it is opened', () => {
    const t = tempDir();
    const fresh = provision(t.dir, 'passphrase', 'demo').db;

    // Wind it back to the baseline, as a version 1 installation was.
    fresh.pragma('foreign_keys = OFF');
    for (const kind of ['trigger', 'index', 'view', 'table'] as const) {
      const objects = fresh.prepare(
        `SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE 'sqlite_%'`).all(kind) as Array<{ name: string }>;
      for (const object of objects) fresh.exec(`DROP ${kind.toUpperCase()} IF EXISTS "${object.name}"`);
    }
    fresh.exec(readFileSync(join(__dirname, '..', '..', 'src', 'main', 'db', 'schema.sql'), 'utf8'));
    fresh.exec('PRAGMA user_version = 1');
    fresh.close();

    const reopened = openWithPassphrase(t.dir, 'passphrase');
    assert.equal(schemaVersion(reopened), latestSchemaVersion());

    // And the columns added by later migrations are actually usable.
    assert.doesNotThrow(() => reopened.prepare('SELECT queue_position FROM visit').all());
    assert.doesNotThrow(() => reopened.prepare('SELECT search_phone FROM patient').all());
    assert.doesNotThrow(() => reopened.prepare('SELECT outcome FROM red_flag_evaluation').all());

    reopened.close();
    t.cleanup();
  });
});
