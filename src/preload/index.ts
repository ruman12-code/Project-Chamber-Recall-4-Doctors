// ===================================================================
// The bridge between the screen and the database.
// ===================================================================
// IMPORTANT, and the reason this file looks repetitive:
//
// This preload runs sandboxed (sandbox: true in index.ts). A sandboxed
// preload may only require 'electron' itself - it CANNOT require
// another file from this project. So the channel names below are
// written out as literals rather than imported from shared/ipc.ts.
//
// That duplication is checked by a test (tests/preload.test.ts) which
// fails if this file and shared/ipc.ts ever drift apart. Do not delete
// that test: when this file breaks, the symptom is a window that sits
// on "Starting..." forever with nothing in any log.
//
// Types are imported with `import type`, which the compiler erases, so
// no require of a project file survives into the compiled output.
import { contextBridge, ipcRenderer } from 'electron';
import type { InstallationStatus, DatabaseSummary, RedFlagStatus, RedFlagAlertView, Result, PracticeSeedResult, SpareKeyStatus, SparePerson } from '../shared/ipc';
import type { RecallCard } from '../shared/recall';
import type { PatientSearchResult, RegisterPatientInput, MergePreview } from '../shared/patients';
import type { QueueView, VisitStatus } from '../shared/queue';
import type { TabletStatus, AuthState, SignedInView, StaffView } from '../shared/ipc';
import type { ChamberView, VitalsInput, EncounterDraft, MedicationInput, VitalsQuestion } from '../shared/clinical';
import type { PrescriptionView, PrescriptionStatus } from '../shared/prescription';
import type { AttachmentView, AttachmentKind } from '../shared/attachments';
import type { PatientCopy } from '../shared/patientCopy';
import type { BackupStatus, BackupResult, BackupInspection } from '../shared/backup';
import type { PilotReport } from '../shared/pilot';

