import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { provision, openWithPassphrase, dekOf } from '../src/main/db/provision';
import { newId } from '../src/main/db/ids';
import { nowIso } from '../src/main/db/clock';
import type { Db } from '../src/main/db/open';
import { addStaff } from '../src/main/auth/staff';
import { makeBackup, backupStatus, inspectBackup, restoreFromBackup, BackupError } from '../src/main/backup/backup';
import { tempDir } from './helpers';

/**
 * Milestone 12. One laptop, and everything on it.
 *
 * The thing being proved here is not that files can be copied. It is
 * that the copy is opened and checked before anybody is told it
 * worked, that a copy which is not a backup says so, and that putting
 * one back never destroys what is already there.
 */

const system = { id: null, role: 'system' as const };

function chamber(patients = 3) {
  const t = tempDir();
  const db = provision(t.dir, 'passphrase', 'demo').db;
  const doctorId = addStaff(db, { displayName: 'Dr Ashraful', role: 'doctor', pin: '4021' }, system);
  db.prepare('INSERT INTO chamber (id, name, created_at) VALUES (?, ?, ?)').run('ch-a', 'Popular Chamber', nowIso());
  for (let i = 0; i < patients; i++) {
    db.prepare(`INSERT INTO patient (id, full_name_bn, search_name_en, approx_age_years,
                  approx_age_recorded_on, sex, created_at, created_by, updated_at)
                VALUES (?, ?, ?, 40, '2026-08-24', 'female', ?, ?, ?)`)
      .run(newId(), `রোগী ${i}`, `patient ${i}`, nowIso(), doctorId, nowIso());
  }
  return { db, dir: t.dir, cleanup: t.cleanup, doctor: { id: doctorId, role: 'doctor' as const } };
}

function usbStick(): { dir: string; cleanup: () => void } {
  return tempDir();
}

describe('taking a backup', () => {
  let c: ReturnType<typeof chamber>; let usb: ReturnType<typeof usbStick>;
  before(() => { c = chamber(); usb = usbStick(); });
  after(() => { c.db.close(); c.cleanup(); usb.cleanup(); });

  test('a fresh installation says it has never been backed up', () => {
    const status = backupStatus(c.db);
    assert.equal(status.lastBackupAt, null);
    assert.equal(status.urgency, 'never');
  });

  test('everything a working installation needs goes into the folder', () => {
    const { folder, manifest } = makeBackup(c.db, c.dir, usb.dir, c.doctor, dekOf(c.db));
    for (const file of ['chamber-recall.db', 'keystore.json', 'red_flags.yaml',
      'questions.yaml', 'consent.yaml', 'prescription.yaml', 'manifest.json', 'HOW-TO-RESTORE.txt']) {
      assert.ok(existsSync(join(folder, file)), `${file} is missing from the backup`);
    }
    assert.equal(manifest.counts.patient, 3);
    assert.equal(manifest.verified, true);
  });

  test('the copy is opened and read back before it is called a backup', () => {
    const { folder } = makeBackup(c.db, c.dir, usb.dir, c.doctor, dekOf(c.db), '2026-08-24T19:00:00.000Z');
    // Opening it with the same passphrase is the whole promise.
    const restoredDir = tempDir();
    for (const file of ['chamber-recall.db', 'keystore.json']) {
      writeFileSync(join(restoredDir.dir, file), readFileSync(join(folder, file)));
    }
    const copy = openWithPassphrase(restoredDir.dir, 'passphrase');
    assert.equal((copy.prepare('SELECT count(*) AS n FROM patient').get() as { n: number }).n, 3);
    copy.close();
    restoredDir.cleanup();
  });

  test('the folder carries instructions for somebody who has no software', () => {
    const { folder } = makeBackup(c.db, c.dir, usb.dir, c.doctor, dekOf(c.db), '2026-08-24T19:01:00.000Z');
    const sheet = readFileSync(join(folder, 'HOW-TO-RESTORE.txt'), 'utf8');
    assert.match(sheet, /AS SENSITIVE AS THE LAPTOP/);
    assert.match(sheet, /Do NOT delete anything/);
    assert.match(sheet, /recovery key/);
  });

  test('the backup is recorded, and the date is what the screen reads', () => {
    makeBackup(c.db, c.dir, usb.dir, c.doctor, dekOf(c.db), '2026-08-24T19:02:00.000Z');
    const status = backupStatus(c.db, new Date('2026-08-25T19:00:00.000Z'));
    assert.equal(status.lastBackupOk, true);
    assert.equal(status.daysSince, 1);
    assert.equal(status.urgency, 'fine');

    const audit = c.db.prepare(
      `SELECT count(*) AS n FROM audit_log WHERE action = 'backup_taken'`).get() as { n: number };
    assert.ok(audit.n >= 1);
  });

  test('an old backup is reported as overdue rather than as a backup', () => {
    makeBackup(c.db, c.dir, usb.dir, c.doctor, dekOf(c.db), '2026-08-24T19:03:00.000Z');
    assert.equal(backupStatus(c.db, new Date('2026-08-28T19:00:00.000Z')).urgency, 'due');
    assert.equal(backupStatus(c.db, new Date('2026-09-04T19:00:00.000Z')).urgency, 'overdue');
  });

  test('a backup inside the records folder is refused, with the reason', () => {
    try {
      makeBackup(c.db, c.dir, c.dir, c.doctor, dekOf(c.db));
      assert.fail('a backup was allowed inside the folder it is backing up');
    } catch (error) {
      assert.ok(error instanceof BackupError);
      assert.match(error.userMessage, /inside the records folder/);
      assert.match(error.whatToDo, /USB stick/);
    }
  });

  test('a destination that is not there is refused before anything is copied', () => {
    assert.throws(
      () => makeBackup(c.db, c.dir, join(usb.dir, 'no-such-folder'), c.doctor, dekOf(c.db)),
      BackupError,
    );
  });

  test('photographs travel with the records, because they are inside them', () => {
    const patientId = (c.db.prepare('SELECT id FROM patient LIMIT 1').get() as { id: string }).id;
    const jpeg = Buffer.alloc(4096, 0x20);
    jpeg[0] = 0xff; jpeg[1] = 0xd8; jpeg[2] = 0xff; jpeg[3] = 0xe0;
    c.db.prepare(
      `INSERT INTO attachment (id, patient_id, kind, captured_at, content, content_type,
         byte_size, sha256, source, created_at, created_by)
       VALUES (?, ?, 'report', ?, ?, 'image/jpeg', ?, 'x', 'tablet', ?, ?)`,
    ).run(newId(), patientId, nowIso(), jpeg, jpeg.length, nowIso(), c.doctor.id);

    const before = statSync(join(c.dir, 'chamber-recall.db')).size;
    const { folder, manifest } = makeBackup(c.db, c.dir, usb.dir, c.doctor, dekOf(c.db), '2026-08-24T19:04:00.000Z');
    assert.equal(manifest.counts.attachment, 1);
    assert.ok(statSync(join(folder, 'chamber-recall.db')).size >= before);
  });
});

