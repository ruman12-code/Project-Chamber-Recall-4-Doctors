// ===================================================================
// The spare key.
// ===================================================================
// What to do when the doctor cannot remember his own PIN.
//
// This is deliberately NOT a fourth role. Anybody in app_user can be
// picked at the sign-in screen and can therefore become the author of
// something, and the entire point of this credential is that it writes
// nothing clinical and never appears beside a patient's name. So there
// is no administrator to sign in AS. There is a credential that opens
// one screen with one button on it.
//
// Two things open that screen:
//
//   THE RECOVERY KEY, printed at setup and kept away from the laptop.
//   It always works and needs no setting up, which is the point: the
//   chamber that most needs a spare key is the one that never got
//   round to making one.
//
//   A SPARE CODE, which the doctor can set for whoever helps him with
//   the laptop, so that the recovery key can stay in its envelope.
//   Optional, and cleared as easily as it is set.
//
// Neither reaches a patient record. Neither is any use without the
// passphrase, because until that is typed there is no database open to
// reset a PIN in.
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { ChamberRecallError } from '../../shared/errors';
import { recordAudit, type Actor } from '../db/audit';
import { getMeta, setMeta, type Db } from '../db/open';
import { nowIso } from '../db/clock';
import { hashPin, checkPin } from './pin';
import { unlockWithRecoveryKey, parseKeystore } from '../keystore/keystore';
import { keystorePath } from '../paths';
import { readFileSync } from 'node:fs';

export class SpareKeyError extends ChamberRecallError {}

/** Which spare key was used. Not who held it: a shared code cannot
 *  honestly name a person, and pretending otherwise would be worse
 *  than saying plainly that it was the spare code. */
export type SpareKeyKind = 'recovery key' | 'spare code';

const SPARE_CODE_SALT = 'spare_code_salt';
const SPARE_CODE_HASH = 'spare_code_hash';
const SPARE_CODE_SET_AT = 'spare_code_set_at';

/** Long enough to be worth having. Shorter than a passphrase, because
 *  it opens one screen rather than the records. */
export const SPARE_CODE_MIN = 8;

const SCRYPT = { N: 16384, r: 8, p: 1, keyLength: 32 } as const;

export function spareCodeIsSet(db: Db): boolean {
  return getMeta(db, SPARE_CODE_HASH) !== null;
}

export function spareCodeSetAt(db: Db): string | null {
  return getMeta(db, SPARE_CODE_SET_AT);
}

/** The doctor sets a spare code, or replaces the one that is there. */
export function setSpareCode(db: Db, code: string, actor: Actor): void {
  if (actor.role !== 'doctor' && actor.role !== 'system') {
    throw new SpareKeyError(
      'Only the doctor can set the spare code.',
      'Sign out and let the doctor sign in.',
    );
  }
  const trimmed = code.trim();
  if (trimmed.length < SPARE_CODE_MIN) {
    throw new SpareKeyError(
      `The spare code needs at least ${SPARE_CODE_MIN} characters.`,
      'A short phrase somebody can be told over the phone is fine. It is not the password to the records.',
    );
  }
  const salt = randomBytes(16);
  setMeta(db, SPARE_CODE_SALT, salt.toString('hex'));
  setMeta(db, SPARE_CODE_HASH, scryptSync(trimmed, salt, SCRYPT.keyLength, SCRYPT).toString('hex'));
  setMeta(db, SPARE_CODE_SET_AT, nowIso());
  recordAudit(db, {
    actor, action: 'spare_code_set', entity: 'app_meta', entityId: SPARE_CODE_HASH,
  });
}

/** Take the spare code away again. The recovery key still works. */
export function clearSpareCode(db: Db, actor: Actor): void {
  if (actor.role !== 'doctor' && actor.role !== 'system') {
    throw new SpareKeyError(
      'Only the doctor can clear the spare code.',
      'Sign out and let the doctor sign in.',
    );
  }
  setMeta(db, SPARE_CODE_SALT, '');
  db.prepare('DELETE FROM app_meta WHERE key IN (?, ?, ?)')
    .run(SPARE_CODE_SALT, SPARE_CODE_HASH, SPARE_CODE_SET_AT);
  recordAudit(db, { actor, action: 'spare_code_cleared', entity: 'app_meta', entityId: SPARE_CODE_HASH });
}

