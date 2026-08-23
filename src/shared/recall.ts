// The shape of the Recall Card. One screen, assembled once, read-only.

export interface VitalsReading {
  recordedAt: string;
  visitDate: string;
  systolic: number | null;
  diastolic: number | null;
  pulse: number | null;
  temperatureC: number | null;
  weightKg: number | null;
  heightCm: number | null;
  randomBloodSugar: number | null;
  spo2: number | null;
  recordedByName: string | null;
  recordedByRole: string | null;
}

export interface IntakeAnswerView {
  questionKey: string;
  value: string | null;
  freeText: string | null;
  skipped: boolean;
}

export interface IntakeCorrectionView {
  questionKey: string;
  correctedValue: string | null;
  correctedFreeText: string | null;
  markedWrong: boolean;
  correctedByName: string | null;
  correctedAt: string;
}

export interface TodayIntake {
  intakeId: string;
  recordedByName: string | null;
  recordedByRole: string | null;
  startedAt: string;
  completedAt: string | null;
  helperPresent: boolean | null;
  answers: IntakeAnswerView[];
  /** Null until the doctor has accepted this as part of the record. */
  confirmedAt: string | null;
  confirmedByName: string | null;
  corrections: IntakeCorrectionView[];
}

export interface RedFlagView {
  eventId: string;
  ruleId: string;
  ruleVersion: string;
  messageBn: string;
  messageEn: string;
  firedAt: string;
  acknowledgedAt: string | null;
  acknowledgedByName: string | null;
}

export interface ScreeningState {
  /** False when nobody ran the questions at all. */
  ran: boolean;
  incomplete: boolean;
  missingQuestions: string[];
}

export interface MedicationView {
  drugName: string;
  strength: string | null;
  dose: string | null;
  frequency: string | null;
  durationDays: number | null;
  instructions: string | null;
}

export interface LastVisitView {
  visitDate: string;
  chamberName: string;
  chiefComplaint: string | null;
  examinationNotes: string | null;
  workingDiagnosis: string | null;
  decisionNotes: string | null;
  followUpAfterDays: number | null;
  doctorConfirmedAt: string | null;
  medications: MedicationView[];
  investigationsOrdered: string[];
}

export interface OutstandingInvestigation {
  testName: string;
  orderedDate: string;
  chamberName: string;
  daysWaiting: number;
}

export interface TrendPoint { date: string; value: number }
export interface BpPoint { date: string; systolic: number; diastolic: number }

export interface TimelineEntry {
  visitDate: string;
  chamberName: string;
  complaint: string | null;
  diagnosis: string | null;
}

export interface RecurringDiagnosis {
  text: string;
  count: number;
  lastDate: string;
}

export interface ConsentSummary {
  careRecord: string;
  research: string;
  version: string | null;
  decidedAt: string | null;
  /** How the patient was actually told: played to them, or read aloud. */
  method: string | null;
  givenBy: string | null;
}

export interface RecallCard {
  patient: {
    id: string;
    nameBn: string | null;
    nameEn: string | null;
    ageYears: number | null;
    ageIsApproximate: boolean;
    sex: string | null;
    phone: string | null;
  };
  today: {
    visitId: string;
    visitDate: string;
    serialNo: number;
    chamberName: string;
    status: string;
    arrivedAt: string;
    waitedMinutes: number | null;
    redFlags: RedFlagView[];
    screening: ScreeningState;
    intake: TodayIntake | null;
    vitals: VitalsReading | null;
  };
  previousVitals: VitalsReading[];
  lastVisit: LastVisitView | null;
  outstandingInvestigations: OutstandingInvestigation[];
  trend: { bp: BpPoint[]; weight: TrendPoint[]; sugar: TrendPoint[] };
  recurringDiagnoses: RecurringDiagnosis[];
  currentMedications: MedicationView[];
  currentMedicationsFrom: string | null;
  timeline: TimelineEntry[];
  totalVisits: number;
  attachmentCount: number;
  consent: ConsentSummary;
}
