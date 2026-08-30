// What goes on the printed sheet. Assembled once, then rendered.
import type { MedicationInput } from './clinical';

export interface PrescriptionLetterhead {
  doctorNameBn: string;
  doctorNameEn: string;
  qualifications: string;
  designation: string;
  registration: string;
  chamberName: string;
  addressBn: string;
  addressEn: string;
  phone: string;
  hoursBn: string;
  hoursEn: string;
  footerBn: string;
  footerEn: string;
  /** Null when the letterhead has no entry for this chamber. */
  addressKnown: boolean;
  paper: 'A5' | 'A4';
}

export interface PrescriptionView {
  letterhead: PrescriptionLetterhead;
  patient: {
    nameBn: string | null;
    nameEn: string | null;
    ageYears: number | null;
    ageIsApproximate: boolean;
    sex: string | null;
  };
  visitDate: string;
  serialNo: number;
  /** Blank when the doctor has chosen not to print it. */
  diagnosis: string | null;
  /** The readings taken today, as a short line. Empty when none. */
  vitalsLine: string;
  medications: MedicationInput[];
  investigations: string[];
  advice: string | null;
  followUpAfterDays: number | null;
  /** Worked out from the visit date. Arithmetic, not advice. */
  followUpDate: string | null;
  confirmedAt: string;
  confirmedByName: string | null;
  timesPrinted: number;
  /**
   * The two visits before this one, for a doctor who is not this one.
   *
   * The sheet is the only thing that leaves the chamber. A patient who
   * walks into a hospital at midnight has this in their hand and
   * nothing else, and "what has he been on" is the first question
   * anybody asks. So the last two visits go on it: what was prescribed
   * and what was advised, both in the doctor's own words, typed by him
   * at the time.
   *
   * NOT A PRESCRIPTION. It is printed below the signature, inside a
   * box that says so, because a pharmacist reading quickly must never
   * dispense last month's medicines off this month's sheet.
   *
   * Only CONFIRMED consultations appear. An unsigned draft is not
   * something to hand anybody.
   */
  previousVisits: PreviousVisit[];
}

export interface PreviousVisit {
  visitDate: string;
  chamberName: string;
  medications: MedicationInput[];
  /** The doctor's own wording. Never summarised, never shortened. */
  advice: string | null;
  investigations: string[];
}

export interface PrescriptionStatus {
  /** Reasons a real prescription must not be printed yet. */
  blocksLiveUse: Array<{ reason: string; whatToDo: string }>;
  problems: Array<{ where: string; problem: string; whatToDo: string }>;
  path: string;
  demo: boolean;
}
