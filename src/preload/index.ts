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
});
