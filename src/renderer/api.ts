import type { InstallationStatus, DatabaseSummary, Result } from '../shared/ipc';

interface Api {
  status(): Promise<Result<{ status: InstallationStatus }>>;
  create(passphrase: string, mode: 'demo' | 'live'): Promise<Result<{ recoveryKey: string }>>;
  unlock(passphrase: string): Promise<Result<Record<string, never>>>;
  summary(): Promise<Result<{ summary: DatabaseSummary }>>;
}

declare global {
  interface Window { chamberRecall?: Api }
}

export interface Failure { userMessage: string; whatToDo: string; technical: string }

/**
 * If the bridge to the database is missing, the screen must say so
 * loudly. The alternative, found the hard way during milestone 1, is a
 * window that shows "Starting..." forever while nothing is wrong on
 * screen and nothing is written to any log the user can see.
 */
const BRIDGE_MISSING: Failure = {
  userMessage: 'This program cannot reach the patient records at all.',
  whatToDo: 'Nothing has been damaged and nothing has been saved. Close the program and open it again. If it happens a second time, the installation is broken and needs to be reinstalled before it is used for patients.',
  technical: 'window.chamberRecall is undefined: the preload bridge did not load.',
};

export const api: Api = {
  status: () => call((a) => a.status()),
  create: (p, m) => call((a) => a.create(p, m)),
  unlock: (p) => call((a) => a.unlock(p)),
  summary: () => call((a) => a.summary()),
};

async function call<T extends object>(fn: (a: Api) => Promise<Result<T>>): Promise<Result<T>> {
  const bridge = window.chamberRecall;
  if (bridge === undefined) return { ok: false, ...BRIDGE_MISSING };
  try {
    return await fn(bridge);
  } catch (error) {
    return {
      ok: false,
      userMessage: 'This program could not finish what it was asked to do.',
      whatToDo: 'Nothing was saved. Close the program and open it again, and check that the last thing you entered is still there.',
      technical: String((error as Error)?.stack ?? error),
    };
  }
}

/**
 * Turns a result into either a value or a failure, and never into
 * silence. Every caller handles the failure case explicitly - there is
 * no code path in this project where an error is discarded.
 */
export function unwrap<T extends object>(result: Result<T>): { value: T | null; failure: Failure | null } {
  if (result.ok) {
    const { ok, ...value } = result;
    return { value: value as T, failure: null };
  }
  return { value: null, failure: { userMessage: result.userMessage, whatToDo: result.whatToDo, technical: result.technical } };
}
