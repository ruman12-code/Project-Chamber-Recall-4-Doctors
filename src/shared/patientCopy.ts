// A patient's own copy of everything held about them.
export interface PatientCopyAnswer {
  questionKey: string;
  value: string | null;
  freeText: string | null;
  skipped: boolean;
}

export interface PatientCopyVisit {
  visitDate: string;
  serialNo: number;
  chamberName: string;
  whatTheyTold: PatientCopyAnswer[];
  /** Front desk screening warnings. In the file only, never on the printed sheet. */
  warningsRaised: Array<{ ruleId: string; ruleVersion: string; firedAt: string }>;
  vitals: {
    systolic: number | null; diastolic: number | null; pulse: number | null;
    temperatureC: number | null; weightKg: number | null; heightCm: number | null;
    randomBloodSugar: number | null; spo2: number | null;
  } | null;
  complaint: string | null;
  examination: string | null;
  diagnosis: string | null;
  decision: string | null;
  followUpAfterDays: number | null;
  confirmedByDoctor: boolean;
  medications: Array<{
    drugName: string; strength: string | null; dose: string | null;
    frequency: string | null; durationDays: number | null; instructions: string | null;
  }>;
  investigations: Array<{
    testName: string; orderedDate: string; resultDate: string | null; resultSummary: string | null;
  }>;
}

export interface PatientCopy {
  madeAt: string;
  patient: {
    nameBn: string | null;
    nameEn: string | null;
    phone: string | null;
    sex: string | null;
    dateOfBirth: string | null;
    ageYears: number | null;
    ageIsApproximate: boolean;
    address: string | null;
    firstKnownHere: string;
  };
  visits: PatientCopyVisit[];
  permissions: Array<{ kind: string; decision: string; decidedAt: string; version: string; method: string }>;
  papers: Array<{
    id: string; kind: string; caption: string | null;
    documentDate: string | null; photographedAt: string; fileName: string;
  }>;
}
