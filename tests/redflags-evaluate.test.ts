import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadRulebook } from '../src/main/redflags/rulebook';
import { evaluateRulebook, type Facts } from '../src/main/redflags/evaluate';
import { patientAgeYears } from '../src/main/db/age';

function rulebookOf(when: string) {
  const yaml = `
approved_by: "Dr Test"
approved_on: "2026-09-01"
rules:
  - id: rule_under_test
    version: 1
    status: approved
    message: { bn: "এখনই ডাক্তারকে জানান।", en: "Tell the doctor now." }
    when:
${when.split('\n').map((l) => (l.trim() === '' ? l : `      ${l}`)).join('\n')}
`;
  const { rulebook, problems } = loadRulebook(yaml, 'test.yaml');
  assert.deepEqual(problems, [], `fixture did not load: ${JSON.stringify(problems)}`);
  return rulebook!;
}

function facts(answers: Record<string, { value?: string; freeText?: string; skipped?: boolean }>,
               patient: { ageYears?: number | null; sex?: string | null } = {}): Facts {
  const built: Facts['answers'] = {};
  for (const [k, v] of Object.entries(answers)) {
    built[k] = { value: v.value ?? null, freeText: v.freeText ?? null, skipped: v.skipped ?? false };
  }
  return { answers: built, patient: { ageYears: patient.ageYears ?? null, sex: patient.sex ?? null } };
}

const outcomeOf = (when: string, f: Facts) => evaluateRulebook(rulebookOf(when), f).results[0]!.outcome;

describe('matching a single answer', () => {
  const when = 'question: severity\nequals: severe';

  test('fires on an exact match', () => {
    assert.equal(outcomeOf(when, facts({ severity: { value: 'severe' } })), 'fired');
  });
  test('does not fire on a different answer', () => {
    assert.equal(outcomeOf(when, facts({ severity: { value: 'mild' } })), 'did_not_fire');
  });
  test('ignores capital letters and stray spaces', () => {
    assert.equal(outcomeOf(when, facts({ severity: { value: '  SEVERE ' } })), 'fired');
  });
  test('falls back to free text when there is no coded answer', () => {
    assert.equal(outcomeOf(when, facts({ severity: { freeText: 'severe' } })), 'fired');
  });
});

describe('matching words inside free text', () => {
  const when = 'question: presenting_complaint\ncontains_any: ["blood", "রক্ত"]';

  test('finds an English word inside a sentence', () => {
    assert.equal(outcomeOf(when, facts({ presenting_complaint: { freeText: 'coughing up blood since Friday' } })), 'fired');
  });
  test('finds a Bangla word inside a Bangla sentence', () => {
    assert.equal(outcomeOf(when, facts({ presenting_complaint: { freeText: 'কাশির সাথে রক্ত যাচ্ছে' } })), 'fired');
  });
  test('does not fire when none of the words appear', () => {
    assert.equal(outcomeOf(when, facts({ presenting_complaint: { freeText: 'headache for two days' } })), 'did_not_fire');
  });
  test('matches the same Bangla text however it was typed', () => {
    // The same visible word can arrive as different code points from
    // different keyboards. Both must match the same rule.
    const composed = 'রক্ত'.normalize('NFC');
    const decomposed = 'রক্ত'.normalize('NFD');
    assert.equal(outcomeOf(when, facts({ presenting_complaint: { freeText: composed } })), 'fired');
    assert.equal(outcomeOf(when, facts({ presenting_complaint: { freeText: decomposed } })), 'fired');
  });
});

