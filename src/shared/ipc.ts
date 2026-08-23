// The complete list of things the screen is allowed to ask the main
// process to do. Kept in one small file on purpose: this is the whole
// boundary between the user interface and the patient database.

export interface InstallationStatus {
  provisioned: boolean;
  unlocked: boolean;
  dataDir: string;
  dataMode: 'demo' | 'live' | null;
}

export interface RulebookProblemView {
  line: number | null;
  where: string;
  problem: string;
  whatToDo: string;
}

export interface RedFlagStatus {
  /** Where the doctor edits the rules. */
  path: string;
  loaded: boolean;
  ruleCount: number;
  approvedCount: number;
  placeholderCount: number;
  approvedBy: string;
  approvedOn: string;
  checksum: string | null;
  problems: RulebookProblemView[];
  /** Empty means these rules may be used for real patients. */
  blocksLiveUse: Array<{ reason: string; whatToDo: string }>;
}

/** One alert, as the assistant sees it on the tablet. */
export interface RedFlagAlertView {
  eventId: string;
  ruleId: string;
  ruleVersion: string;
  messageBn: string;
  messageEn: string;
  patientName: string | null;
  serialNo: number | null;
}

export interface DatabaseSummary {
  dataMode: 'demo' | 'live';
  createdAt: string | null;
  seededAt: string | null;
  counts: Record<string, number>;
  redFlags: RedFlagStatus;
  recentAudit: Array<{
    id: number; actor_role: string; action: string; entity: string;
    entity_id: string | null; timestamp: string;
  }>;
}

/** How every failure crosses the boundary. Never a raw stack trace. */
export interface FailureReport {
  ok: false;
  userMessage: string;
  whatToDo: string;
  /** For the developer only. Never shown as the primary message. */
  technical: string;
}

export type Result<T> = ({ ok: true } & T) | FailureReport;

export const CHANNELS = {
  status: 'installation:status',
  create: 'installation:create',
  unlock: 'installation:unlock',
  summary: 'database:summary',
  redFlagStatus: 'redflags:status',
  redFlagSample: 'redflags:sample',
  redFlagAcknowledge: 'redflags:acknowledge',
  recallCard: 'recall:card',
  patientSearch: 'patients:search',
  patientRegister: 'patients:register',
  patientMergePreview: 'patients:mergePreview',
  patientMerge: 'patients:merge',
  patientUndoMerge: 'patients:undoMerge',
  queueToday: 'queue:today',
  queueSetChamber: 'queue:setChamber',
  queueRegisterArrival: 'queue:registerArrival',
  queueSetStatus: 'queue:setStatus',
  queueMove: 'queue:move',
} as const;
