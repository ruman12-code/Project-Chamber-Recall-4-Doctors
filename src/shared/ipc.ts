// The complete list of things the screen is allowed to ask the main
// process to do. Kept in one small file on purpose: this is the whole
// boundary between the user interface and the patient database.

export interface InstallationStatus {
  provisioned: boolean;
  unlocked: boolean;
  dataDir: string;
  dataMode: 'demo' | 'live' | null;
}

export interface TabletStatus {
  running: boolean;
  port: number | null;
  /** Every address on the chamber network the tablet can be pointed at. */
  addresses: string[];
  pairingCode: string | null;
  pairingLocked: boolean;
  devices: Array<{ id: string; label: string; pairedAt: string; lastSeenAt: string | null }>;
  /** Why the server is not running, in plain language. */
  problem: string | null;
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

export interface SignedInView {
  id: string;
  displayName: string;
  role: string;
  since: string;
}

export interface StaffView {
  id: string;
  displayName: string;
  role: string;
  canSignIn: boolean;
  isActive: boolean;
  lastSignedInAt: string | null;
  /**
   * The PIN, in plain sight, for the invented staff of a PRACTICE
   * database. Null for everybody else and absent entirely from a
   * database that is not marked demo, so this can never carry a real
   * person's PIN anywhere.
   */
  practicePin?: string | null;
}

export interface AuthState {
  /** True when nobody can sign in yet and the setup screen is due. */
  needsSetup: boolean;
  signedIn: SignedInView | null;
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
  tabletStatus: 'tablet:status',
  tabletRevoke: 'tablet:revoke',
  intakeConfirm: 'intake:confirm',
  intakeUnconfirm: 'intake:unconfirm',
  intakeCorrect: 'intake:correct',
  // Milestone 8's "who is at this laptop" setting. Replaced by real
  // sign-in at milestone 9 and kept only so an installation from
  // before then still opens.
  laptopRole: 'laptop:role',
  setLaptopRole: 'laptop:setRole',
  // Signing in.
  whoIsSignedIn: 'auth:who',
  signInList: 'auth:list',
  signIn: 'auth:signIn',
  signOut: 'auth:signOut',
  staffList: 'auth:staff',
  staffAdd: 'auth:staffAdd',
  staffSetPin: 'auth:staffSetPin',
  staffSetActive: 'auth:staffSetActive',
  // The chamber: vitals and the consultation.
  chamberOpen: 'chamber:open',
  chamberView: 'chamber:view',
  vitalsSave: 'chamber:vitals',
  encounterSaveDraft: 'chamber:draft',
  encounterMedications: 'chamber:medications',
  encounterInvestigations: 'chamber:investigations',
  encounterConfirm: 'chamber:confirm',
  encounterUnconfirm: 'chamber:unconfirm',
  // The printed prescription.
  prescriptionView: 'prescription:view',
  prescriptionStatus: 'prescription:status',
  prescriptionPrinted: 'prescription:printed',
  // Photographs of paper.
  attachmentsFor: 'attachments:list',
  attachmentContent: 'attachments:content',
  attachmentAdd: 'attachments:add',
  attachmentRemove: 'attachments:remove',
  // Backups, and a patient's own copy of their record.
  backupStatus: 'backup:status',
  backupNow: 'backup:now',
  backupInspect: 'backup:inspect',
  patientCopyView: 'export:patientCopy',
  patientCopyToFile: 'export:patientCopyFile',
  patientCopyPrinted: 'export:patientCopyPrinted',
  // The pilot report, and the export the research consent was for.
  pilotReport: 'report:pilot',
  researchExport: 'report:research',
  // Filling a practice database with invented people, so there is
  // something to show somebody before a real patient ever exists.
  seedPractice: 'practice:seed',
} as const;

/**
 * What filling the practice database produced, and who can then sign
 * in to it. Only ever returned for a database created in demo mode.
 */
export interface PracticeSeedResult {
  patients: number;
  visits: number;
  encounters: number;
  redFlagsFired: number;
  seconds: number;
  signIns: Array<{ name: string; pin: string }>;
}
