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
  /**
   * The year they say they started coming to this doctor, when it is
   * before this program existed. Null for somebody genuinely new.
   *
   * This is not a back-fill of their history -- the paper stays paper.
   * It exists so the software stops printing "first visit" against a
   * woman the doctor has been treating since 2019, which is a clinical
   * statement and is simply false.
   */
  attendingSince?: string | null;
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
