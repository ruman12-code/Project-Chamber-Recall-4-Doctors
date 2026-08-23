import type { InstallationStatus, DatabaseSummary, RedFlagStatus, RedFlagAlertView, Result } from '../shared/ipc';
import type { RecallCard } from '../shared/recall';
import type { PatientSearchResult, RegisterPatientInput, MergePreview } from '../shared/patients';
import type { QueueView, VisitStatus } from '../shared/queue';

interface Api {
  status(): Promise<Result<{ status: InstallationStatus }>>;
  create(passphrase: string, mode: 'demo' | 'live'): Promise<Result<{ recoveryKey: string }>>;
  unlock(passphrase: string): Promise<Result<Record<string, never>>>;
  summary(): Promise<Result<{ summary: DatabaseSummary }>>;
  redFlagStatus(): Promise<Result<{ status: RedFlagStatus }>>;
  redFlagSample(): Promise<Result<{ alert: RedFlagAlertView | null }>>;
  redFlagAcknowledge(eventId: string): Promise<Result<Record<string, never>>>;
  recallCard(): Promise<Result<{ card: RecallCard | null }>>;
  patientSearch(query: string): Promise<Result<{ results: PatientSearchResult[] }>>;
  patientRegister(input: RegisterPatientInput): Promise<Result<{ id: string }>>;
  patientMergePreview(survivingId: string, duplicateId: string): Promise<Result<{ preview: MergePreview }>>;
  patientMerge(survivingId: string, duplicateId: string, note: string | null): Promise<Result<{ visitsMoved: number }>>;
  patientUndoMerge(duplicateId: string): Promise<Result<{ visitsMoved: number }>>;
  queueToday(): Promise<Result<{ view: QueueView }>>;
  queueSetChamber(chamberId: string): Promise<Result<Record<string, never>>>;
  queueRegisterArrival(patientId: string, allowSecondVisitToday: boolean): Promise<Result<{ serialNo: number; alreadyOnListVisitId: string | null }>>;
  queueSetStatus(visitId: string, status: VisitStatus): Promise<Result<Record<string, never>>>;
  queueMove(visitId: string, direction: 'up' | 'down'): Promise<Result<Record<string, never>>>;
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
  redFlagStatus: () => call((a) => a.redFlagStatus()),
  redFlagSample: () => call((a) => a.redFlagSample()),
  redFlagAcknowledge: (eventId) => call((a) => a.redFlagAcknowledge(eventId)),
  recallCard: () => call((a) => a.recallCard()),
  patientSearch: (query) => call((a) => a.patientSearch(query)),
  patientRegister: (input) => call((a) => a.patientRegister(input)),
  patientMergePreview: (s, d) => call((a) => a.patientMergePreview(s, d)),
  patientMerge: (s, d, note) => call((a) => a.patientMerge(s, d, note)),
  patientUndoMerge: (d) => call((a) => a.patientUndoMerge(d)),
  queueToday: () => call((a) => a.queueToday()),
  queueSetChamber: (id) => call((a) => a.queueSetChamber(id)),
  queueRegisterArrival: (id, allow) => call((a) => a.queueRegisterArrival(id, allow)),
  queueSetStatus: (id, status) => call((a) => a.queueSetStatus(id, status)),
  queueMove: (id, dir) => call((a) => a.queueMove(id, dir)),
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
