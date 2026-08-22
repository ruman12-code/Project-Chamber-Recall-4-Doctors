// ===================================================================
// Key custody
// ===================================================================
// The database is encrypted with SQLCipher. This file decides where the
// key that opens it actually lives.
//
// The design, and why:
//
//   There is ONE random 256-bit key that encrypts the database. It is
//   called the DEK (data encryption key). It is never shown to anyone
//   and never written to disk in the clear.
//
//   The DEK is stored twice, in a small file called keystore.json that
//   sits beside the database. Each copy is locked with a different
//   thing:
//
//     copy 1 is locked by the doctor's PASSPHRASE
//     copy 2 is locked by a printed RECOVERY KEY
//
//   Either one opens the records. Both are needed to be lost before the
//   records are lost.
//
//   Why store the key twice instead of deriving it straight from the
//   passphrase: if the key came from the passphrase alone, then a
//   forgotten passphrase would mean every patient record in the chamber
//   is gone permanently, and changing the passphrase would mean
//   re-encrypting the entire database. Both are unacceptable. With this
//   design a forgotten passphrase is survivable, and a passphrase
//   change rewrites one small file.
//
//   What this protects against: someone who steals the laptop, or
//   copies the database file, or takes a backup USB stick, cannot read
//   any patient record without the passphrase or the recovery key.
//
//   What this does NOT protect against: someone who is already using
//   the doctor's unlocked, running application. That is a physical
//   security question, not a cryptographic one.
//
// Everything here uses Node's built-in crypto. There are no third-party
// cryptography dependencies in this project, deliberately.
// ===================================================================

import {
  randomBytes,
  scryptSync,
  createCipheriv,
  createDecipheriv,
  timingSafeEqual,
} from 'node:crypto';
import {
  WrongPassphraseError,
  WrongRecoveryKeyError,
  KeystoreCorruptError,
} from '../../shared/errors';

/**
 * scrypt cost. Deliberately expensive: this runs once when the app is
 * opened for the evening, so roughly a second on an old laptop is a
 * good trade for making a stolen database far harder to attack by
 * guessing passwords.
 *
 * N must stay a power of two. If you ever change these numbers, OLD
 * KEYSTORE FILES STILL WORK, because the parameters used are written
 * into each keystore file and read back from there. Never read these
 * constants when unlocking - only when creating.
 */
const SCRYPT_PARAMS = { N: 1 << 16, r: 8, p: 1 } as const;
const SCRYPT_MAXMEM = 256 * 1024 * 1024;

const DEK_BYTES = 32; // 256-bit key for SQLCipher
const SALT_BYTES = 16;
const IV_BYTES = 12; // AES-GCM standard nonce length
const RECOVERY_BYTES = 20; // 160 bits -> exactly 32 base32 characters

/**
 * Crockford base32, with I, L, O and U removed. Those four are the
 * characters people mis-transcribe when reading a printed key aloud or
 * copying it by hand.
 */
const RECOVERY_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export interface WrappedKey {
  kdf: 'scrypt';
  N: number;
  r: number;
  p: number;
  salt: string;
  iv: string;
  tag: string;
  ciphertext: string;
}

export interface Keystore {
  format: 'chamber-recall-keystore';
  version: 1;
  createdAt: string;
  wrappers: {
    passphrase: WrappedKey;
    recovery: WrappedKey;
  };
}

function deriveKek(secret: string, salt: Buffer, params: { N: number; r: number; p: number }): Buffer {
  return scryptSync(secret.normalize('NFKC'), salt, DEK_BYTES, {
    N: params.N,
    r: params.r,
    p: params.p,
    maxmem: SCRYPT_MAXMEM,
  });
}

function wrap(dek: Buffer, secret: string): WrappedKey {
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const kek = deriveKek(secret, salt, SCRYPT_PARAMS);
  const cipher = createCipheriv('aes-256-gcm', kek, iv);
  const ciphertext = Buffer.concat([cipher.update(dek), cipher.final()]);
  return {
    kdf: 'scrypt',
    N: SCRYPT_PARAMS.N,
    r: SCRYPT_PARAMS.r,
    p: SCRYPT_PARAMS.p,
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    tag: cipher.getAuthTag().toString('hex'),
    ciphertext: ciphertext.toString('hex'),
  };
}

/**
 * Returns the DEK, or null if the secret was wrong.
 *
 * Null rather than a thrown error, because the caller knows whether a
 * wrong passphrase or a wrong recovery key was being tried and can say
 * so in the right words.
 */
