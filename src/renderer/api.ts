import type { InstallationStatus, DatabaseSummary, RedFlagStatus, RedFlagAlertView, Result } from '../shared/ipc';
import type { RecallCard } from '../shared/recall';
import type { PatientSearchResult, RegisterPatientInput, MergePreview } from '../shared/patients';
import type { QueueView, VisitStatus } from '../shared/queue';
import type { TabletStatus, AuthState, SignedInView, StaffView } from '../shared/ipc';
import type { ChamberView, VitalsInput, VitalsQuestion, EncounterDraft, MedicationInput } from '../shared/clinical';
import type { PrescriptionView, PrescriptionStatus } from '../shared/prescription';
import type { AttachmentView, AttachmentKind } from '../shared/attachments';
import type { PatientCopy } from '../shared/patientCopy';
import type { BackupStatus, BackupResult, BackupInspection } from '../shared/backup';
import type { PilotReport } from '../shared/pilot';
import type { PracticeSeedResult, SpareKeyStatus, SparePerson } from '../shared/ipc';

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
  tabletStatus(): Promise<Result<{ status: TabletStatus }>>;
  tabletRevoke(deviceId: string): Promise<Result<Record<string, never>>>;
  recallCardFor(visitId: string): Promise<Result<{ card: RecallCard | null }>>;
  intakeConfirm(intakeId: string): Promise<Result<Record<string, never>>>;
  intakeUnconfirm(intakeId: string): Promise<Result<Record<string, never>>>;
  intakeCorrect(intakeId: string, correction: unknown): Promise<Result<Record<string, never>>>;
  laptopRole(): Promise<Result<{ role: string }>>;
  setLaptopRole(role: string): Promise<Result<Record<string, never>>>;
  whoIsSignedIn(): Promise<Result<{ auth: AuthState }>>;
  signInList(): Promise<Result<{ people: StaffView[] }>>;
  signIn(userId: string, pin: string): Promise<Result<{ signedIn: SignedInView }>>;
  signOut(): Promise<Result<Record<string, never>>>;
  staffList(): Promise<Result<{ people: StaffView[] }>>;
  staffAdd(displayName: string, role: string, pin: string): Promise<Result<{ id: string }>>;
  staffSetPin(userId: string, pin: string): Promise<Result<Record<string, never>>>;
  staffSetActive(userId: string, active: boolean): Promise<Result<Record<string, never>>>;
  chamberOpen(visitId: string): Promise<Result<{ view: ChamberView }>>;
  chamberView(visitId: string): Promise<Result<{ view: ChamberView }>>;
  vitalsSave(visitId: string, input: VitalsInput): Promise<Result<{ questions: VitalsQuestion[] }>>;
  encounterSaveDraft(encounterId: string, draft: EncounterDraft): Promise<Result<Record<string, never>>>;
  encounterMedications(encounterId: string, lines: MedicationInput[]): Promise<Result<Record<string, never>>>;
  encounterInvestigations(encounterId: string, names: string[]): Promise<Result<Record<string, never>>>;
  encounterConfirm(encounterId: string): Promise<Result<Record<string, never>>>;
  encounterUnconfirm(encounterId: string, reason: string | null): Promise<Result<Record<string, never>>>;
  prescriptionView(visitId: string): Promise<Result<{ view: PrescriptionView }>>;
  prescriptionStatus(): Promise<Result<{ status: PrescriptionStatus }>>;
  prescriptionPrinted(visitId: string): Promise<Result<Record<string, never>>>;
  attachmentsFor(patientId: string): Promise<Result<{ attachments: AttachmentView[] }>>;
  attachmentContent(id: string): Promise<Result<{ dataUrl: string; view: AttachmentView }>>;
  attachmentAdd(patientId: string, visitId: string | null, kind: AttachmentKind, caption: string | null): Promise<Result<{ added: number }>>;
  attachmentRemove(id: string, reason: string): Promise<Result<Record<string, never>>>;
  backupStatus(): Promise<Result<{ status: BackupStatus }>>;
  backupNow(): Promise<Result<{ result: BackupResult | null }>>;
  backupInspect(): Promise<Result<{ inspection: BackupInspection | null }>>;
  patientCopyView(patientId: string): Promise<Result<{ copy: PatientCopy }>>;
  patientCopyToFile(patientId: string): Promise<Result<{ folder: string | null; papers: number }>>;
  patientCopyPrinted(patientId: string): Promise<Result<Record<string, never>>>;
  pilotReport(): Promise<Result<{ report: PilotReport }>>;
  researchExport(): Promise<Result<{ folder: string | null; patients: number; rows: number; excluded: number }>>;
  seedPractice(): Promise<Result<PracticeSeedResult>>;
  spareKeyStatus(): Promise<Result<{ status: SpareKeyStatus }>>;
  spareKeySetCode(code: string): Promise<Result<Record<string, never>>>;
  spareKeyClearCode(): Promise<Result<Record<string, never>>>;
  spareKeyPeople(spareKey: string): Promise<Result<{ people: SparePerson[] }>>;
  spareKeyReset(spareKey: string, userId: string, newPin: string):
    Promise<Result<{ displayName: string; using: string }>>;
  pinResetAcknowledge(): Promise<Result<Record<string, never>>>;
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
  tabletStatus: () => call((a) => a.tabletStatus()),
  tabletRevoke: (id) => call((a) => a.tabletRevoke(id)),
  recallCardFor: (visitId) => call((a) => a.recallCardFor(visitId)),
  intakeConfirm: (id) => call((a) => a.intakeConfirm(id)),
  intakeUnconfirm: (id) => call((a) => a.intakeUnconfirm(id)),
  intakeCorrect: (id, c) => call((a) => a.intakeCorrect(id, c)),
  laptopRole: () => call((a) => a.laptopRole()),
  setLaptopRole: (role) => call((a) => a.setLaptopRole(role)),
  whoIsSignedIn: () => call((a) => a.whoIsSignedIn()),
  signInList: () => call((a) => a.signInList()),
  signIn: (id, pin) => call((a) => a.signIn(id, pin)),
  signOut: () => call((a) => a.signOut()),
  staffList: () => call((a) => a.staffList()),
  staffAdd: (name, role, pin) => call((a) => a.staffAdd(name, role, pin)),
  staffSetPin: (id, pin) => call((a) => a.staffSetPin(id, pin)),
  staffSetActive: (id, active) => call((a) => a.staffSetActive(id, active)),
  chamberOpen: (visitId) => call((a) => a.chamberOpen(visitId)),
  chamberView: (visitId) => call((a) => a.chamberView(visitId)),
  vitalsSave: (visitId, input) => call((a) => a.vitalsSave(visitId, input)),
  encounterSaveDraft: (id, draft) => call((a) => a.encounterSaveDraft(id, draft)),
  encounterMedications: (id, lines) => call((a) => a.encounterMedications(id, lines)),
  encounterInvestigations: (id, names) => call((a) => a.encounterInvestigations(id, names)),
  encounterConfirm: (id) => call((a) => a.encounterConfirm(id)),
  encounterUnconfirm: (id, reason) => call((a) => a.encounterUnconfirm(id, reason)),
  prescriptionView: (visitId) => call((a) => a.prescriptionView(visitId)),
  prescriptionStatus: () => call((a) => a.prescriptionStatus()),
  prescriptionPrinted: (visitId) => call((a) => a.prescriptionPrinted(visitId)),
  attachmentsFor: (patientId) => call((a) => a.attachmentsFor(patientId)),
  attachmentContent: (id) => call((a) => a.attachmentContent(id)),
  attachmentAdd: (patientId, visitId, kind, caption) => call((a) => a.attachmentAdd(patientId, visitId, kind, caption)),
  attachmentRemove: (id, reason) => call((a) => a.attachmentRemove(id, reason)),
  backupStatus: () => call((a) => a.backupStatus()),
  backupNow: () => call((a) => a.backupNow()),
  backupInspect: () => call((a) => a.backupInspect()),
  patientCopyView: (patientId) => call((a) => a.patientCopyView(patientId)),
  patientCopyToFile: (patientId) => call((a) => a.patientCopyToFile(patientId)),
  patientCopyPrinted: (patientId) => call((a) => a.patientCopyPrinted(patientId)),
  pilotReport: () => call((a) => a.pilotReport()),
  researchExport: () => call((a) => a.researchExport()),
  seedPractice: () => call((a) => a.seedPractice()),
  spareKeyStatus: () => call((a) => a.spareKeyStatus()),
  spareKeySetCode: (code) => call((a) => a.spareKeySetCode(code)),
  spareKeyClearCode: () => call((a) => a.spareKeyClearCode()),
  spareKeyPeople: (spareKey) => call((a) => a.spareKeyPeople(spareKey)),
  spareKeyReset: (spareKey, userId, newPin) => call((a) => a.spareKeyReset(spareKey, userId, newPin)),
  pinResetAcknowledge: () => call((a) => a.pinResetAcknowledge()),
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
