// What a backup is, as the screens see it.
export interface BackupManifest {
  what: string;
  takenAt: string;
  takenBy: string | null;
  dataMode: string;
  schemaVersion: number;
  counts: Record<string, number>;
  databaseBytes: number;
  databaseSha256: string;
  files: string[];
  /** Whether the copy was opened and checked at the time it was made. */
  verified: boolean;
}

export interface BackupResult {
  folder: string;
  manifest: BackupManifest;
}

export interface BackupStatus {
  lastBackupAt: string | null;
  lastBackupPath: string | null;
  lastBackupOk: boolean;
  daysSince: number | null;
  /** How loudly the screen should say something about it. */
  urgency: 'never' | 'fine' | 'due' | 'overdue';
}

export interface BackupInspection {
  folder: string;
  manifest: BackupManifest | null;
  /** Whether the records file is still byte for byte what was written. */
  databaseIntact: boolean | null;
  missingFiles: string[];
  problems: string[];
}