contextBridge.exposeInMainWorld('chamberRecall', {
  status: (): Promise<Result<{ status: InstallationStatus }>> =>
    ipcRenderer.invoke('installation:status'),
  create: (passphrase: string, mode: 'demo' | 'live'): Promise<Result<{ recoveryKey: string }>> =>
    ipcRenderer.invoke('installation:create', passphrase, mode),
  unlock: (passphrase: string): Promise<Result<Record<string, never>>> =>
    ipcRenderer.invoke('installation:unlock', passphrase),
  summary: (): Promise<Result<{ summary: DatabaseSummary }>> =>
    ipcRenderer.invoke('database:summary'),
  redFlagStatus: (): Promise<Result<{ status: RedFlagStatus }>> =>
    ipcRenderer.invoke('redflags:status'),
  redFlagSample: (): Promise<Result<{ alert: RedFlagAlertView | null }>> =>
    ipcRenderer.invoke('redflags:sample'),
  redFlagAcknowledge: (eventId: string): Promise<Result<Record<string, never>>> =>
    ipcRenderer.invoke('redflags:acknowledge', eventId),
  recallCard: (): Promise<Result<{ card: RecallCard | null }>> =>
    ipcRenderer.invoke('recall:card'),
  patientSearch: (query: string): Promise<Result<{ results: PatientSearchResult[] }>> =>
    ipcRenderer.invoke('patients:search', query),
  patientRegister: (input: RegisterPatientInput): Promise<Result<{ id: string }>> =>
    ipcRenderer.invoke('patients:register', input),
  patientMergePreview: (survivingId: string, duplicateId: string): Promise<Result<{ preview: MergePreview }>> =>
    ipcRenderer.invoke('patients:mergePreview', survivingId, duplicateId),
  patientMerge: (survivingId: string, duplicateId: string, note: string | null): Promise<Result<{ visitsMoved: number }>> =>
    ipcRenderer.invoke('patients:merge', survivingId, duplicateId, note),
  patientUndoMerge: (duplicateId: string): Promise<Result<{ visitsMoved: number }>> =>
    ipcRenderer.invoke('patients:undoMerge', duplicateId),
  queueToday: (): Promise<Result<{ view: QueueView }>> =>
    ipcRenderer.invoke('queue:today'),
  queueSetChamber: (chamberId: string): Promise<Result<Record<string, never>>> =>
    ipcRenderer.invoke('queue:setChamber', chamberId),
  queueRegisterArrival: (patientId: string, allowSecondVisitToday: boolean): Promise<Result<{ serialNo: number; alreadyOnListVisitId: string | null }>> =>
    ipcRenderer.invoke('queue:registerArrival', patientId, allowSecondVisitToday),
  queueSetStatus: (visitId: string, status: VisitStatus): Promise<Result<Record<string, never>>> =>
    ipcRenderer.invoke('queue:setStatus', visitId, status),
  queueMove: (visitId: string, direction: 'up' | 'down'): Promise<Result<Record<string, never>>> =>
    ipcRenderer.invoke('queue:move', visitId, direction),
  tabletStatus: (): Promise<Result<{ status: TabletStatus }>> =>
    ipcRenderer.invoke('tablet:status'),
  tabletRevoke: (deviceId: string): Promise<Result<Record<string, never>>> =>
    ipcRenderer.invoke('tablet:revoke', deviceId),
  recallCardFor: (visitId: string): Promise<Result<{ card: RecallCard | null }>> =>
    ipcRenderer.invoke('recall:card', visitId),
  intakeConfirm: (intakeId: string): Promise<Result<Record<string, never>>> =>
    ipcRenderer.invoke('intake:confirm', intakeId),
  intakeUnconfirm: (intakeId: string): Promise<Result<Record<string, never>>> =>
    ipcRenderer.invoke('intake:unconfirm', intakeId),
  intakeCorrect: (intakeId: string, correction: unknown): Promise<Result<Record<string, never>>> =>
    ipcRenderer.invoke('intake:correct', intakeId, correction),
  laptopRole: (): Promise<Result<{ role: string }>> =>
    ipcRenderer.invoke('laptop:role'),
  setLaptopRole: (role: string): Promise<Result<Record<string, never>>> =>
    ipcRenderer.invoke('laptop:setRole', role),

  whoIsSignedIn: (): Promise<Result<{ auth: AuthState }>> =>
    ipcRenderer.invoke('auth:who'),
  signInList: (): Promise<Result<{ people: StaffView[] }>> =>
    ipcRenderer.invoke('auth:list'),
  signIn: (userId: string, pin: string): Promise<Result<{ signedIn: SignedInView }>> =>
    ipcRenderer.invoke('auth:signIn', userId, pin),
  signOut: (): Promise<Result<Record<string, never>>> =>
    ipcRenderer.invoke('auth:signOut'),
  staffList: (): Promise<Result<{ people: StaffView[] }>> =>
    ipcRenderer.invoke('auth:staff'),
  staffAdd: (displayName: string, role: string, pin: string): Promise<Result<{ id: string }>> =>
    ipcRenderer.invoke('auth:staffAdd', displayName, role, pin),
  staffSetPin: (userId: string, pin: string): Promise<Result<Record<string, never>>> =>
    ipcRenderer.invoke('auth:staffSetPin', userId, pin),
  staffSetActive: (userId: string, active: boolean): Promise<Result<Record<string, never>>> =>
    ipcRenderer.invoke('auth:staffSetActive', userId, active),

  chamberOpen: (visitId: string): Promise<Result<{ view: ChamberView }>> =>
    ipcRenderer.invoke('chamber:open', visitId),
  chamberView: (visitId: string): Promise<Result<{ view: ChamberView }>> =>
    ipcRenderer.invoke('chamber:view', visitId),
  vitalsSave: (visitId: string, input: VitalsInput): Promise<Result<{ questions: VitalsQuestion[] }>> =>
    ipcRenderer.invoke('chamber:vitals', visitId, input),
  encounterSaveDraft: (encounterId: string, draft: EncounterDraft): Promise<Result<Record<string, never>>> =>
    ipcRenderer.invoke('chamber:draft', encounterId, draft),
  encounterMedications: (encounterId: string, lines: MedicationInput[]): Promise<Result<Record<string, never>>> =>
    ipcRenderer.invoke('chamber:medications', encounterId, lines),
  encounterInvestigations: (encounterId: string, names: string[]): Promise<Result<Record<string, never>>> =>
    ipcRenderer.invoke('chamber:investigations', encounterId, names),
  encounterConfirm: (encounterId: string): Promise<Result<Record<string, never>>> =>
    ipcRenderer.invoke('chamber:confirm', encounterId),
  encounterUnconfirm: (encounterId: string, reason: string | null): Promise<Result<Record<string, never>>> =>
    ipcRenderer.invoke('chamber:unconfirm', encounterId, reason),

  prescriptionView: (visitId: string): Promise<Result<{ view: PrescriptionView }>> =>
    ipcRenderer.invoke('prescription:view', visitId),
  prescriptionStatus: (): Promise<Result<{ status: PrescriptionStatus }>> =>
    ipcRenderer.invoke('prescription:status'),
  prescriptionPrinted: (visitId: string): Promise<Result<Record<string, never>>> =>
    ipcRenderer.invoke('prescription:printed', visitId),

  attachmentsFor: (patientId: string): Promise<Result<{ attachments: AttachmentView[] }>> =>
    ipcRenderer.invoke('attachments:list', patientId),
  attachmentContent: (id: string): Promise<Result<{ dataUrl: string; view: AttachmentView }>> =>
    ipcRenderer.invoke('attachments:content', id),
  attachmentAdd: (patientId: string, visitId: string | null, kind: AttachmentKind, caption: string | null): Promise<Result<{ added: number }>> =>
    ipcRenderer.invoke('attachments:add', patientId, visitId, kind, caption),
  attachmentRemove: (id: string, reason: string): Promise<Result<Record<string, never>>> =>
    ipcRenderer.invoke('attachments:remove', id, reason),

  backupStatus: (): Promise<Result<{ status: BackupStatus }>> =>
    ipcRenderer.invoke('backup:status'),
  backupNow: (): Promise<Result<{ result: BackupResult | null }>> =>
    ipcRenderer.invoke('backup:now'),
  backupInspect: (): Promise<Result<{ inspection: BackupInspection | null }>> =>
    ipcRenderer.invoke('backup:inspect'),
  patientCopyView: (patientId: string): Promise<Result<{ copy: PatientCopy }>> =>
    ipcRenderer.invoke('export:patientCopy', patientId),
  patientCopyToFile: (patientId: string): Promise<Result<{ folder: string | null; papers: number }>> =>
    ipcRenderer.invoke('export:patientCopyFile', patientId),
  patientCopyPrinted: (patientId: string): Promise<Result<Record<string, never>>> =>
    ipcRenderer.invoke('export:patientCopyPrinted', patientId),

  pilotReport: (): Promise<Result<{ report: PilotReport }>> =>
    ipcRenderer.invoke('report:pilot'),
  researchExport: (): Promise<Result<{ folder: string | null; patients: number; rows: number; excluded: number }>> =>
    ipcRenderer.invoke('report:research'),

  seedPractice: (): Promise<Result<PracticeSeedResult>> =>
    ipcRenderer.invoke('practice:seed'),

  spareKeyStatus: (): Promise<Result<{ status: SpareKeyStatus }>> =>
    ipcRenderer.invoke('spare:status'),
  spareKeySetCode: (code: string): Promise<Result<Record<string, never>>> =>
    ipcRenderer.invoke('spare:setCode', code),
  spareKeyClearCode: (): Promise<Result<Record<string, never>>> =>
    ipcRenderer.invoke('spare:clearCode'),
  spareKeyPeople: (spareKey: string): Promise<Result<{ people: SparePerson[] }>> =>
    ipcRenderer.invoke('spare:people', spareKey),
  spareKeyReset: (spareKey: string, userId: string, newPin: string):
    Promise<Result<{ displayName: string; using: string }>> =>
    ipcRenderer.invoke('spare:reset', spareKey, userId, newPin),
  pinResetAcknowledge: (): Promise<Result<Record<string, never>>> =>
    ipcRenderer.invoke('spare:acknowledge'),
});
