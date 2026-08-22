// ===================================================================
// Creating and opening the installation.
// ===================================================================
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { openEncrypted, applySchema, isEmptyDatabase, setMeta, type Db, type DataMode } from './open';
import { createKeystore, parseKeystore, unlockWithPassphrase, unlockWithRecoveryKey } from '../keystore/keystore';
import { recordAudit } from './audit';
import { dbPath, keystorePath } from '../paths';
import { installRulebookTemplateIfMissing } from '../redflags/store';
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

  return { db, recoveryKey };
}

function readKeystoreFile(dir: string) {
  const path = keystorePath(dir);
  if (!existsSync(path)) throw new KeystoreMissingError(path);
  return parseKeystore(readFileSync(path, 'utf8'), path);
}

export function openWithPassphrase(dir: string, passphrase: string): Db {
  const dekHex = unlockWithPassphrase(readKeystoreFile(dir), passphrase);
  return openEncrypted(dbPath(dir), dekHex);
}

export function openWithRecoveryKey(dir: string, recoveryKey: string): Db {
  const dekHex = unlockWithRecoveryKey(readKeystoreFile(dir), recoveryKey);
  return openEncrypted(dbPath(dir), dekHex);
}

export { dirname };