function unwrap(wrapped: WrappedKey, secret: string): Buffer | null {
  const kek = deriveKek(secret, Buffer.from(wrapped.salt, 'hex'), wrapped);
  const decipher = createDecipheriv('aes-256-gcm', kek, Buffer.from(wrapped.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(wrapped.tag, 'hex'));
  try {
    return Buffer.concat([
      decipher.update(Buffer.from(wrapped.ciphertext, 'hex')),
      decipher.final(),
    ]);
  } catch {
    // The GCM authentication tag did not verify. The secret was wrong,
    // or the keystore file has been altered.
    return null;
  }
}

/** Formats as 8 groups of 4, e.g. 7K2M-9XQ4-... - readable off paper. */
export function formatRecoveryKey(raw: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of raw) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += RECOVERY_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += RECOVERY_ALPHABET[(value << (5 - bits)) & 31];
  return (out.match(/.{1,4}/g) ?? []).join('-');
}

/**
 * Accepts the key however the user typed it: lowercase, no dashes,
 * extra spaces. Also repairs the four classic misreadings, so a doctor
 * who writes O for 0 or l for 1 is not locked out of his own records by
 * a handwriting problem.
 */
export function normaliseRecoveryKey(input: string): string {
  return input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
    .replace(/U/g, 'V');
}

export interface NewKeystore {
  keystore: Keystore;
  /** Hex-encoded DEK, ready to hand to SQLCipher. */
  dekHex: string;
  /** Show this to the doctor ONCE, make him print it, then forget it. */
  recoveryKey: string;
}

export function createKeystore(passphrase: string): NewKeystore {
  const dek = randomBytes(DEK_BYTES);
  const recoveryRaw = randomBytes(RECOVERY_BYTES);
  const recoveryKey = formatRecoveryKey(recoveryRaw);

  const keystore: Keystore = {
    format: 'chamber-recall-keystore',
    version: 1,
    createdAt: new Date().toISOString(),
    wrappers: {
      passphrase: wrap(dek, passphrase),
      recovery: wrap(dek, normaliseRecoveryKey(recoveryKey)),
    },
  };

  return { keystore, dekHex: dek.toString('hex'), recoveryKey };
}

export function unlockWithPassphrase(keystore: Keystore, passphrase: string): string {
  const dek = unwrap(keystore.wrappers.passphrase, passphrase);
  if (dek === null) throw new WrongPassphraseError();
  return dek.toString('hex');
}

export function unlockWithRecoveryKey(keystore: Keystore, recoveryKey: string): string {
  const dek = unwrap(keystore.wrappers.recovery, normaliseRecoveryKey(recoveryKey));
  if (dek === null) throw new WrongRecoveryKeyError();
  return dek.toString('hex');
}

/**
 * Re-locks the SAME database key with a new passphrase. The database
 * itself is untouched, so this is instant even with years of records in
 * it, and the printed recovery key keeps working.
 */
export function changePassphrase(keystore: Keystore, dekHex: string, newPassphrase: string): Keystore {
  return {
    ...keystore,
    wrappers: { ...keystore.wrappers, passphrase: wrap(Buffer.from(dekHex, 'hex'), newPassphrase) },
  };
}

const REQUIRED_WRAPPER_FIELDS = ['kdf', 'N', 'r', 'p', 'salt', 'iv', 'tag', 'ciphertext'] as const;

/**
 * Checks a keystore read off disk before we rely on it. A damaged key
 * file must be reported as damaged, not silently treated as a wrong
 * password - those two situations call for completely different action
 * from the user.
 */
export function parseKeystore(raw: string, pathForMessage: string): Keystore {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new KeystoreCorruptError(pathForMessage, cause);
  }

  const ks = parsed as Keystore;
  const looksRight =
    ks !== null &&
    typeof ks === 'object' &&
    ks.format === 'chamber-recall-keystore' &&
    ks.version === 1 &&
    typeof ks.wrappers === 'object' &&
    ks.wrappers !== null &&
    (['passphrase', 'recovery'] as const).every((slot) => {
      const w = ks.wrappers[slot] as unknown as Record<string, unknown> | undefined;
      return w !== undefined && REQUIRED_WRAPPER_FIELDS.every((f) => w[f] !== undefined);
    });

  if (!looksRight) throw new KeystoreCorruptError(pathForMessage);
  return ks;
}

/** Constant-time compare, used by tests and by any future PIN check. */
export function secretsMatch(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}
