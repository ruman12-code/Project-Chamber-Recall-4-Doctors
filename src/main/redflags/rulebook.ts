// ===================================================================
// Loading and checking the red flag rules.
// ===================================================================
// The rules live in a file a doctor edits by hand. That means two
// things drive every decision in here:
//
//   1. Every problem must point at a line number and say what to do.
//      An error message a doctor cannot act on is a file he will stop
//      editing, and then the safety layer stops being maintained.
//
//   2. A typo must NEVER produce a rule that silently cannot fire.
//      If a rule says `equal:` instead of `equals:`, or names a
//      question that does not exist, this file rejects the whole
//      rulebook rather than loading a rule that will never match. A
//      rule that quietly never fires is the single most dangerous
//      object this project can contain.
import { createHash } from 'node:crypto';
import { parseDocument, type Document } from 'yaml';
import { parseCondition, type Condition } from '../rules/conditions';
import { KNOWN_PATIENT_FACTS } from '../rules/facts';

export type { Condition };
export { KNOWN_PATIENT_FACTS };

/**
 * The questions a rule is allowed to refer to now come from
 * questions.yaml - the same file the tablet asks from - and are passed
 * in by the caller. Because both come from one file they cannot drift
 * apart, which is what the comment here used to warn about.
 *
 * This list is the fallback used when no question file is supplied.
 */
export const KNOWN_QUESTION_KEYS = [
  'presenting_complaint',
  'body_region',
  'duration',
  'severity',
  'medicines_already_taken',
  'known_conditions',
  'allergies',
  'most_worried_about',
  'hoping_for',
] as const;

import type { Rule, Rulebook } from './types';
export type { Rule, Rulebook };

export interface RulebookProblem {
  /** 1-based line in the rules file, when it can be located. */
  line: number | null;
  where: string;
  problem: string;
  whatToDo: string;
}

export interface LoadOutcome {
  rulebook: Rulebook | null;
  problems: RulebookProblem[];
}

/** Turns a character offset into a line number for the error message. */
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

export function loadRulebook(
  source: string, sourcePath: string, questionKeys: readonly string[] = KNOWN_QUESTION_KEYS,
): LoadOutcome {
  const problems: RulebookProblem[] = [];
  const doc = parseDocument(source);

  for (const error of doc.errors) {
    problems.push({
      line: error.linePos?.[0]?.line ?? lineAt(source, error.pos?.[0]),
      where: 'the file itself',
      problem: error.message.split('\n')[0] ?? error.message,
      whatToDo: 'This is usually spacing. Every line inside a rule must be indented by the same amount, and lists start with a dash and a space.',
    });
  }
  if (problems.length > 0) return { rulebook: null, problems };

  const raw = doc.toJS() as Record<string, unknown> | null;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      rulebook: null,
      problems: [{ line: 1, where: 'the file itself', problem: 'The rules file is empty or is not laid out as a list of settings.',
        whatToDo: 'Start again from the copy of red_flags.yaml that came with the software.' }],
    };
  }

  const add = (path: Array<string | number>, where: string, problem: string, whatToDo: string) =>
    problems.push({ line: lineOfPath(doc, source, path), where, problem, whatToDo });

  const rulesRaw = raw.rules;
  if (!Array.isArray(rulesRaw)) {
    add(['rules'], 'rules', 'There is no list of rules in this file.',
      'The file needs a line reading "rules:" followed by at least one rule underneath it.');
    return { rulebook: null, problems };
  }

  const rules: Rule[] = [];
  const seenIds = new Set<string>();

  rulesRaw.forEach((entry: unknown, index: number) => {
    const at = (field: string) => ['rules', index, field];
    const label = `rule ${index + 1}`;

    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      add(['rules', index], label, 'This rule is not written as a set of settings.',
        'A rule needs id, version, status, message and when, each on its own line.');
      return;
    }
    const rule = entry as Record<string, unknown>;
    const name = typeof rule.id === 'string' ? rule.id : label;

    // ---- id
    if (typeof rule.id !== 'string' || rule.id.trim() === '') {
      add(at('id'), label, 'This rule has no id.', 'Give it a short name in lowercase with underscores, for example: severe_bleeding.');
    } else if (!/^[a-z0-9_]+$/.test(rule.id)) {
      add(at('id'), name, `The id "${rule.id}" uses characters that are not allowed.`,
        'Use only lowercase letters, numbers and underscores.');
    } else if (seenIds.has(rule.id)) {
      add(at('id'), name, `Two rules both have the id "${rule.id}".`,
        'Every rule needs its own id, because past records refer to rules by id. Rename one of them.');
    } else {
      seenIds.add(rule.id);
    }

    // ---- version
    if (typeof rule.version !== 'number' || !Number.isInteger(rule.version) || rule.version < 1) {
      add(at('version'), name, 'This rule has no version number, or it is not a whole number of 1 or more.',
        'Write "version: 1" for a new rule, and increase it by one every time you change what the rule does.');
    }

    // ---- status
    if (rule.status !== 'placeholder' && rule.status !== 'approved') {
      add(at('status'), name, 'This rule does not say whether it is approved.',
        'Write "status: placeholder" while you are still working on it, or "status: approved" once a doctor has approved it.');
    }

    // ---- message
    const message = rule.message as Record<string, unknown> | undefined;
    if (message === undefined || typeof message !== 'object' || message === null) {
      add(at('message'), name, 'This rule has no message for the assistant.',
        'Add a message with a bn: line and an en: line underneath it.');
    } else {
      for (const lang of ['bn', 'en'] as const) {
        if (typeof message[lang] !== 'string' || (message[lang] as string).trim() === '') {
          add(['rules', index, 'message', lang], name,
            `This rule has no ${lang === 'bn' ? 'Bangla' : 'English'} message.`,
            'The assistant may be reading in either language, so both are required.');
        }
      }
    }

    // ---- when
    const questionsUsed: string[] = [];
    let when: Condition | null = null;
    if (rule.when === undefined) {
      add(at('when'), name, 'This rule has no condition, so there is nothing for it to check.',
        'Add a "when:" section describing when this rule should fire.');
    } else {
      when = parseCondition(rule.when, ['rules', index, 'when'], name, add, questionKeys, questionsUsed);
    }

    if (typeof rule.id === 'string' && when !== null && typeof rule.version === 'number' &&
        (rule.status === 'placeholder' || rule.status === 'approved') &&
        typeof message?.bn === 'string' && typeof message?.en === 'string') {
      rules.push({
        id: rule.id,
        // Stored as text: a version is a label on a record, never a
        // number anything does arithmetic with.
        version: String(rule.version),
        status: rule.status,
        message: { bn: message.bn as string, en: message.en as string },
        when,
        questionsUsed: [...new Set(questionsUsed)],
      });
    }
  });

  if (rulesRaw.length === 0) {
    add(['rules'], 'rules', 'The rules list is empty.',
      'A chamber with no red flag rules has no screening at all. Add the rules a doctor has approved.');
  }

  if (problems.length > 0) return { rulebook: null, problems };

  return {
    rulebook: {
      approvedBy: typeof raw.approved_by === 'string' ? raw.approved_by.trim() : '',
      approvedOn: typeof raw.approved_on === 'string' ? String(raw.approved_on).trim() : '',
      rules,
      checksum: createHash('sha256').update(source, 'utf8').digest('hex').slice(0, 16),
      sourcePath,
    },
    problems: [],
  };
}