// =====================================================================
// The part that matters most.
// =====================================================================
describe('a question the patient did not answer never quietly means "no"', () => {
  const when = 'question: severity\nequals: severe';

  test('a skipped question makes the rule unable to be checked', () => {
    assert.equal(outcomeOf(when, facts({ severity: { value: 'severe', skipped: true } })), 'could_not_check');
  });
  test('a question never asked at all makes the rule unable to be checked', () => {
    assert.equal(outcomeOf(when, facts({})), 'could_not_check');
  });
  test('an empty answer makes the rule unable to be checked', () => {
    assert.equal(outcomeOf(when, facts({ severity: { freeText: '   ' } })), 'could_not_check');
  });
  test('the missing question is named, so the doctor can be told what is missing', () => {
    const result = evaluateRulebook(rulebookOf(when), facts({}));
    assert.equal(result.screeningIncomplete, true);
    assert.deepEqual(result.missingQuestions, ['severity']);
  });
  test('a rule that could not be checked never counts as fired', () => {
    const result = evaluateRulebook(rulebookOf(when), facts({}));
    assert.equal(result.fired.length, 0);
  });
});

describe('combining conditions with all', () => {
  const when = 'all:\n  - question: body_region\n    equals: chest\n  - question: severity\n    equals: severe';

  test('fires only when every part matches', () => {
    assert.equal(outcomeOf(when, facts({ body_region: { value: 'chest' }, severity: { value: 'severe' } })), 'fired');
  });
  test('does not fire when one part does not match', () => {
    assert.equal(outcomeOf(when, facts({ body_region: { value: 'leg' }, severity: { value: 'severe' } })), 'did_not_fire');
  });

  test('one part definitely false settles it, even with another part unknown', () => {
    // The rule could not have fired whatever the missing answer was, so
    // there is nothing incomplete to report.
    const result = evaluateRulebook(rulebookOf(when), facts({ body_region: { value: 'leg' } }));
    assert.equal(result.results[0]!.outcome, 'did_not_fire');
    assert.equal(result.screeningIncomplete, false);
  });

  test('a part that matches plus a part unknown is reported as unable to check', () => {
    // This is the dangerous case: treating the missing answer as "no"
    // would silently cancel a warning that might have been correct.
    const result = evaluateRulebook(rulebookOf(when), facts({ body_region: { value: 'chest' } }));
    assert.equal(result.results[0]!.outcome, 'could_not_check');
    assert.deepEqual(result.results[0]!.unknownQuestions, ['severity']);
  });
});

describe('combining conditions with any', () => {
  const when = 'any:\n  - question: body_region\n    equals: chest\n  - question: severity\n    equals: severe';

  test('fires when one part matches', () => {
    assert.equal(outcomeOf(when, facts({ body_region: { value: 'chest' }, severity: { value: 'mild' } })), 'fired');
  });
  test('one part definitely true settles it, even with another part unknown', () => {
    const result = evaluateRulebook(rulebookOf(when), facts({ body_region: { value: 'chest' } }));
    assert.equal(result.results[0]!.outcome, 'fired');
    assert.equal(result.screeningIncomplete, false);
  });
  test('no part matching plus a part unknown is reported as unable to check', () => {
    assert.equal(outcomeOf(when, facts({ body_region: { value: 'leg' } })), 'could_not_check');
  });
  test('every part definitely false does not fire', () => {
    assert.equal(outcomeOf(when, facts({ body_region: { value: 'leg' }, severity: { value: 'mild' } })), 'did_not_fire');
  });
});

describe('asking whether a question was answered at all', () => {
  const when = 'question: allergies\nanswered: false';

  // This one can always be decided, because a missing answer IS the
  // answer to "was it answered".
  test('is true when the question was skipped', () => {
    assert.equal(outcomeOf(when, facts({ allergies: { value: 'x', skipped: true } })), 'fired');
  });
  test('is true when the question was never asked', () => {
    assert.equal(outcomeOf(when, facts({})), 'fired');
  });
  test('is false when the question was answered', () => {
    assert.equal(outcomeOf(when, facts({ allergies: { freeText: 'penicillin' } })), 'did_not_fire');
  });
  test('is never reported as unable to check', () => {
    assert.notEqual(outcomeOf(when, facts({})), 'could_not_check');
  });
});

