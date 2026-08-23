// ===================================================================
// Creating and opening the installation.
// ===================================================================
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { openEncrypted, applySchema, migrate, isEmptyDatabase, setMeta, type Db, type DataMode } from './open';
import { createKeystore, parseKeystore, unlockWithPassphrase, unlockWithRecoveryKey } from '../keystore/keystore';
import { recordAudit } from './audit';
import { dbPath, keystorePath } from '../paths';
import { installRulebookTemplateIfMissing } from '../redflags/store';
import { installQuestionsTemplateIfMissing } from '../intake/store';
import { KeystoreMissingError } from '../../shared/errors';

/** True when this folder already holds an installation. */
export function isProvisioned(dir: string): boolean {
  return existsSync(keystorePath(dir)) && existsSync(dbPath(dir));
}

/**
 * Writes a file by writing a temporary file first and then renaming it
 * over the target. A rename is atomic, so a power cut during this
 * operation leaves either the old file or the new one - never a
 * half-written key file, which would lock the chamber out of every
 * record it has.
 */
function writeFileAtomic(path: string, contents: string): void {
  const temp = `${path}.writing`;
  writeFileSync(temp, contents, { encoding: 'utf8', mode: 0o600 });
  renameSync(temp, path);
}

export interface Provisioned {
  db: Db;
  /** Show once, require it to be printed, then never again. */
  recoveryKey: string;
}

export function provision(dir: string, passphrase: string, mode: DataMode): Provisioned {
  if (isProvisioned(dir)) {
    throw new Error(`Refusing to overwrite the existing installation in ${dir}`);
  }
  mkdirSync(dir, { recursive: true });

  const { keystore, dekHex, recoveryKey } = createKeystore(passphrase);

  // The key file is written BEFORE the database. If the order were
  // reversed and the machine died in between, there would be an
  // encrypted database with no key on earth able to open it.
  writeFileAtomic(keystorePath(dir), JSON.stringify(keystore, null, 2));

  const db = openEncrypted(dbPath(dir), dekHex);
  if (!isEmptyDatabase(db)) {
    db.close();
    throw new Error(`A database already exists at ${dbPath(dir)}`);
  }
  applySchema(db);
  setMeta(db, 'data_mode', mode);
  setMeta(db, 'created_at', new Date().toISOString());
  recordAudit(db, {
    actor: { id: null, role: 'system' },
    action: 'database_created',
    entity: 'app_meta',
    entityId: 'data_mode',
    details: { data_mode: mode },
  });

  // Put the red flag rules template beside the database. It is only
  // ever written when absent: reinstalling the software must never
  // overwrite rules a clinician has approved.
  if (installRulebookTemplateIfMissing(dir)) {
    recordAudit(db, {
      actor: { id: null, role: 'system' },
      action: 'rulebook_template_installed',
      entity: 'red_flag_rulebook',
      entityId: null,
      details: { note: 'placeholder rules; a doctor must replace them before live use' },
    });
  }
  if (installQuestionsTemplateIfMissing(dir)) {
    recordAudit(db, {
      actor: { id: null, role: 'system' },
      action: 'questions_template_installed',
      entity: 'intake_questions',
      entityId: null,
      details: { note: 'the intake questions as shipped; the doctor may edit them' },
    });
  }

  return { db, recoveryKey };
}

function readKeystoreFile(dir: string) {
  const path = keystorePath(dir);
  if (!existsSync(path)) throw new KeystoreMissingError(path);
  return parseKeystore(readFileSync(path, 'utf8'), path);
}

/**
 * Opening an existing installation ALSO brings its schema up to date.
 *
 * This is not optional and it is not a convenience. A chamber that has
 * been running since last year has an older database, and the software
 * it is now running expects the current one. Without this it opens
 * perfectly happily and then fails on the first query that touches
 * anything added since - which is how it was found: the queue screen
 * sat on "Reading today's list" for ever because the column it needed
 * had never been added to a database created before that migration
 * existed.
 */
function openAndUpgrade(dir: string, dekHex: string): Db {
  const db = openEncrypted(dbPath(dir), dekHex);
  try {
    migrate(db);
  } catch (cause) {
    db.close();
    throw cause;
  }

  // An installation made before the question file existed has no
  // questions.yaml, and the tablet then has nothing to ask - which is
  // how this was found. Writing it only when it is ABSENT means a
  // doctor's own edits can never be overwritten.
  //
  // The red flag rules are deliberately NOT treated this way. A missing
  // question file is an inconvenience the shipped default can fix; a
  // missing rules file means the safety layer is gone, and quietly
  // putting placeholders back would look like a recovery when it is
  // not. That one stays loud and keeps the chamber out of live use.
  installQuestionsTemplateIfMissing(dir);

  return db;
}

export function openWithPassphrase(dir: string, passphrase: string): Db {
  return openAndUpgrade(dir, unlockWithPassphrase(readKeystoreFile(dir), passphrase));
}

export function openWithRecoveryKey(dir: string, recoveryKey: string): Db {
  return openAndUpgrade(dir, unlockWithRecoveryKey(readKeystoreFile(dir), recoveryKey));
}

export { dirname };
