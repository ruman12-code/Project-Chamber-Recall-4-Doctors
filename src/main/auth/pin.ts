// ===================================================================
// PINs.
// ===================================================================
// Signing in at a chamber is not signing in to a bank. The people
// doing it are standing at a desk with a patient in front of them,
// twenty times an evening, and a password long enough to resist a
// determined attacker would be written on a sticky note by the second
// evening. A written-down password is worse than a short one.
//
// So it is a PIN, and the security it provides is stated honestly:
//
//   What a PIN DOES protect: the record of who did what. Biplob cannot
//   confirm a history as the doctor by walking up to the laptop, and a
//   patient left alone in the chamber for a minute cannot read the
//   previous patient's history.
//
//   What a PIN does NOT protect: the database. That is protected by
//   the passphrase and SQLCipher, and it is already unlocked by the
//   time anybody signs in. Someone who steals the laptop while it is
//   running and unlocked is not stopped by four digits, and nothing
//   here pretends otherwise.
//
// The hash is scrypt with a per-user salt, so the stored value is
// useless to somebody reading the database file, and two people who
// pick the same PIN do not share a hash.
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { ChamberRecallError } from '../../shared/errors';

export class BadPinError extends ChamberRecallError {}

/**
 * Cheaper than the keystore's cost, deliberately. This runs on every
 * sign-in on a slow laptop with a patient waiting, and the thing it
 * protects is not the database.
 */
const SCRYPT = { N: 16384, r: 8, p: 1, keyLength: 32 } as const;

export const PIN_LENGTH = { min: 4, max: 8 } as const;

/** Throws if this PIN is one the software should refuse to store. */
export function checkPin(pin: string): void {
  if (!/^[0-9]+$/.test(pin)) {
    throw new BadPinError(
      'A PIN is digits only.',
      `Use between ${PIN_LENGTH.min} and ${PIN_LENGTH.max} numbers, with no letters or spaces.`,
    );
  }
  if (pin.length < PIN_LENGTH.min || pin.length > PIN_LENGTH.max) {
    throw new BadPinError(
      `A PIN must be between ${PIN_LENGTH.min} and ${PIN_LENGTH.max} digits.`,
      'Pick a number of that length that you will remember without writing it down.',
    );
  }
  // The four everybody picks. Refusing these is not security theatre:
  // the whole point of the PIN is that one person cannot act as
  // another, and it fails completely the moment it is guessable by
  // somebody standing next to them.
  if (['1234', '0000', '1111', '123456'].includes(pin)) {
    throw new BadPinError(
      'That PIN is too easy to guess.',
      'Anyone in the chamber could try it in three attempts. Pick something else — it does not have to be complicated, only not obvious.',
    );
  }
  if (new Set(pin).size === 1) {
    throw new BadPinError(
      'That PIN is the same digit repeated.',
      'Pick something a person watching you type it would not guess.',
    );
  }
}

export function hashPin(pin: string): { salt: string; hash: string } {
  const salt = randomBytes(16);
  const hash = scryptSync(pin, salt, SCRYPT.keyLength, SCRYPT);
  return { salt: salt.toString('hex'), hash: hash.toString('hex') };
}

export function verifyPin(pin: string, salt: string | null, hash: string | null): boolean {
  if (salt === null || hash === null) return false;
  let expected: Buffer;
  try {
    expected = Buffer.from(hash, 'hex');
  } catch {
    return false;
  }
  const actual = scryptSync(pin, Buffer.from(salt, 'hex'), SCRYPT.keyLength, SCRYPT);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
