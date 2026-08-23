import { Outbox } from './outbox';

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

export interface ApiFailure { error: string; whatToDo: string }

async function request(path: string, body: unknown, method: 'GET' | 'POST' = 'POST'): Promise<unknown> {
  const token = storedToken();
  const response = await fetch(path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token === null ? {} : { 'x-chamber-token': token }),
    },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  });

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
  post: (path: string, body: unknown) => request(path, body),
};

/**
 * The one outbox for the whole tablet. Everything an assistant does
 * goes in here rather than straight out over the wifi.
 */
export const outbox = new Outbox(async (path, body) => { await request(path, body); });
