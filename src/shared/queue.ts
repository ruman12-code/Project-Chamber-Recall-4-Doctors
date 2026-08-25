export type VisitStatus = 'waiting' | 'in_chamber' | 'done' | 'left';

/**
 * Why they came.
 *
 * 'reports_only' is somebody bringing back a test the doctor asked for
 * last time. They are asked nothing about a new complaint, because
 * there isn't one, and a screening full of "nothing" is worse than no
 * screening at all -- it looks the same as one nobody took.
 *
 * It changes what the desk asks and NOTHING else. Not their place in
 * the queue, not the rules, not what the doctor may do.
 */
export type VisitKind = 'consultation' | 'reports_only';

export interface QueueRedFlag {
  ruleId: string;
  ruleVersion: string;
  acknowledgedAt: string | null;
}

export interface QueueEntry {
  visitId: string;
  serialNo: number;
  status: VisitStatus;
  visitKind: VisitKind;
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
  /**
   * The year they say they started coming to this doctor, from before
   * this program existed. Set means "first visit HERE, not first visit
   * ever", and the screen must not say otherwise.
   */
  attendingSince: string | null;
  redFlags: QueueRedFlag[];
  /**
   * Times the front desk called this number out and nobody came.
   *
   * The patient's status, place and serial are untouched by that -- see
   * src/main/queue/noAnswer.ts. This is here so the doctor can see it
   * and decide, which is a decision only he makes.
   */
  calledNoAnswer: number;
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
