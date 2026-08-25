// ===================================================================
// The directory, on the tablet.
// ===================================================================
// Names and phone numbers, kept on the tablet so the front desk can
// tell a returning patient from a new one while the laptop is at the
// other chamber. Refreshed every time the laptop is reachable.
//
// HOW HONEST THIS ENCRYPTION IS
//
// The copy is encrypted with AES-GCM, under a key derived from the
// tablet's pairing token. That is worth doing and it is worth being
// precise about what it does:
//
//   IT DOES stop the list being read by somebody who picks the tablet
//   up and looks through the browser's storage, or who pulls a backup
//   off the device. It is not sitting there as plain text.
//
//   IT DOES mean that revoking the tablet on the laptop makes the copy
//   permanently unreadable, because clearing the token destroys the
//   only way to derive the key.
//
//   IT DOES NOT stop somebody who takes the tablet apart properly. The
//   token is in the same storage as the ciphertext, because the tablet
//   has to be able to read its own directory after being switched off
//   and on. A key kept beside the lock is not a safe.
//
// So this is one layer among several, and the others carry more weight:
// the tablet is pinned to one app, it holds no history at all, and a
// lost tablet is disconnected from the laptop in one tap. A lost tablet
// is still a notifiable event. Nothing here changes that.
import { normaliseName, searchablePhone } from '../shared/names';

const STORAGE_KEY = 'chamber-recall.directory.v1';

export interface DirectoryEntry {
  id: string;
  nameBn: string | null;
  nameEn: string | null;
  phone: string | null;
  sBn: string | null;
  sEn: string | null;
  sPhone: string | null;
}

export interface Directory {
  takenAt: string;
  entries: DirectoryEntry[];
}

function bytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
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
      salt: new TextEncoder().encode('chamber-recall directory'),
      info: new TextEncoder().encode('v1'),
    },
    material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
}

/** Write the directory to the tablet, encrypted. */
export async function storeDirectory(token: string, directory: Directory): Promise<void> {
  const key = await keyFrom(token);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(JSON.stringify(directory));
  const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain);
  const packed = new Uint8Array(iv.length + sealed.byteLength);
  packed.set(iv, 0);
  packed.set(new Uint8Array(sealed), iv.length);
  let binary = '';
  for (const b of packed) binary += String.fromCharCode(b);
  try {
    localStorage.setItem(STORAGE_KEY, btoa(binary));
  } catch {
    // Out of room. The tablet still works; it just cannot tell a
    // returning patient from a new one until the laptop is reachable.
    forgetDirectory();
  }
}

/**
 * Read it back. Anything that has gone wrong - no copy yet, a damaged
 * one, a token that no longer matches - returns null rather than
 * throwing, because a broken directory must never stop the desk
 * working. Null means "ask the laptop", which is the old behaviour.
 */
export async function loadDirectory(token: string): Promise<Directory | null> {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === null) return null;
  try {
    const binary = atob(raw);
    const packed = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) packed[i] = binary.charCodeAt(i);
    const key = await keyFrom(token);
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: packed.slice(0, 12) }, key, packed.slice(12),
    );
    const parsed = JSON.parse(new TextDecoder().decode(plain)) as Directory;
    return Array.isArray(parsed.entries) ? parsed : null;
  } catch {
    return null;
  }
}

/** Used when the tablet is disconnected, and when storage fills up. */
export function forgetDirectory(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch { /* nothing useful to do */ }
}

export interface DirectoryMatch {
  id: string;
  nameBn: string | null;
  nameEn: string | null;
  phone: string | null;
}

/**
 * Search the local copy, by the same rules the laptop uses: Unicode
 * normalisation and substring matching, and nothing else. No phonetic
 * guessing, no fuzzy distance.
 *
 * Always a list, even of one. The assistant chooses. This file contains
 * no function that returns a single patient for a search term, for the
 * same reason src/main/patients/search.ts contains none.
 */
export function searchDirectory(directory: Directory, query: string, limit = 20): DirectoryMatch[] {
  const term = query.trim();
  if (term.length < 2) return [];
  const asName = normaliseName(term);
  const asPhone = searchablePhone(term);

  const out: DirectoryMatch[] = [];
  for (const entry of directory.entries) {
    const byPhone = asPhone !== null && entry.sPhone !== null && entry.sPhone.includes(asPhone);
    const byName = asName !== null
      && ((entry.sBn !== null && entry.sBn.includes(asName))
        || (entry.sEn !== null && entry.sEn.includes(asName)));
    if (byPhone || byName) {
      out.push({ id: entry.id, nameBn: entry.nameBn, nameEn: entry.nameEn, phone: entry.phone });
      if (out.length >= limit) break;
    }
  }
  return out;
}
