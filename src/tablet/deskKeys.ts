// ===================================================================
// Opening the tablet when the laptop is at the other chamber.
// ===================================================================
// The tablet is locked by Android and pinned to this one app. Biplob or
// Ruhul types their PIN to open it at the start of the evening. That
// check used to be made by the laptop, which is fine on the evenings
// the laptop is in the same room and useless on the evenings it is not
// -- and those are the evenings this whole two-chamber arrangement
// exists for.
//
// So the tablet keeps what it needs to make the check itself.
//
// HOW HONEST THIS IS -- read this before changing anything here
//
//   WHAT IS HELD: for front desk people only, a PBKDF2-HMAC-SHA256
//   verifier over their PIN, with a per-person salt, at 600,000
//   iterations. Not the PIN. Not the scrypt hash the laptop uses. The
//   doctor's PIN and the clinical assistant's PIN are never sent to any
//   tablet at all.
//
//   WHAT IT PROTECTS: nothing, on its own, against somebody who takes
//   the tablet apart properly. It is encrypted under the pairing token,
//   and the token is in the same storage, because the tablet has to
//   open itself after being switched off and on. A key kept beside the
//   lock is not a safe. Somebody with the storage and patience can
//   grind four digits against this offline; 600,000 iterations makes
//   that hours rather than seconds, and that is all it makes it.
//
//   WHAT THAT BUYS THEM: a kiosk that asks a patient screening
//   questions. Not the database, which is on the laptop behind
//   SQLCipher. Not any patient's history, which no tablet ever holds.
//   Not the ability to sign anything: when the laptop is next in reach
//   the tablet signs in to it for real and the laptop checks the scrypt
//   hash before it accepts a single record. The offline check opens a
//   screen. The laptop still decides whose name goes on a record.
//
//   WHAT ACTUALLY PROTECTS A LOST TABLET: disconnecting it on the
//   laptop, in one tap, which clears the token and makes every one of
//   these permanently unreadable. That is the answer, it has always
//   been the answer, and none of this changes it. A lost tablet is
//   still a notifiable event.
const KEYS_STORAGE = 'chamber-recall.desk-keys.v1';
const LOCK_STORAGE = 'chamber-recall.desk-lock.v1';

/**
 * Five, matching the laptop. The laptop's lockout is a minute's wait
 * because somebody is standing there with a patient in front of them.
 * This one does not lift on its own: an evening where the desk types
 * five wrong PINs into a tablet nobody can reach the laptop from is not
 * an evening that should quietly become a sixth attempt. Reaching the
 * laptop clears it, and so does the doctor setting a new PIN.
 */
export const OFFLINE_ATTEMPTS = 5;

export interface DeskKey {
  userId: string;
  displayName: string;
  salt: string;
  hash: string;
  iterations: number;
}

export interface DeskKeys {
  takenAt: string;
  keys: DeskKey[];
  /** Front desk people this tablet cannot let in on its own, and who
   *  therefore need their PIN set again on the laptop. */
  needPinSetAgain: Array<{ userId: string; displayName: string }>;
}

function hexBytes(hex: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function keyFrom(token: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(token), 'HKDF', false, ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF', hash: 'SHA-256',
      salt: new TextEncoder().encode('chamber-recall desk keys'),
      info: new TextEncoder().encode('v1'),
    },
    material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
}

export async function storeDeskKeys(token: string, keys: DeskKeys): Promise<void> {
  const key = await keyFrom(token);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(keys)),
  );
  const packed = new Uint8Array(iv.length + sealed.byteLength);
  packed.set(iv, 0);
  packed.set(new Uint8Array(sealed), iv.length);
  let binary = '';
  for (const b of packed) binary += String.fromCharCode(b);
  try {
    localStorage.setItem(KEYS_STORAGE, btoa(binary));
  } catch {
    forgetDeskKeys();
  }
}

/**
 * Anything wrong -- no copy, a damaged one, a token that no longer
 * matches -- is null, which means "the laptop is the only way in".
 * That is the old behaviour and it is a safe answer: it locks people
 * out of a kiosk, never into one.
 */
export async function loadDeskKeys(token: string): Promise<DeskKeys | null> {
  const raw = localStorage.getItem(KEYS_STORAGE);
  if (raw === null) return null;
  try {
    const binary = atob(raw);
    const packed = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) packed[i] = binary.charCodeAt(i);
    const key = await keyFrom(token);
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: packed.slice(0, 12) }, key, packed.slice(12),
    );
    const parsed = JSON.parse(new TextDecoder().decode(plain)) as DeskKeys;
    return Array.isArray(parsed.keys) ? parsed : null;
  } catch {
    return null;
  }
}

export function forgetDeskKeys(): void {
  try {
    localStorage.removeItem(KEYS_STORAGE);
    localStorage.removeItem(LOCK_STORAGE);
  } catch { /* nothing useful to do */ }
}

/** How many wrong PINs this tablet has taken with no laptop to ask. */
export function offlineFailures(): number {
  try {
    const raw = localStorage.getItem(LOCK_STORAGE);
    const n = raw === null ? 0 : Number(JSON.parse(raw).fails);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  } catch { return 0; }
}

export function offlineLocked(): boolean {
  return offlineFailures() >= OFFLINE_ATTEMPTS;
}

function noteFailure(): void {
  try { localStorage.setItem(LOCK_STORAGE, JSON.stringify({ fails: offlineFailures() + 1 })); }
  catch { /* the count is a courtesy; losing it does not open anything */ }
}

/** Reaching the laptop and signing in there is proof enough. */
export function clearOfflineFailures(): void {
  try { localStorage.removeItem(LOCK_STORAGE); } catch { /* nothing to do */ }
}

/** Byte for byte, no early exit. */
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

export type OfflineResult =
  | { ok: true; userId: string; displayName: string }
  | { ok: false; reason: 'locked' | 'wrong' | 'unknown'; failures: number };

/**
 * Check a PIN with no laptop.
 *
 * A wrong PIN costs an attempt. Choosing somebody this tablet was never
 * given a key for does not, and the reason is worth writing down: the
 * first version counted it, on the theory that refusals would otherwise
 * say which names are worth grinding at. They already do -- the sign-in
 * screen puts "opens without the laptop" on the buttons that do, before
 * anybody types anything, because the desk needs to know. So counting
 * it hid nothing and cost something real: the doctor tapping his own
 * name out of habit three times would lock his own front desk out of
 * their tablet for the evening.
 */
export async function verifyOffline(
  keys: DeskKeys, userId: string, pin: string,
): Promise<OfflineResult> {
  if (offlineLocked()) return { ok: false, reason: 'locked', failures: offlineFailures() };

  const entry = keys.keys.find((k) => k.userId === userId) ?? null;
  if (entry === null) return { ok: false, reason: 'unknown', failures: offlineFailures() };

  const material = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: hexBytes(entry.salt), iterations: entry.iterations },
    material, hexBytes(entry.hash).length * 8,
  );

  if (!sameBytes(new Uint8Array(bits), hexBytes(entry.hash))) {
    noteFailure();
    return { ok: false, reason: 'wrong', failures: offlineFailures() };
  }

  clearOfflineFailures();
  return { ok: true, userId: entry.userId, displayName: entry.displayName };
}
