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
  /**
   * Somebody at the desk decided this flagged patient is not here, so
   * the desk could call others. The flag, the place and the serial are
   * all unchanged -- this is here so the doctor knows, because what to
   * do about a flagged patient who is not answering is his judgement.
   */
  passedOver: boolean;
  /**
   * Photographs of the paper this patient brought today.
   *
   * Here so that neither screen has to guess: the tablet stops shoving
   * the camera at an assistant who has already taken the pictures, and
   * the doctor can see there is something to look at.
   */
  attachmentCount: number;
  intakeStarted: boolean;
  intakeCompleted: boolean;
  screeningRan: boolean;
  screeningIncomplete: boolean;
}

export interface QueueView {
  /**
   * Who the front desk is calling for right now.
   *
   * Not a reordering -- nobody's serial or place changes, ever. It is
   * the answer to "who is actually walking in next", which stops being
   * "the first person waiting" the moment the desk calls a number and
   * nobody stands up. The doctor needs it at the top of his screen so
   * he knows serial 1 is not coming and serial 2 is.
   */
  upNextVisitId: string | null;
  chamberId: string | null;
  chamberName: string | null;
  visitDate: string;
  chambers: Array<{ id: string; name: string }>;
  entries: QueueEntry[];
  /**
   * What the front desk has sent in and the chamber has not answered.
   *
   * Carried on the ordinary queue read rather than on a channel of its
   * own, so the doctor's screen learns about it on the same poll that
   * refreshes the list -- one round trip, and the two can never
   * disagree about what is happening in the corridor.
   *
   * See src/main/queue/handoff.ts. Nothing in here has changed a visit;
   * every one of them is a question waiting for an answer.
   */
  handoffs: OpenHandoff[];
}

/** One "I have sent them in" from the desk, unanswered. */
export interface OpenHandoff {
  id: string;
  visitId: string;
  serialNo: number;
  nameBn: string | null;
  nameEn: string | null;
  /** 'priority' means a person at the desk asked for this patient to be
   *  seen now, rather than it being the next in the calling order. */
  reason: 'ordinary' | 'priority';
  sentAt: string;
  sentByName: string;
  /** A screening rule fired on this patient. */
  flagged: boolean;
  /** Somebody is already with the doctor. */
  roomBusy: boolean;
}
