// ===================================================================
// The condition language.
// ===================================================================
// ONE deterministic, human-authored condition grammar, used by both
// files a doctor edits by hand:
//
//   red_flags.yaml   decides when to tell the assistant to fetch the
//                    doctor now
//   questions.yaml   decides when a follow-up question is asked
//
// Sharing it is not a tidiness exercise. It means the doctor learns one
// small language rather than two, and it means the part of this system
// that decides things is written once, tested once, and can be read in
// one sitting by whoever takes this project over.
//
// There is no inference anywhere in here. Same answers, same rules,
// same decision, every time, reproducible by hand from the files.
import { KNOWN_PATIENT_FACTS } from './facts';

export type Condition =
  | { kind: 'all'; of: Condition[] }
  | { kind: 'any'; of: Condition[] }
  | { kind: 'answer_equals'; question: string; value: string }
  | { kind: 'answer_in'; question: string; values: string[] }
  | { kind: 'answer_contains'; question: string; needles: string[] }
  | { kind: 'answered'; question: string; expected: boolean }
  | { kind: 'age_at_least'; years: number }
  | { kind: 'age_at_most'; years: number }
  | { kind: 'sex_equals'; value: string };

export const CONDITION_KEYS = new Set([
  'all', 'any', 'question', 'equals', 'in', 'contains_any', 'answered', 'patient', 'at_least', 'at_most',
]);

export type AddProblem = (path: Array<string | number>, where: string, problem: string, whatToDo: string) => void;

/**
 * Turns a condition written in a yaml file into something that can be
 * evaluated, or reports exactly what is wrong with it.
 *
 * Anything unrecognised is rejected outright rather than ignored. A
 * misspelled key or a question that does not exist would otherwise
 * leave a rule that looks fine and can never match, and nothing
 * anywhere would say so.
 */
export function parseCondition(
  raw: unknown,
  path: Array<string | number>,
  ruleName: string,
  add: AddProblem,
  knownQuestionKeys: readonly string[],
  questionsUsed: string[] = [],
): Condition | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    add(path, ruleName, 'This condition is not written correctly.',
      'A condition is either a question and what to compare it to, or an "all:" or "any:" list.');
    return null;
  }
  const node = raw as Record<string, unknown>;
  const unknown = Object.keys(node).filter((k) => !CONDITION_KEYS.has(k));
  if (unknown.length > 0) {
    add(path, ruleName, `"${unknown[0]}" is not something a condition can use.`,
      `Conditions can use: ${[...CONDITION_KEYS].join(', ')}. Check the spelling against the notes at the top of the file.`);
    return null;
  }

  for (const combinator of ['all', 'any'] as const) {
    if (node[combinator] !== undefined) {
      const list = node[combinator];
      if (!Array.isArray(list) || list.length === 0) {
        add([...path, combinator], ruleName, `"${combinator}" must be a list with at least one condition under it.`,
          'Each line under it starts with a dash and a space.');
        return null;
      }
      const parts = list.map((child, i) =>
        parseCondition(child, [...path, combinator, i], ruleName, add, knownQuestionKeys, questionsUsed));
      if (parts.some((p) => p === null)) return null;
      return { kind: combinator, of: parts as Condition[] };
    }
  }

  if (node.patient !== undefined) {
    const fact = node.patient;
    if (fact === 'age_years') {
      if (typeof node.at_least === 'number') return { kind: 'age_at_least', years: node.at_least };
      if (typeof node.at_most === 'number') return { kind: 'age_at_most', years: node.at_most };
      add(path, ruleName, 'An age condition needs "at_least:" or "at_most:" with a number.',
        'For example: patient: age_years, then on the next line at_least: 50');
      return null;
    }
    if (fact === 'sex') {
      if (typeof node.equals === 'string') return { kind: 'sex_equals', value: node.equals.toLowerCase() };
      add(path, ruleName, 'A sex condition needs "equals:" with male, female or other.', 'For example: equals: female');
      return null;
    }
    add([...path, 'patient'], ruleName, `"${String(fact)}" is not something known about a patient.`,
      `You can use: ${KNOWN_PATIENT_FACTS.join(', ')}.`);
    return null;
  }

  if (typeof node.question !== 'string') {
    add(path, ruleName, 'This condition does not say which question it is about.',
      'Add a "question:" line naming one of the intake questions.');
    return null;
  }
  const question = node.question;
  if (!knownQuestionKeys.includes(question)) {
    add([...path, 'question'], ruleName, `There is no intake question called "${question}".`,
      `A rule about a question that does not exist can never fire. The questions available are: ${knownQuestionKeys.join(', ')}.`);
    return null;
  }
  questionsUsed.push(question);

  if (typeof node.equals === 'string') return { kind: 'answer_equals', question, value: node.equals };
  if (Array.isArray(node.in)) {
    const values = node.in.filter((v): v is string => typeof v === 'string');
    if (values.length !== node.in.length || values.length === 0) {
      add([...path, 'in'], ruleName, '"in:" must be a list of answers written as text.', 'For example: in: [chest, abdomen]');
      return null;
    }
    return { kind: 'answer_in', question, values };
  }
  if (Array.isArray(node.contains_any)) {
    const needles = node.contains_any.filter((v): v is string => typeof v === 'string' && v.trim() !== '');
    if (needles.length !== node.contains_any.length || needles.length === 0) {
      add([...path, 'contains_any'], ruleName, '"contains_any:" must be a list of words or phrases.',
        'For example: contains_any: ["blood", "রক্ত"]');
      return null;
    }
    return { kind: 'answer_contains', question, needles };
  }
  if (typeof node.answered === 'boolean') return { kind: 'answered', question, expected: node.answered };

  add(path, ruleName, `The condition about "${question}" does not say what to compare it to.`,
    'Add one of: equals, in, contains_any, or answered.');
  return null;
}
