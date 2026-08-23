// What a condition is allowed to know about the patient themselves, as
// opposed to what they answered.
export const KNOWN_PATIENT_FACTS = ['age_years', 'sex'] as const;

export type Truth = 'true' | 'false' | 'unknown';

export interface AnswerFact {
  /** The coded answer, e.g. 'severe'. Null for a free-text question. */
  value: string | null;
  freeText: string | null;
  skipped: boolean;
}

export interface Facts {
  /** Only questions that were actually presented appear here. */
  answers: Record<string, AnswerFact | undefined>;
  patient: { ageYears: number | null; sex: string | null };
}

/** Same normalisation everywhere: NFC, lowercase, collapsed spaces. */
export function normalise(text: string): string {
  return text.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** The text a comparison looks at: the coded answer, else the free text. */
export function answerText(fact: AnswerFact): string | null {
  const raw = fact.value ?? fact.freeText;
  if (raw === null) return null;
  const text = normalise(raw);
  return text === '' ? null : text;
}
