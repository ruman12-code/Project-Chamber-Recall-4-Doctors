// ===================================================================
// Deciding whether a rule fires.
// ===================================================================
// This is a pure function over plain data. No database, no clock, no
// randomness, no network, and above all no inference of any kind. The
// same answers and the same rules always produce the same decision, and
// that decision can be reproduced by hand from the rules file months
// later.
//
// ---------------------------------------------------------------------
// WHY THERE ARE THREE ANSWERS AND NOT TWO
// ---------------------------------------------------------------------
// Every intake question can be skipped, so a rule often runs without
// the information it needs. There are three possible outcomes, not two:
//
//   true      the rule matched
//   false     the rule ran and did not match
//   unknown   the rule needed an answer that was never given
//
// "unknown" is the important one. If a skipped question were treated as
// "no", then skipping questions would silently switch off the safety
// layer, and nothing anywhere would record that it had happened. That
// is a de-escalation by accident, which this project does not permit.
//
// So unknown propagates: a rule that could not be checked is recorded
// as could_not_check, and the doctor's screen says the screening was
// incomplete and names the questions that were missing.
import type { Rule, Rulebook } from './types';
import type { Condition } from '../rules/conditions';
import { normalise, answerText, type Truth, type Facts, type AnswerFact } from '../rules/facts';

export type { Truth, Facts, AnswerFact };

export type Outcome = 'fired' | 'did_not_fire' | 'could_not_check';

export interface RuleResult {
  ruleId: string;
  ruleVersion: string;
  outcome: Outcome;
  /** Questions this rule needed and did not have. */
  unknownQuestions: string[];
}

export interface RulebookResult {
  results: RuleResult[];
  fired: Rule[];
  /** True when any rule could not be checked. Never hide this. */
  screeningIncomplete: boolean;
  /** Every question that stopped some rule from being checked. */
  missingQuestions: string[];
}

export function evaluateCondition(condition: Condition, facts: Facts, unknownQuestions: Set<string>): Truth {
  switch (condition.kind) {
    case 'all': {
      // False wins over unknown: if one part is definitely false, the
      // whole thing is false whatever the rest are.
      let sawUnknown = false;
      for (const part of condition.of) {
        const truth = evaluateCondition(part, facts, unknownQuestions);
        if (truth === 'false') return 'false';
        if (truth === 'unknown') sawUnknown = true;
      }
      return sawUnknown ? 'unknown' : 'true';
    }
    case 'any': {
      // True wins over unknown, for the same reason in reverse.
      let sawUnknown = false;
      for (const part of condition.of) {
        const truth = evaluateCondition(part, facts, unknownQuestions);
        if (truth === 'true') return 'true';
        if (truth === 'unknown') sawUnknown = true;
      }
      return sawUnknown ? 'unknown' : 'false';
    }
    case 'answered': {
      // This one is never unknown. "Was it answered" can always be
      // decided, because a missing answer IS the answer.
      const fact = facts.answers[condition.question];
      const wasAnswered = fact !== undefined && !fact.skipped && answerText(fact) !== null;
      return wasAnswered === condition.expected ? 'true' : 'false';
    }
    case 'answer_equals':
    case 'answer_in':
    case 'answer_contains': {
      const fact = facts.answers[condition.question];
      const text = fact === undefined || fact.skipped ? null : answerText(fact);
      if (text === null) {
        unknownQuestions.add(condition.question);
        return 'unknown';
      }
      if (condition.kind === 'answer_equals') return text === normalise(condition.value) ? 'true' : 'false';
      if (condition.kind === 'answer_in') {
        return condition.values.some((v) => normalise(v) === text) ? 'true' : 'false';
      }
      return condition.needles.some((n) => text.includes(normalise(n))) ? 'true' : 'false';
    }
    case 'age_at_least':
    case 'age_at_most': {
      const age = facts.patient.ageYears;
      if (age === null) {
        unknownQuestions.add('patient age');
        return 'unknown';
      }
      const matches = condition.kind === 'age_at_least' ? age >= condition.years : age <= condition.years;
      return matches ? 'true' : 'false';
    }
    case 'sex_equals': {
      const sex = facts.patient.sex;
      if (sex === null) {
        unknownQuestions.add('patient sex');
        return 'unknown';
      }
      return normalise(sex) === normalise(condition.value) ? 'true' : 'false';
    }
  }
}

export function evaluateRule(rule: Rule, facts: Facts): RuleResult {
  const unknownQuestions = new Set<string>();
  const truth = evaluateCondition(rule.when, facts, unknownQuestions);
  return {
    ruleId: rule.id,
    ruleVersion: rule.version,
    outcome: truth === 'true' ? 'fired' : truth === 'false' ? 'did_not_fire' : 'could_not_check',
    // Only report missing questions when they actually changed the
    // answer. A rule that came out false anyway was not blocked.
    unknownQuestions: truth === 'unknown' ? [...unknownQuestions].sort() : [],
  };
}

/**
 * Runs EVERY rule, always. No rule is skipped because an earlier one
 * fired: the log has to show what each rule decided, and a patient may
 * match more than one.
 */
export function evaluateRulebook(rulebook: Rulebook, facts: Facts): RulebookResult {
  const results = rulebook.rules.map((rule) => evaluateRule(rule, facts));
  const byId = new Map(rulebook.rules.map((r) => [r.id, r]));
  const missing = new Set<string>();
  for (const result of results) for (const q of result.unknownQuestions) missing.add(q);

  return {
    results,
    fired: results.filter((r) => r.outcome === 'fired').map((r) => byId.get(r.ruleId)!),
    screeningIncomplete: results.some((r) => r.outcome === 'could_not_check'),
    missingQuestions: [...missing].sort(),
  };
}
