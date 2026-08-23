// ===================================================================
// Loading the question file, and keeping it in step with the rules.
// ===================================================================
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { questionsPath } from '../paths';
import { loadQuestions, questionKeys, type QuestionLoadOutcome, type Questionnaire } from './questions';
import { loadRulebookFromDisk } from '../redflags/store';
import type { LoadOutcome } from '../redflags/rulebook';

function shippedTemplatePath(file: string): string {
  return join(__dirname, '..', '..', '..', 'config', file);
}

/** Puts the question template in the data folder once, and never again. */
export function installQuestionsTemplateIfMissing(dir: string): boolean {
  const target = questionsPath(dir);
  if (existsSync(target)) return false;
  copyFileSync(shippedTemplatePath('questions.yaml'), target);
  return true;
}

export function loadQuestionsFromDisk(dir: string): QuestionLoadOutcome {
  const path = questionsPath(dir);
  if (!existsSync(path)) {
    return {
      questionnaire: null,
      problems: [{
        line: null, where: 'the question file', severity: 'problem',
        problem: 'The intake question file is missing.',
        whatToDo: `It should be at ${path}. Without it the tablet has nothing to ask. Restore it from a backup, or reinstall the software to get a fresh template.`,
      }],
    };
  }
  return loadQuestions(readFileSync(path, 'utf8'), path);
}

export interface ChamberConfig {
  questions: QuestionLoadOutcome;
  rules: LoadOutcome;
}

/**
 * Reads both hand-edited files together, in the right order.
 *
 * The rules are checked against the questions that actually exist, so a
 * rule about a question nobody asks is rejected rather than sitting
 * there unable to fire. Before this, the two lists were maintained
 * separately and could drift apart without anything noticing.
 */
export function loadChamberConfig(dir: string): ChamberConfig {
  const questions = loadQuestionsFromDisk(dir);
  const keys = questions.questionnaire === null ? undefined : questionKeys(questions.questionnaire);
  return { questions, rules: loadRulebookFromDisk(dir, keys) };
}

export type { Questionnaire };
