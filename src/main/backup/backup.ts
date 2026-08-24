// ===================================================================
// Backups.
// ===================================================================
// One laptop. Everything a chamber knows about its patients is on it.
// A stolen laptop, a dead disk, a fire, or a spilt cup of tea and four
// years of records are gone - and no patient can reconstruct their own
// history from memory.
//
// So this milestone is not really about copying files. It is about
// three things that make a backup real:
//
//   IT IS VERIFIED. A copy nobody has ever opened is not a backup. So
//   the copy is opened, integrity-checked, and its row counts compared
//   with the source, before anybody is told it worked.
//
//   ITS AGE IS VISIBLE. A backup taken three months ago is a backup
//   that has already failed. The date is on the main screen and turns
//   amber and then red, because that is what makes it happen.
//
//   IT CAN BE READ WITHOUT THIS SOFTWARE. The folder carries a plain
//   text sheet saying what it is and how to put it back, because the
//   person reading it may have a dead laptop and no idea what any of
//   this is.
//
// HOW THE COPY IS TAKEN, AND WHY IT IS SAFE
//
// The WAL is checkpointed into the database file, and then the file is
// copied byte for byte. That is only safe if nothing writes in
// between - and nothing can. better-sqlite3 is synchronous and this
// whole program, including the server the tablet talks to, runs on one
// thread. Between the checkpoint and the end of the copy there is no
// point at which any other code runs.
import { createHash } from 'node:crypto';
import {
  copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync,
} from 'node:fs';
import { join, resolve, sep } from 'node:path';
import type { Db } from '../db/open';
import { openEncrypted, getMeta, setMeta, dataMode } from '../db/open';
import { nowIso, localDate } from '../db/clock';
import { recordAudit, type Actor } from '../db/audit';
import { recordUsage } from '../db/usage';
import { ChamberRecallError } from '../../shared/errors';
import {
  DB_FILENAME, KEYSTORE_FILENAME, RULEBOOK_FILENAME, QUESTIONS_FILENAME,
  CONSENT_FILENAME, PRESCRIPTION_FILENAME, CONSENT_AUDIO_DIR,
} from '../paths';
import type { BackupManifest, BackupResult, BackupStatus, BackupInspection } from '../../shared/backup';

export type { BackupManifest, BackupResult, BackupStatus, BackupInspection };

export class BackupError extends ChamberRecallError {}

/** Everything a working installation is made of. */
const FILES = [
  DB_FILENAME, KEYSTORE_FILENAME, RULEBOOK_FILENAME,
  QUESTIONS_FILENAME, CONSENT_FILENAME, PRESCRIPTION_FILENAME,
];

/** The tables whose counts are compared between source and copy. */
const COUNTED = [
  'patient', 'visit', 'intake', 'intake_answer', 'red_flag_event', 'vitals',
  'encounter', 'medication', 'investigation', 'attachment', 'app_user', 'audit_log',
];

/** After this many days the screen stops being polite about it. */
const DUE_DAYS = 3;
const OVERDUE_DAYS = 7;

