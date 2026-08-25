// ===================================================================
// The PIN, in a form the tablet can check on its own.
// ===================================================================
// The front desk tablet is pinned to one app and Biplob or Ruhul types
// their PIN to open it. That PIN used to be checked by the laptop over
// wifi -- which fails on precisely the evening it matters, the one
// where the doctor has taken the laptop to the other chamber and the
// desk here is on its own.
//
// So the tablet gets its own check. This module makes the material for
// it, and it is worth being exact about what has and has not changed.
//
// WHAT LEAVES THE LAPTOP
//
// Not the PIN. Not the scrypt hash the laptop signs people in with. A
// separate PBKDF2-HMAC-SHA256 verifier over the same PIN, with its own
// random salt, at a cost chosen to be slow. PBKDF2 because a browser
// can compute it and cannot compute scrypt; a separate salt so the two
// verifiers cannot be played off against each other.
//
// WHO IT IS SENT FOR
//
// Front desk only. Never the doctor, never the clinical assistant.
// Everything that reads a history, confirms an intake, or writes a
// clinical line is done by those two on the laptop, and their PINs stay
// on it. What an offline verifier can open is a kiosk that asks a
// patient the screening questions.
//
// WHAT IT STILL CANNOT DO
//
// Sign anything. When the laptop comes back the tablet signs in to it
// for real, with the PIN the person typed, and the laptop checks the
// scrypt hash as it always did. Until that happens the outbox holds.
// The offline check opens a screen; the laptop decides whose name goes
// on a record. That separation is the reason this was safe enough to
// build.
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import type { Db } from '../db/open';

/**
 * Deliberately expensive. This runs once when a PIN is set, and once
 * on the tablet at the start of an evening -- perhaps a second on a
 * cheap Android tablet, which nobody notices. It runs a great many
 * times for somebody grinding four digits out of a stolen tablet,
 * which is the entire point.
 */
export const OFFLINE_PIN = { iterations: 600000, keyLength: 32, digest: 'sha256' } as const;

export interface OfflineVerifier {
  salt: string;
  hash: string;
  iterations: number;
}

export function offlineVerifier(pin: string): OfflineVerifier {
  const salt = randomBytes(16);
  const hash = pbkdf2Sync(pin, salt, OFFLINE_PIN.iterations, OFFLINE_PIN.keyLength, OFFLINE_PIN.digest);
  return { salt: salt.toString('hex'), hash: hash.toString('hex'), iterations: OFFLINE_PIN.iterations };
}

/** What one tablet is given so it can open itself with no laptop. */
export interface DeskKey {
  userId: string;
  displayName: string;
  salt: string;
  hash: string;
  iterations: number;
}

/**
 * The front desk people this tablet may let in on its own.
 *
 * Four conditions, and each one is a way somebody stops being on this
 * list: not front desk, switched off, no PIN set, or a PIN set by a
 * version of this program that did not make offline verifiers. The
 * last of those is why the tablet says who it cannot let in rather
 * than quietly leaving them off the list -- the fix is the doctor
 * setting their PIN again, and nobody would guess that.
 */
export function deskKeys(db: Db): DeskKey[] {
  return db.prepare(
    `SELECT id AS userId, display_name AS displayName,
            pin_offline_salt AS salt, pin_offline_hash AS hash,
            pin_offline_iterations AS iterations
       FROM app_user
      WHERE role = 'front_desk'
        AND is_active = 1
        AND deleted_at IS NULL
        AND pin_hash IS NOT NULL
        AND pin_offline_hash IS NOT NULL
        AND pin_offline_salt IS NOT NULL
        AND pin_offline_iterations IS NOT NULL
      ORDER BY display_name`,
  ).all() as DeskKey[];
}

/**
 * Front desk people who have a PIN but no offline verifier, so the
 * tablet cannot let them in when the laptop is away. Said out loud on
 * the tablet, because the alternative is Ruhul standing at a locked
 * screen with no idea why his own PIN is not on the list.
 */
export function deskPeopleWithoutOfflineKeys(db: Db): Array<{ userId: string; displayName: string }> {
  return db.prepare(
    `SELECT id AS userId, display_name AS displayName
       FROM app_user
      WHERE role = 'front_desk'
        AND is_active = 1
        AND deleted_at IS NULL
        AND pin_hash IS NOT NULL
        AND (pin_offline_hash IS NULL OR pin_offline_salt IS NULL OR pin_offline_iterations IS NULL)
      ORDER BY display_name`,
  ).all() as Array<{ userId: string; displayName: string }>;
}
