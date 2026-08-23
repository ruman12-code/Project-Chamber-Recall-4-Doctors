// The shapes the chamber screen sends and receives. Shared so the
// renderer and the main process cannot drift apart silently.
import type { TemperatureUnit } from '../main/vitals/temperature';

export interface TypedTemperature {
  /** Exactly what was typed, in whichever scale was chosen. */
  typed: number;
  unit: TemperatureUnit;
}

export interface VitalsInput {
  systolic: number | null;
  diastolic: number | null;
  pulse: number | null;
  temperature: TypedTemperature | null;
  weightKg: number | null;
  heightCm: number | null;
  randomBloodSugar: number | null;
  spo2: number | null;
  notes: string | null;
}

/**
 * Something worth a second look before it is saved. Never a diagnosis
 * and never a refusal: the value is stored either way.
 */
export interface VitalsQuestion {
  field: string;
  question: string;
}

export interface VitalsView extends VitalsInput {
  id: string | null;
  recordedByName: string | null;
  recordedAt: string | null;
  temperatureC: number | null;
}

export interface MedicationInput {
  drugName: string;
  strength: string | null;
  dose: string | null;
  frequency: string | null;
  durationDays: number | null;
  instructions: string | null;
}

export interface EncounterDraft {
  chiefComplaint: string | null;
  examinationNotes: string | null;
  workingDiagnosis: string | null;
  decisionNotes: string | null;
  followUpAfterDays: number | null;
}

export interface EncounterView extends EncounterDraft {
  id: string;
  visitId: string;
  enteredByName: string | null;
  confirmedAt: string | null;
  confirmedByName: string | null;
  medications: MedicationInput[];
  investigations: string[];
  updatedAt: string;
}

/** Everything the chamber screen needs in one read. */
export interface ChamberView {
  visitId: string;
  patientName: string;
  patientNameAlt: string | null;
  ageYears: number | null;
  ageIsApproximate: boolean;
  sex: string | null;
  serialNo: number;
  chamberName: string;
  visitDate: string;
  vitals: VitalsView;
  encounter: EncounterView;
  /** The last visit's diagnosis and medicines, so nothing is retyped blind. */
  previousDiagnosis: string | null;
  previousMedications: MedicationInput[];
  previousVisitDate: string | null;
}
