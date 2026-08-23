// ===================================================================
// Deciding what to ask next.
// ===================================================================
// Deliberately free of anything that only exists on the laptop: no file
// reading, no database, no node modules. The tablet runs this exact
// code, so that the next question appears instantly under a thumb and
// keeps appearing when the wifi drops.
import { evaluateCondition } from '../redflags/evaluate';
import type { Condition } from '../rules/conditions';
import type { Facts, Truth } from '../rules/facts';

export type QuestionType = 'free_text' | 'choice' | 'scale';

export interface Bilingual { bn: string; en: string }
export interface QuestionOption { value: string; label: Bilingual }

export interface Question {
  key: string;
  type: QuestionType;
  prompt: Bilingual;
  help: Bilingual | null;
  options: QuestionOption[];
  style: string | null;
  askWhen: Condition | null;
}

export interface Questionnaire {
  questions: Question[];
  checksum: string;
  sourcePath: string;
}

export function evaluateConditionForBranching(condition: Condition, facts: Facts): Truth {
  return evaluateCondition(condition, facts, new Set<string>());
}

/**
 * The next question to put on the screen, or null when there are none
 * left. Deterministic: the same answers always lead to the same
 * question, and the order is the order in the file.
 *
 * A question whose ask_when cannot be decided - because the answer it
 * depends on was skipped - is NOT asked. Skipping a question therefore
 * also skips whatever hangs off it, which is what an assistant expects:
 * they skipped it because it did not apply.
 */
export function nextQuestion(
  questionnaire: Questionnaire, facts: Facts, alreadyPresented: readonly string[],
): Question | null {
  for (const question of questionnaire.questions) {
    if (alreadyPresented.includes(question.key)) continue;
    if (question.askWhen !== null && evaluateConditionForBranching(question.askWhen, facts) !== 'true') continue;
    return question;
  }
  return null;
}

/**
 * How many questions this patient will be asked in total, given what
 * they have said so far. Only for showing progress, and recomputed as
 * answers change because branching moves the finish line.
 */
export function expectedQuestionCount(questionnaire: Questionnaire, facts: Facts): number {
  return questionnaire.questions.filter(
    (q) => q.askWhen === null || evaluateConditionForBranching(q.askWhen, facts) === 'true',
  ).length;
}

/** Turns stored answers into the shape conditions are evaluated against. */
export function factsFromAnswers(
  answers: Record<string, { value: string | null; freeText: string | null; skipped: boolean } | undefined>,
  patient: { ageYears: number | null; sex: string | null },
): Facts {
  return { answers, patient };
}
