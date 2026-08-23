export type VisitStatus = 'waiting' | 'in_chamber' | 'done' | 'left';

export interface QueueRedFlag {
  ruleId: string;
  ruleVersion: string;
  acknowledgedAt: string | null;
}

export interface QueueEntry {
  visitId: string;
  serialNo: number;
  status: VisitStatus;
  patientId: string;
  nameBn: string | null;
  nameEn: string | null;
  ageYears: number | null;
  ageIsApproximate: boolean;
  sex: string | null;
  phone: string | null;
  arrivedAt: string;
  seenAt: string | null;
  /** Minutes from arrival to being called in, or to now if still waiting. */
  waitedMinutes: number;
  /** Visits before today. Zero means this is their first time. */
  previousVisits: number;
  lastVisitDate: string | null;
  redFlags: QueueRedFlag[];
  intakeStarted: boolean;
  intakeCompleted: boolean;
  screeningRan: boolean;
  screeningIncomplete: boolean;
}

export interface QueueView {
  chamberId: string | null;
  chamberName: string | null;
  visitDate: string;
  chambers: Array<{ id: string; name: string }>;
  entries: QueueEntry[];
}
