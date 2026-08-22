export interface PatientSearchResult {
  id: string;
  nameBn: string | null;
  nameEn: string | null;
  phone: string | null;
  sex: string | null;
  ageYears: number | null;
  ageIsApproximate: boolean;
  visitCount: number;
  lastVisitDate: string | null;
  lastChamberName: string | null;
  /** Set when this record was folded into another one. */
  mergedIntoPatientId: string | null;
  mergedIntoName: string | null;
}

export interface RegisterPatientInput {
  fullNameBn: string | null;
  fullNameEn: string | null;
  phone: string | null;
  dob: string | null;
  approxAgeYears: number | null;
  sex: 'male' | 'female' | 'other' | null;
  addressFreeText: string | null;
}

export interface MergeComparison {
  field: string;
  label: string;
  surviving: string | null;
  duplicate: string | null;
  /** True when the two records disagree and a human should look. */
  differs: boolean;
}

export interface MergePreview {
  surviving: PatientSearchResult;
  duplicate: PatientSearchResult;
  comparison: MergeComparison[];
  visitsToMove: number;
  attachmentsToMove: number;
  /** Reasons this merge must not happen at all. */
  blockers: string[];
}
