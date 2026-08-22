// ===================================================================
// Opening the encrypted database.
// ===================================================================
import Database from 'better-sqlite3-multiple-ciphers';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseUnreadableError } from '../../shared/errors';
import { nowIso } from './clock';

export type Db = Database.Database;

/** Where schema.sql sits once the project is compiled into out/. */
function schemaPath(): string {
  return join(__dirname, 'schema.sql');
}

/**
 * Opens the encrypted database file and proves the key works before
 * returning it.
 *
 * The proof matters. SQLCipher does not reject a wrong key when the key
 * is set; it fails later, on the first read, with an error that reads
 * like file corruption. If we did not force a read here, a wrong key
 * would surface much later as a confusing message in the middle of a
 * consultation. So we read from sqlite_master immediately and turn any
 * failure into a plain sentence.
 */
export function openEncrypted(dbPath: string, dekHex: string): Db {
  const db = new Database(dbPath);

  try {
    db.pragma(`cipher='sqlcipher'`);
    // The x'...' form hands SQLCipher the raw 256-bit key directly,
    // rather than a passphrase it would run its own weaker key
    // derivation over. Our key derivation is in keystore.ts.
    db.pragma(`key="x'${dekHex}'"`);
    db.prepare('SELECT count(*) AS n FROM sqlite_master').get();
  } catch (cause) {
    db.close();
    throw new DatabaseUnreadableError(dbPath, cause);
  }

  // Durability settings. These are the power-cut settings.
  //
  //   journal_mode = WAL   a crash mid-write leaves a recoverable file
  //   synchronous  = FULL  a committed write has actually reached the
  //                        disk before we tell the user it is saved
  //
  // synchronous=FULL is slower than the usual default. That cost is
  // accepted deliberately: load-shedding is routine at the pilot site,
  // and a saved encounter that evaporates because it was still sitting
  // in a disk cache would be exactly the failure this project exists to
  // prevent.
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = FULL');
  db.pragma('foreign_keys = ON');

  return db;
}

/**
 * Creates the schema in an empty database. Runs inside one transaction:
 * either the whole schema is there or the file is left untouched.
 */
export function applySchema(db: Db): void {
  const sql = readFileSync(schemaPath(), 'utf8');
  db.exec('BEGIN');
  try {
    db.exec(sql);
    db.exec(`PRAGMA user_version = 1`);
    db.exec('COMMIT');
  } catch (cause) {
    db.exec('ROLLBACK');
    throw cause;
  }
}

export function schemaVersion(db: Db): number {
  const rows = db.pragma('user_version') as Array<{ user_version: number }>;
  return rows[0]?.user_version ?? 0;
}

export function isEmptyDatabase(db: Db): boolean {
  const row = db.prepare(`SELECT count(*) AS n FROM sqlite_master WHERE type = 'table'`).get() as { n: number };
  return row.n === 0;
}

export function setMeta(db: Db, key: string, value: string): void {
  db.prepare(
    `INSERT INTO app_meta (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(key, value, nowIso());
}

export function getMeta(db: Db, key: string): string | null {
  const row = db.prepare('SELECT value FROM app_meta WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export type DataMode = 'demo' | 'live';

/**
 * 'demo' means this file may contain synthetic practice data and must
 * never be used for real patients. 'live' means the opposite, and the
 * seed script refuses to write to it. This flag is the only thing
 * standing between practice data and a real patient record, so it is
 * set once at creation and there is no code path that flips it.
 */
export function dataMode(db: Db): DataMode {
  return getMeta(db, 'data_mode') === 'live' ? 'live' : 'demo';
}
