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
import type { InstallationStatus, DatabaseSummary, RedFlagStatus, RedFlagAlertView, Result } from '../shared/ipc';
import type { RecallCard } from '../shared/recall';
import type { PatientSearchResult, RegisterPatientInput, MergePreview } from '../shared/patients';
import type { QueueView, VisitStatus } from '../shared/queue';
import type { TabletStatus } from '../shared/ipc';

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
});