function daysBetween(fromDate: string, toDate: string): number {
  const from = Date.parse(`${fromDate}T00:00:00Z`);
  const to = Date.parse(`${toDate}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.round((to - from) / 86400000);
}

function counts(db: Db): Record<string, number> {
  const result: Record<string, number> = {};
  for (const table of COUNTED) {
    result[table] = (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
  }
  return result;
}

function sha256Of(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function stamp(at: string): string {
  return at.slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
}

/**
 * Refuses the destinations that are not backups.
 *
 * A copy inside the records folder is not a backup of the records
 * folder. It is the commonest mistake there is, and it looks exactly
 * like success until the day the disk dies.
 */
function checkDestination(dataDir: string, destination: string): void {
  const data = resolve(dataDir);
  const target = resolve(destination);
  if (target === data || target.startsWith(data + sep)) {
    throw new BackupError(
      'That folder is inside the records folder, so it would be lost with everything else.',
      'Choose a USB stick, or a drive that is not this laptop. A copy on the same disk does not survive the disk.',
    );
  }
  if (!existsSync(target)) {
    throw new BackupError(
      'That folder is not there.',
      'Check the USB stick is still plugged in, and choose the folder again.',
    );
  }
  if (!statSync(target).isDirectory()) {
    throw new BackupError('That is a file, not a folder.', 'Choose a folder to put the backup in.');
  }
}

const RESTORE_SHEET = `CHAMBER RECALL - BACKUP

WHAT THIS IS
------------
A complete copy of one chamber's patient records, taken on the date in
manifest.json. Everything the software needs is in this folder.

THIS FOLDER IS AS SENSITIVE AS THE LAPTOP IT CAME FROM.
The records are encrypted, and keystore.json in this folder is the
locked-up key to them. Somebody with this folder AND the doctor's
password, or the printed recovery key, can read every patient record in
it. Keep the stick somewhere the laptop is not.

HOW TO PUT IT BACK
------------------
1. Close Chamber Recall completely on the laptop.

2. Find the records folder on the laptop. The program shows where it is
   on its own first screen. It has a file called chamber-recall.db in
   it.

3. Do NOT delete anything. Rename the existing records folder - put
   "-old" on the end of its name - so it is still there if this goes
   wrong.

4. Copy this whole folder to where the records folder was, and give it
   the name the records folder had.

5. Open Chamber Recall. It will ask for the password. It is the same
   password as before: the records in this folder are the same records,
   locked with the same key.

IF THE PASSWORD IS NOT ACCEPTED
-------------------------------
Use the printed recovery key instead. If that has also been lost, these
records cannot be opened by anybody, including whoever wrote this
software. There is no way around the encryption and that is the point
of it.

WHAT TO CHECK AFTERWARDS
------------------------
manifest.json in this folder lists how many patients, visits and
photographs were in the records when the backup was taken. The program's
first screen shows the same numbers. If they match, nothing is missing.
`;

/**
 * Takes the backup, verifies it, and only then says it worked.
 */
export function makeBackup(
  db: Db, dataDir: string, destination: string, actor: Actor, dekHex: string, at: string = nowIso(),
): BackupResult {
  checkDestination(dataDir, destination);

  const folder = join(destination, `chamber-recall-backup-${stamp(at)}`);
  if (existsSync(folder)) {
    throw new BackupError(
      'A backup taken in this same minute is already there.',
      'Wait a minute and take it again, or choose a different folder.',
    );
  }

  const sourceCounts = counts(db);
  const schemaVersion = Number((db.pragma('user_version', { simple: true }) as number) ?? 0);

  // Everything in the WAL goes into the database file, and then the
  // file is copied. Nothing else in this program can run in between.
  db.pragma('wal_checkpoint(TRUNCATE)');

  mkdirSync(folder, { recursive: true });
  const copied: string[] = [];
  for (const file of FILES) {
    const from = join(dataDir, file);
    if (!existsSync(from)) continue;
    copyFileSync(from, join(folder, file));
    copied.push(file);
  }

  // The spoken consent recordings, if the doctor has made them.
  const audioFrom = join(dataDir, CONSENT_AUDIO_DIR);
  if (existsSync(audioFrom) && statSync(audioFrom).isDirectory()) {
    mkdirSync(join(folder, CONSENT_AUDIO_DIR), { recursive: true });
    for (const name of readdirSync(audioFrom)) {
      const path = join(audioFrom, name);
      if (statSync(path).isFile()) {
        copyFileSync(path, join(folder, CONSENT_AUDIO_DIR, name));
        copied.push(`${CONSENT_AUDIO_DIR}/${name}`);
      }
    }
  }

  const copiedDb = join(folder, DB_FILENAME);
  if (!existsSync(copiedDb)) {
    throw new BackupError(
      'The records file was not copied.',
      'Nothing has been changed on the laptop. Check there is room on the stick and try again.',
    );
  }

  // ---- the part that makes it a backup rather than a copy ----
  let verified = false;
  let problem: string | null = null;
  try {
    const copy = openEncrypted(copiedDb, dekHex);
    try {
      const integrity = copy.pragma('integrity_check', { simple: true });
      if (integrity !== 'ok') {
        problem = `the copied records failed their own integrity check: ${String(integrity)}`;
      } else {
        const copyCounts = counts(copy);
        const differs = COUNTED.filter((t) => copyCounts[t] !== sourceCounts[t]);
        if (differs.length > 0) {
          problem = `the copy has different amounts of data in it (${differs.join(', ')})`;
        } else {
          verified = true;
        }
      }
    } finally {
      copy.close();
    }
  } catch (error) {
    problem = `the copied records could not be opened: ${(error as Error).message}`;
  }

  const manifest: BackupManifest = {
    what: 'Chamber Recall backup',
    takenAt: at,
    takenBy: actor.id,
    dataMode: dataMode(db),
    schemaVersion,
    counts: sourceCounts,
    databaseBytes: statSync(copiedDb).size,
    databaseSha256: sha256Of(copiedDb),
    files: copied,
    verified,
  };
  writeFileSync(join(folder, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  writeFileSync(join(folder, 'HOW-TO-RESTORE.txt'), RESTORE_SHEET, 'utf8');

  setMeta(db, 'last_backup_at', at);
  setMeta(db, 'last_backup_path', folder);
  setMeta(db, 'last_backup_ok', verified ? 'yes' : 'no');
  recordAudit(db, {
    actor, action: verified ? 'backup_taken' : 'backup_failed_verification', entity: 'app_meta',
    entityId: null, details: { folder, verified, problem, counts: sourceCounts },
  });
  recordUsage(db, { eventType: 'backup_taken', actorId: actor.id, timestamp: at });

  if (!verified) {
    throw new BackupError(
      'The copy was made but it could not be read back, so it is NOT a backup.',
      `${problem ?? 'The copy did not match the records.'} The files are in ${folder}. Try a different USB stick, and do not rely on this one.`,
    );
  }
  return { folder, manifest };
}

export function backupStatus(db: Db, now: Date = new Date()): BackupStatus {
  const at = getMeta(db, 'last_backup_at');
  const path = getMeta(db, 'last_backup_path');
  const ok = getMeta(db, 'last_backup_ok') === 'yes';
  if (at === null) {
    return { lastBackupAt: null, lastBackupPath: null, lastBackupOk: false, daysSince: null, urgency: 'never' };
  }
  // Whole calendar days, not elapsed hours. A backup taken at nine
  // last night is "yesterday" at eight this evening, and a screen
  // that calls that "0 days ago" is a screen nobody believes.
  const days = daysBetween(at.slice(0, 10), localDate(now));
  return {
    lastBackupAt: at,
    lastBackupPath: path,
    lastBackupOk: ok,
    daysSince: days,
    urgency: !ok || days >= OVERDUE_DAYS ? 'overdue' : days >= DUE_DAYS ? 'due' : 'fine',
  };
}

/**
 * Looking at a backup without restoring it.
 *
 * "Is my backup any good?" has to be answerable at any time, and the
 * only honest way to answer it is to look. This reads the manifest and
 * re-checksums the records file, which is what catches a USB stick
 * that has quietly gone bad in a drawer.
 */
export function inspectBackup(folder: string): BackupInspection {
  const problems: string[] = [];
  const manifestPath = join(folder, 'manifest.json');
  if (!existsSync(manifestPath)) {
    return {
      folder, manifest: null, databaseIntact: null, missingFiles: [],
      problems: ['There is no manifest.json here, so this is not a Chamber Recall backup folder.'],
    };
  }

  let manifest: BackupManifest | null = null;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as BackupManifest;
  } catch (error) {
    return {
      folder, manifest: null, databaseIntact: null, missingFiles: [],
      problems: [`The manifest in this folder could not be read: ${(error as Error).message}`],
    };
  }

  const missingFiles = (manifest.files ?? []).filter((f) => !existsSync(join(folder, f)));
  if (missingFiles.length > 0) problems.push(`Missing from the folder: ${missingFiles.join(', ')}`);

  let databaseIntact: boolean | null = null;
  const dbFile = join(folder, DB_FILENAME);
  if (existsSync(dbFile)) {
    databaseIntact = sha256Of(dbFile) === manifest.databaseSha256;
    if (!databaseIntact) {
      problems.push('The records file in this folder is not what was written. It has been damaged or changed since the backup was taken.');
    }
  } else {
    problems.push('There is no records file in this folder.');
  }
  if (manifest.verified === false) {
    problems.push('This backup was never verified when it was taken, so it may never have been readable.');
  }

  return { folder, manifest, databaseIntact, missingFiles, problems };
}

/**
 * Putting a backup back.
 *
 * Rare, done in a hurry, and the one operation in this whole system
 * that could destroy records rather than protect them. So:
 *
 *   Nothing is deleted, ever. What is there now is renamed aside and
 *   left on the disk.
 *
 *   The backup is inspected first, and a broken one is refused.
 *
 * The caller must have closed the database before calling this. There
 * is no safe way for a program to overwrite the file it is reading.
 */
export function restoreFromBackup(dataDir: string, folder: string, at: string = nowIso()): { movedAsideTo: string } {
  const inspection = inspectBackup(folder);
  if (inspection.manifest === null || inspection.problems.length > 0) {
    throw new BackupError(
      'That backup cannot be trusted, so nothing has been changed.',
      inspection.problems.join(' ') || 'There is no manifest in that folder.',
    );
  }

  // Where the records that are being replaced go. Never onto anything
  // that is already there: a restore attempted twice in the same
  // minute must not bury the first set.
  const parent = resolve(dataDir, '..');
  let aside = join(parent, `records-superseded-${stamp(at)}`);
  for (let n = 2; existsSync(aside); n += 1) {
    aside = join(parent, `records-superseded-${stamp(at)}-${n}`);
  }
  if (existsSync(dataDir)) {
    renameSync(dataDir, aside);
  }
  mkdirSync(dataDir, { recursive: true });

  for (const file of inspection.manifest.files) {
    const from = join(folder, file);
    const to = join(dataDir, file);
    mkdirSync(join(to, '..'), { recursive: true });
    copyFileSync(from, to);
  }
  return { movedAsideTo: aside };
}
