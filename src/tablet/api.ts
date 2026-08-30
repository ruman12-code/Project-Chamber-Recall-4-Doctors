import { Outbox } from './outbox';
import type { Directory } from './directory';
import type { DeskKeys } from './deskKeys';

/** What the front desk needs to know right now. Mirrors
 *  src/main/queue/deskSignal.ts. */
export interface DeskSignal {
  inChamber: {
    visitId: string; serialNo: number;
    nameBn: string | null; nameEn: string | null; outOfTurn: boolean;
  } | null;
  nextWaiting: {
    visitId: string; serialNo: number; nameBn: string | null; nameEn: string | null;
    /** Times this number has been called with nobody coming. */
    noAnswer: number;
    /** Nobody else is waiting, so there is nobody to move on to. */
    onlyOneWaiting: boolean;
    /** A screening rule flagged this patient. */
    flagged: boolean;
    /** Every flagged patient still in the calling order has been called
     *  with no answer, so the desk needs the way out offered. */
    allFlaggedUnanswered: boolean;
    /** How many flagged patients the calling order is still holding
     *  ahead of everybody else, this one included. */
    flaggedWaiting: number;
  } | null;
  waiting: number;
  /** Somebody this desk sent in whom the doctor has not answered about
   *  yet. While it is set the tablet says nothing: the patient is
   *  already at the door. */
  handoffPendingVisitId: string | null;
  at: string;
}

const TOKEN_KEY = 'chamber-recall.token.v1';

export function storedToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
export function storeToken(token: string): void {
  try { localStorage.setItem(TOKEN_KEY, token); } catch { /* a tablet with no storage still works, just not offline */ }
}
export function forgetToken(): void {
  try { localStorage.removeItem(TOKEN_KEY); } catch { /* nothing to do */ }
}

export class NeedsPairingError extends Error {}

/**
 * The wifi is down, or the laptop is at the other chamber, or it is
 * shut. Named rather than left as a bare fetch failure, because the
 * one thing the tablet must never do is treat "I could not ask" the
 * same as "the answer was no" -- one of those means carry on from what
 * this tablet already knows, and the other means refuse.
 */
export class LaptopUnreachableError extends Error {}

export interface ApiFailure { error: string; whatToDo: string }

async function request(path: string, body: unknown, method: 'GET' | 'POST' = 'POST'): Promise<unknown> {
  const token = storedToken();
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token === null ? {} : { 'x-chamber-token': token }),
      },
      body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
    });
  } catch (caught) {
    throw new LaptopUnreachableError(
      caught instanceof Error ? caught.message : 'The laptop could not be reached.',
    );
  }

  const text = await response.text();
  const parsed = text === '' ? {} : JSON.parse(text) as Record<string, unknown>;
  if (response.ok) return parsed;

  if (parsed.needsPairing === true) {
    forgetToken();
    throw new NeedsPairingError(String(parsed.error ?? 'This tablet is not paired.'));
  }
  const failure = new Error(String(parsed.error ?? 'The laptop refused that.')) as Error & {
    whatToDo?: string; errorBn?: string | null; whatToDoBn?: string | null; needsSignIn?: boolean;
  };
  failure.whatToDo = String(parsed.whatToDo ?? 'Try again.');
  // The tablet is Bangla first, so a refusal that has a Bangla version
  // travels with it rather than arriving in English on a Bangla screen.
  failure.errorBn = parsed.errorBn === undefined || parsed.errorBn === null ? null : String(parsed.errorBn);
  failure.whatToDoBn = parsed.whatToDoBn === undefined || parsed.whatToDoBn === null ? null : String(parsed.whatToDoBn);
  failure.needsSignIn = parsed.needsSignIn === true;
  throw failure;
}

export const api = {
  pair: (code: string, label: string) => request('/api/pair', { code, label }) as Promise<{ token: string }>,
  session: () => request('/api/session', null, 'GET') as Promise<Record<string, unknown>>,
  // Names and phone numbers only. See src/main/patients/directory.ts
  // for what is in it and what deliberately is not.
  directory: () => request('/api/directory', null, 'GET') as unknown as Promise<Directory>,
  // Asked every few seconds. A few bytes: who the doctor has called in,
  // who is next, and how many are waiting.
  deskSignal: () => request('/api/desk-signal', null, 'GET') as unknown as Promise<DeskSignal | null>,
  // What lets the front desk open this tablet with the laptop at the
  // other chamber. Front desk only, and see src/tablet/deskKeys.ts for
  // exactly what it does and does not protect.
  deskKeys: () => request('/api/desk-keys', null, 'GET') as unknown as Promise<Omit<DeskKeys, 'takenAt'>>,
  post: (path: string, body: unknown) => request(path, body),
};

/**
 * The one outbox for the whole tablet. Everything an assistant does
 * goes in here rather than straight out over the wifi.
 */
export const outbox = new Outbox(
  async (path, body) => { await request(path, body); },
  // "The laptop did not answer" is the ONLY failure worth waiting out.
  // Anything else is the laptop answering and refusing, which will
  // never come good by being sent again. See the top of outbox.ts.
  (error) => error instanceof LaptopUnreachableError,
);
