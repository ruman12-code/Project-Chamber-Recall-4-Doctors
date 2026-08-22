// The complete list of things the screen is allowed to ask the main
// process to do. Kept in one small file on purpose: this is the whole
// boundary between the user interface and the patient database.

export interface InstallationStatus {
  provisioned: boolean;
  unlocked: boolean;
  dataDir: string;
  dataMode: 'demo' | 'live' | null;
}

export interface DatabaseSummary {
  dataMode: 'demo' | 'live';
  createdAt: string | null;
  seededAt: string | null;
  counts: Record<string, number>;
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
} as const;
