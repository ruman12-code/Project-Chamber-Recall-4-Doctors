// ===================================================================
// The question file.
// ===================================================================
// What the tablet asks, in what order, in whose words. Editable by a
// doctor without a programmer, like red_flags.yaml, and checked just as
// strictly - a question that can never be asked is as bad as a rule
// that can never fire.
import { createHash } from 'node:crypto';
import { parseDocument, type Document } from 'yaml';
import { parseCondition, type Condition } from '../rules/conditions';
import type { Question, QuestionOption, Questionnaire, Bilingual } from './flow';

export type { Question, QuestionOption, Questionnaire, Bilingual };
export { nextQuestion, expectedQuestionCount } from './flow';

export interface QuestionProblem {
  line: number | null;
  where: string;
  problem: string;
  whatToDo: string;
  /** Warnings do not stop the file loading; problems do. */
  severity: 'problem' | 'warning';
}

export interface QuestionLoadOutcome {
  questionnaire: Questionnaire | null;
  problems: QuestionProblem[];
}

/**
 * Questions that must never be asked at a front desk, by key.
 *
 * The brief is explicit about these, and the reasoning is worth keeping
 * next to the list: a tablet at a desk is overheard. Asked there, these
 * questions get an answer that is a lie, or they are overheard and the
 * patient is humiliated. Both are worse than not asking. They belong in
 * the doctor's own section, behind a door.
 */
const RESERVED_KEYS = [
  'menstrual', 'menstruation', 'lmp', 'period', 'periods',
  'pregnancy', 'pregnant', 'contraception',
  'sexual_health', 'sexual', 'sti', 'std',
  'mental_health', 'depression', 'anxiety', 'suicide', 'self_harm',
  'alcohol', 'drugs', 'substance_use', 'smoking_illicit',
  'domestic', 'domestic_violence', 'abuse',
];

/** Words that suggest a private question has been written anyway. */
const PRIVATE_WORDS = [
  'pregnan', 'menstru', 'period ', 'last period', 'contracepti',
  'sexual', 'sexually', 'alcohol', 'drinking', 'drug use', 'depress',
  'anxiet', 'suicid', 'self harm', 'beaten', 'violence at home',
  'গর্ভ', 'মাসিক', 'ঋতু', 'যৌন', 'মদ', 'নেশা', 'আত্মহত্যা', 'বিষণ্ন', 'নির্যাতন',
];

function lineAt(source: string, offset: number | undefined): number | null {
  if (offset === undefined) return null;
  return source.slice(0, offset).split('\n').length;
}

function lineOfPath(doc: Document, source: string, path: Array<string | number>): number | null {
  try {
    const node = doc.getIn(path, true) as { range?: [number, number, number] } | undefined;
    return lineAt(source, node?.range?.[0]);
  } catch {
    return null;
  }
}

function bilingual(raw: unknown): Bilingual | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.bn !== 'string' || typeof value.en !== 'string') return null;
  if (value.bn.trim() === '' || value.en.trim() === '') return null;
  return { bn: value.bn, en: value.en };
}

