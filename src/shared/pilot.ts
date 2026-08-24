// The pilot report: the screen that decides whether this carries on.
export interface Counted {
  /** How many, out of how many. Both, always. */
  n: number;
  of: number;
}

export interface PerPerson {
  userId: string;
  name: string;
  role: string;
  intakesStarted: number;
  intakesFinished: number;
  questionsSkipped: number;
  questionsAsked: number;
  medianMinutes: number | null;
}

export interface PilotReport {
  madeAt: string;
  dataMode: string;
  /** Null when nothing has happened yet. */
  firstDay: string | null;
  lastDay: string | null;
  eveningsHeld: number;
  chambers: string[];

  patientsSeen: number;
  visits: number;
  newPatients: number;
  returningVisits: number;

  screening: {
    arrivals: number;
    intakesStarted: number;
    intakesFinished: number;
    perPerson: PerPerson[];
  };

  waiting: {
    medianMinutes: number | null;
    longestMinutes: number | null;
    counted: number;
  };

  safety: {
    flagsFired: number;
    visitsFlagged: number;
    acknowledgedAtTheDesk: number;
    movedUpTheQueue: number;
    /** The number that matters most. */
    flaggedLeftUnseen: number;
    screeningIncomplete: number;
  };

  record: {
    encountersWritten: number;
    encountersConfirmed: number;
    intakesConfirmedByDoctor: number;
    answersCorrectedByDoctor: number;
    prescriptionsPrinted: number;
    prescriptionsReprinted: number;
    papersPhotographed: number;
    patientsWithTwoOrMoreVisits: number;
  };

  consent: {
    asked: number;
    given: number;
    declined: number;
    withdrawn: number;
    researchGiven: number;
    neverAsked: number;
  };

  backups: {
    taken: number;
    verified: number;
    longestGapDays: number | null;
    daysSinceLast: number | null;
  };

  /** The honest section. Everything here is a thing that did not work. */
  gaps: Array<{ what: string; count: number; why: string }>;
}