describe('conditions about the patient', () => {
  test('age at least', () => {
    const when = 'patient: age_years\nat_least: 65';
    assert.equal(outcomeOf(when, facts({}, { ageYears: 70 })), 'fired');
    assert.equal(outcomeOf(when, facts({}, { ageYears: 65 })), 'fired');
    assert.equal(outcomeOf(when, facts({}, { ageYears: 64 })), 'did_not_fire');
  });
  test('age at most', () => {
    const when = 'patient: age_years\nat_most: 2';
    assert.equal(outcomeOf(when, facts({}, { ageYears: 1 })), 'fired');
    assert.equal(outcomeOf(when, facts({}, { ageYears: 3 })), 'did_not_fire');
  });
  test('an unknown age cannot be checked', () => {
    const result = evaluateRulebook(rulebookOf('patient: age_years\nat_least: 65'), facts({}, { ageYears: null }));
    assert.equal(result.results[0]!.outcome, 'could_not_check');
    assert.deepEqual(result.missingQuestions, ['patient age']);
  });
  test('sex', () => {
    const when = 'patient: sex\nequals: female';
    assert.equal(outcomeOf(when, facts({}, { sex: 'female' })), 'fired');
    assert.equal(outcomeOf(when, facts({}, { sex: 'male' })), 'did_not_fire');
    assert.equal(outcomeOf(when, facts({}, { sex: null })), 'could_not_check');
  });
});

describe('every rule runs, every time', () => {
  const twoRules = `
approved_by: "Dr Test"
approved_on: "2026-09-01"
rules:
  - id: rule_a
    version: 1
    status: approved
    message: { bn: "ক", en: "A" }
    when: { question: severity, equals: severe }
  - id: rule_b
    version: 3
    status: approved
    message: { bn: "খ", en: "B" }
    when: { question: body_region, equals: chest }
`;

  test('a rule is not skipped because an earlier one already fired', () => {
    const { rulebook } = loadRulebook(twoRules, 'test.yaml');
    const result = evaluateRulebook(rulebook!, facts({ severity: { value: 'severe' }, body_region: { value: 'chest' } }));
    assert.equal(result.results.length, 2);
    assert.equal(result.fired.length, 2, 'a patient can match more than one rule and all of them must be recorded');
  });

  test('each result carries the version of the rule that produced it', () => {
    const { rulebook } = loadRulebook(twoRules, 'test.yaml');
    const result = evaluateRulebook(rulebook!, facts({ severity: { value: 'severe' }, body_region: { value: 'chest' } }));
    assert.deepEqual(result.results.map((r) => [r.ruleId, r.ruleVersion]), [['rule_a', '1'], ['rule_b', '3']]);
  });

  test('the same answers always give the same decision', () => {
    const { rulebook } = loadRulebook(twoRules, 'test.yaml');
    const f = facts({ severity: { value: 'severe' } });
    const runs = [0, 1, 2].map(() => JSON.stringify(evaluateRulebook(rulebook!, f).results));
    assert.equal(new Set(runs).size, 1);
  });
});

describe('working out a patient age', () => {
  const asOf = new Date('2026-08-22T00:00:00Z');

  test('from a date of birth', () => {
    assert.equal(patientAgeYears({ dob: '1980-08-21', approx_age_years: null, approx_age_recorded_on: null }, asOf), 46);
    assert.equal(patientAgeYears({ dob: '1980-08-23', approx_age_years: null, approx_age_recorded_on: null }, asOf), 45);
  });

  test('an estimate is aged forward from the day it was given', () => {
    // The quiet mistake this prevents: a patient recorded as 45 three
    // years ago still reading as 45 today.
    assert.equal(patientAgeYears({ dob: null, approx_age_years: 45, approx_age_recorded_on: '2023-08-22' }, asOf), 48);
  });

  test('an estimate taken today is used as given', () => {
    assert.equal(patientAgeYears({ dob: null, approx_age_years: 45, approx_age_recorded_on: '2026-08-22' }, asOf), 45);
  });

  test('no age information gives no age, rather than a guess', () => {
    assert.equal(patientAgeYears({ dob: null, approx_age_years: null, approx_age_recorded_on: null }, asOf), null);
  });
});