export function loadQuestions(source: string, sourcePath: string): QuestionLoadOutcome {
  const problems: QuestionProblem[] = [];
  const doc = parseDocument(source);

  for (const error of doc.errors) {
    problems.push({
      line: error.linePos?.[0]?.line ?? lineAt(source, error.pos?.[0]),
      where: 'the file itself',
      problem: error.message.split('\n')[0] ?? error.message,
      whatToDo: 'This is usually spacing. Every line inside a question must be indented by the same amount, and lists start with a dash and a space.',
      severity: 'problem',
    });
  }
  if (problems.length > 0) return { questionnaire: null, problems };

  const raw = doc.toJS() as Record<string, unknown> | null;
  const list = raw === null ? undefined : raw.questions;
  if (!Array.isArray(list)) {
    return {
      questionnaire: null,
      problems: [{ line: 1, where: 'questions', problem: 'There is no list of questions in this file.',
        whatToDo: 'The file needs a line reading "questions:" with at least one question underneath it.',
        severity: 'problem' }],
    };
  }

  const add = (path: Array<string | number>, where: string, problem: string, whatToDo: string,
               severity: 'problem' | 'warning' = 'problem') =>
    problems.push({ line: lineOfPath(doc, source, path), where, problem, whatToDo, severity });

  const questions: Question[] = [];
  const seen = new Set<string>();

  list.forEach((entry: unknown, index: number) => {
    const at = (field: string) => ['questions', index, field];
    const label = `question ${index + 1}`;
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      add(['questions', index], label, 'This question is not written as a set of settings.',
        'A question needs key, type and prompt, each on its own line.');
      return;
    }
    const q = entry as Record<string, unknown>;
    const name = typeof q.key === 'string' ? q.key : label;

    // ---- key
    if (typeof q.key !== 'string' || !/^[a-z0-9_]+$/.test(q.key)) {
      add(at('key'), label, 'This question has no key, or the key uses characters that are not allowed.',
        'Give it a short name in lowercase with underscores, for example: presenting_complaint.');
    } else if (seen.has(q.key)) {
      add(at('key'), name, `Two questions both have the key "${q.key}".`,
        'Every question needs its own key, because answers are stored under it. Rename one of them.');
    } else if (RESERVED_KEYS.includes(q.key)) {
      add(at('key'), name, `"${q.key}" cannot be asked at the front desk.`,
        'This tablet is used where other patients can hear. Questions about menstruation, pregnancy, sexual health, mental health, alcohol or drugs, or trouble at home belong in the doctor\'s own section, not here. The doctor\'s screen already says "private history not taken - ask directly".');
    } else {
      seen.add(q.key);
    }

    // ---- type
    const type = q.type;
    if (type !== 'free_text' && type !== 'choice' && type !== 'scale') {
      add(at('type'), name, `"${String(type)}" is not a kind of question.`,
        'Use free_text for something written out, choice for a list of answers, or scale for the three-point one.');
    }

    // ---- prompt and help
    const prompt = bilingual(q.prompt);
    if (prompt === null) {
      add(at('prompt'), name, 'This question has no prompt in both languages.',
        'Add a prompt with a bn: line and an en: line underneath it. The assistant may be reading in either.');
    }
    const help = q.help === undefined ? null : bilingual(q.help);
    if (q.help !== undefined && help === null) {
      add(at('help'), name, 'The help line is not written in both languages.',
        'Give it a bn: line and an en: line, or remove it.');
    }

    // ---- options
    const options: QuestionOption[] = [];
    if (type === 'choice' || type === 'scale') {
      if (!Array.isArray(q.options) || q.options.length === 0) {
        add(at('options'), name, 'This question offers no answers to choose from.',
          'Add an options: list, each with a value and a label in both languages.');
      } else {
        q.options.forEach((option: unknown, oi: number) => {
          const o = option as Record<string, unknown> | null;
          const optionLabel = o === null ? null : bilingual(o.label);
          if (o === null || typeof o.value !== 'string' || o.value.trim() === '' || optionLabel === null) {
            add(['questions', index, 'options', oi], name, `Answer ${oi + 1} needs a value and a label in both languages.`,
              'For example: { value: chest, label: { bn: "বুক", en: "Chest" } }');
            return;
          }
          options.push({ value: o.value, label: optionLabel });
        });
        if (type === 'scale' && q.options.length !== 3) {
          add(at('options'), name, `A scale must offer exactly three answers, and this one offers ${q.options.length}.`,
            'Three is the whole point: it can be answered without thinking, and it can never be mistaken for a score.');
        }
      }
    }

    // ---- ask_when: may only refer to a question asked EARLIER
    let askWhen: Condition | null = null;
    if (q.ask_when !== undefined) {
      const earlier = [...seen].filter((k) => k !== q.key);
      askWhen = parseCondition(q.ask_when, ['questions', index, 'ask_when'], name,
        (path, where, problem, whatToDo) => add(path, where, problem, whatToDo), earlier);
      if (askWhen === null && earlier.length > 0) {
        // parseCondition already reported why.
      }
    }

    // ---- private topics written anyway
    const text = `${prompt?.bn ?? ''} ${prompt?.en ?? ''} ${help?.bn ?? ''} ${help?.en ?? ''}`.toLowerCase();
    const matched = PRIVATE_WORDS.find((word) => text.includes(word));
    if (matched !== undefined) {
      add(at('prompt'), name, `This question looks like it asks about something private ("${matched}").`,
        'A tablet at a front desk is overheard. If this really is about menstruation, pregnancy, sexual health, mental health, alcohol or drugs, or trouble at home, move it to the doctor\'s own section. If it is not, ignore this warning.',
        'warning');
    }

    if (typeof q.key === 'string' && prompt !== null &&
        (type === 'free_text' || type === 'choice' || type === 'scale')) {
      questions.push({
        key: q.key, type, prompt, help,
        options,
        style: typeof q.style === 'string' ? q.style : null,
        askWhen,
      });
    }
  });

  if (list.length === 0) {
    add(['questions'], 'questions', 'The question list is empty.',
      'The tablet would have nothing to ask. Add at least one question.');
  }

  if (problems.some((p) => p.severity === 'problem')) return { questionnaire: null, problems };

  return {
    questionnaire: {
      questions,
      checksum: createHash('sha256').update(source, 'utf8').digest('hex').slice(0, 16),
      sourcePath,
    },
    problems,
  };
}

export function questionKeys(questionnaire: Questionnaire): string[] {
  return questionnaire.questions.map((q) => q.key);
}