describe('checking a backup afterwards', () => {
  let c: ReturnType<typeof chamber>; let usb: ReturnType<typeof usbStick>; let folder = '';
  before(() => {
    c = chamber(2); usb = usbStick();
    folder = makeBackup(c.db, c.dir, usb.dir, c.doctor, dekOf(c.db)).folder;
  });
  after(() => { c.db.close(); c.cleanup(); usb.cleanup(); });

  test('a sound backup reports what is in it and no problems', () => {
    const inspection = inspectBackup(folder);
    assert.deepEqual(inspection.problems, []);
    assert.equal(inspection.databaseIntact, true);
    assert.equal(inspection.manifest?.counts.patient, 2);
  });

  test('a folder that is not a backup says so rather than half-working', () => {
    const empty = join(usb.dir, 'holiday-photos');
    mkdirSync(empty, { recursive: true });
    const inspection = inspectBackup(empty);
    assert.equal(inspection.manifest, null);
    assert.match(inspection.problems[0]!, /not a Chamber Recall backup/);
  });

  test('a records file damaged in a drawer is caught by its checksum', () => {
    const damaged = join(usb.dir, 'damaged');
    mkdirSync(damaged, { recursive: true });
    for (const file of ['manifest.json', 'chamber-recall.db', 'keystore.json']) {
      writeFileSync(join(damaged, file), readFileSync(join(folder, file)));
    }
    const bytes = readFileSync(join(damaged, 'chamber-recall.db'));
    bytes[2000] = bytes[2000]! ^ 0xff;
    writeFileSync(join(damaged, 'chamber-recall.db'), bytes);

    const inspection = inspectBackup(damaged);
    assert.equal(inspection.databaseIntact, false);
    assert.match(inspection.problems.join(' '), /damaged or changed/);
  });

  test('a missing file is named rather than discovered during a restore', () => {
    const partial = join(usb.dir, 'partial');
    mkdirSync(partial, { recursive: true });
    writeFileSync(join(partial, 'manifest.json'), readFileSync(join(folder, 'manifest.json')));
    const inspection = inspectBackup(partial);
    assert.match(inspection.problems.join(' '), /no records file/);
  });
});

describe('putting a backup back', () => {
  test('the records that were there are moved aside, never deleted', () => {
    const c = chamber(4);
    const usb = usbStick();
    const { folder } = makeBackup(c.db, c.dir, usb.dir, c.doctor, dekOf(c.db));

    // Something happens after the backup: two more patients arrive.
    for (let i = 0; i < 2; i++) {
      c.db.prepare(`INSERT INTO patient (id, full_name_bn, search_name_en, approx_age_years,
                      approx_age_recorded_on, sex, created_at, created_by, updated_at)
                    VALUES (?, 'পরে', 'later', 30, '2026-08-24', 'male', ?, ?, ?)`)
        .run(newId(), nowIso(), c.doctor.id, nowIso());
    }
    c.db.close();

    const { movedAsideTo } = restoreFromBackup(c.dir, folder, '2026-08-25T09:00:00.000Z');
    assert.ok(existsSync(join(movedAsideTo, 'chamber-recall.db')),
      'the records that were replaced must still be on the disk');

    const restored = openWithPassphrase(c.dir, 'passphrase');
    assert.equal((restored.prepare('SELECT count(*) AS n FROM patient').get() as { n: number }).n, 4,
      'the restored records are the ones from the backup');
    restored.close();

    // And what was moved aside is still openable, so nothing is lost.
    const superseded = openWithPassphrase(movedAsideTo, 'passphrase');
    assert.equal((superseded.prepare('SELECT count(*) AS n FROM patient').get() as { n: number }).n, 6);
    superseded.close();

    c.cleanup(); usb.cleanup();
  });

  test('a broken backup is refused before anything is touched', () => {
    const c = chamber(2);
    const usb = usbStick();
    const notABackup = join(usb.dir, 'nothing-here');
    mkdirSync(notABackup, { recursive: true });

    assert.throws(() => restoreFromBackup(c.dir, notABackup), BackupError);
    assert.ok(existsSync(join(c.dir, 'chamber-recall.db')), 'the records must be untouched');

    c.db.close(); c.cleanup(); usb.cleanup();
  });
});