function spareCodeMatches(db: Db, attempt: string): boolean {
  const salt = getMeta(db, SPARE_CODE_SALT);
  const hash = getMeta(db, SPARE_CODE_HASH);
  if (salt === null || hash === null || salt === '' || hash === '') return false;
  let expected: Buffer;
  try {
    expected = Buffer.from(hash, 'hex');
  } catch {
    return false;
  }
  const actual = scryptSync(attempt.trim(), Buffer.from(salt, 'hex'), SCRYPT.keyLength, SCRYPT);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function recoveryKeyMatches(dir: string, attempt: string): boolean {
  try {
    const keystore = parseKeystore(readFileSync(keystorePath(dir), 'utf8'), keystorePath(dir));
    unlockWithRecoveryKey(keystore, attempt);
    return true;
  } catch {
    return false;
  }
}

/**
 * Is this string one of the two spare keys? Returns which one, so the
 * reset can be recorded as what it actually was.
 *
 * Both are checked whatever was typed, so that the time this takes
 * says nothing about which one was closer to right.
 */
export function whichSpareKey(db: Db, dir: string, attempt: string): SpareKeyKind | null {
  const byCode = spareCodeMatches(db, attempt);
  const byRecovery = recoveryKeyMatches(dir, attempt);
  if (byRecovery) return 'recovery key';
  if (byCode) return 'spare code';
  return null;
}

export interface SpareKeyPerson {
  id: string;
  displayName: string;
  role: string;
  isActive: boolean;
  canSignIn: boolean;
}

/**
 * Everybody whose PIN could be reset. Names and roles only: this
 * screen never shows a patient, a number, or anything from a record.
 */
export function peopleForSpareKey(db: Db): SpareKeyPerson[] {
  return db.prepare(
    `SELECT id, display_name AS displayName, role, is_active AS isActive, pin_hash AS pinHash
       FROM app_user
      WHERE deleted_at IS NULL AND id NOT LIKE 'unassigned-%'
      ORDER BY CASE role WHEN 'doctor' THEN 0 WHEN 'clinical_assistant' THEN 1 ELSE 2 END, display_name`,
  ).all().map((r) => {
    const row = r as Record<string, unknown>;
    return {
      id: String(row.id),
      displayName: String(row.displayName),
      role: String(row.role),
      isActive: row.isActive === 1,
      canSignIn: row.pinHash !== null,
    };
  });
}

/**
 * Reset somebody's PIN, holding a spare key.
 *
 * The spare key is re-checked HERE rather than trusted from the screen
 * that asked for it, so there is no sequence of calls that resets a PIN
 * without one.
 *
 * The reset is written to the audit log and left on the person's own
 * screen until they acknowledge it. Somebody holding the spare key
 * could reset the doctor's PIN and then sign in as the doctor; four
 * digits were never going to stop that. What the program can do is
 * make sure it cannot happen QUIETLY.
 */
export function resetPinWithSpareKey(
  db: Db, dir: string, spareKey: string, userId: string, newPin: string,
): { displayName: string; using: SpareKeyKind } {
  const using = whichSpareKey(db, dir, spareKey);
  if (using === null) {
    throw new SpareKeyError(
      'That is not the recovery key, and not the spare code either.',
      'The recovery key is the long line of letters printed when this was set up. The spare code is whatever the doctor chose. If neither is to hand, nobody can reset a PIN.',
    );
  }
  checkPin(newPin);

  const person = db.prepare(
    `SELECT display_name AS displayName FROM app_user WHERE id = ? AND deleted_at IS NULL`,
  ).get(userId) as { displayName: string } | undefined;
  if (person === undefined) {
    throw new SpareKeyError(
      'That person is not in this installation.',
      'Go back and choose somebody from the list.',
    );
  }

  const { salt, hash } = hashPin(newPin);
  const at = nowIso();
  db.prepare(
    `UPDATE app_user
        SET pin_salt = ?, pin_hash = ?, pin_set_at = ?,
            pin_reset_at = ?, pin_reset_with = ?, pin_reset_seen_at = NULL
      WHERE id = ?`,
  ).run(salt, hash, at, at, using, userId);

  recordAudit(db, {
    actor: { id: null, role: 'system' },
    action: 'pin_reset_with_spare_key',
    entity: 'app_user',
    entityId: userId,
    details: { using, displayName: person.displayName },
  });

  return { displayName: person.displayName, using };
}

export interface PinResetNotice {
  at: string;
  using: SpareKeyKind;
}

/** Was this person's PIN reset by somebody holding a spare key, and
 *  have they been told yet? */
export function pinResetNotice(db: Db, userId: string): PinResetNotice | null {
  const row = db.prepare(
    `SELECT pin_reset_at AS at, pin_reset_with AS using_ FROM app_user
      WHERE id = ? AND pin_reset_at IS NOT NULL AND pin_reset_seen_at IS NULL`,
  ).get(userId) as { at: string; using_: string } | undefined;
  if (row === undefined) return null;
  return { at: row.at, using: row.using_ as SpareKeyKind };
}

/** The person says they knew about it. Recorded, so that "I was never
 *  told" and "I acknowledged it" are different things afterwards. */
export function acknowledgePinReset(db: Db, actor: Actor): void {
  if (actor.id === null) return;
  db.prepare('UPDATE app_user SET pin_reset_seen_at = ? WHERE id = ?').run(nowIso(), actor.id);
  recordAudit(db, { actor, action: 'pin_reset_acknowledged', entity: 'app_user', entityId: actor.id });
}
