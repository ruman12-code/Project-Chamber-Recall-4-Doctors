import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadQuestions, nextQuestion, expectedQuestionCount, questionKeys } from '../src/main/intake/questions';
import { loadRulebook } from '../src/main/redflags/rulebook';
import type { Facts } from '../src/main/rules/facts';

const SHIPPED = join(__dirname, '..', '..', 'config', 'questions.yaml');

const load = (yaml: string) => loadQuestions(yaml, '/data/questions.yaml');
const problemsOnly = (o: ReturnType<typeof load>) => o.problems.filter((p) => p.severity === 'problem');

const SIMPLE = `
questions:
  - key: presenting_complaint
    type: free_text
    prompt: { bn: "কী সমস্যা?", en: "What is the problem?" }
  - key: severity
    type: scale
    prompt: { bn: "কতটা কষ্ট?", en: "How bad?" }
    options:
      - { value: mild,     label: { bn: "অল্প",     en: "A little" } }
      - { value: moderate, label: { bn: "মাঝারি",   en: "In between" } }
      - { value: severe,   label: { bn: "খুব বেশি", en: "A great deal" } }
  - key: severe_details
    type: free_text
    ask_when: { question: severity, equals: severe }
    prompt: { bn: "আর কিছু?", en: "Anything else?" }
`;

function facts(answers: Record<string, { value?: string; freeText?: string; skipped?: boolean }>): Facts {
  const built: Facts['answers'] = {};
  for (const [k, v] of Object.entries(answers)) {
    built[k] = { value: v.value ?? null, freeText: v.freeText ?? null, skipped: v.skipped ?? false };
  }
  return { answers: built, patient: { ageYears: 40, sex: 'male' } };
}

describe('the question file as shipped', () => {
  const outcome = load(readFileSync(SHIPPED, 'utf8'));

  test('loads without problems', () => {
    assert.deepEqual(problemsOnly(outcome), []);
    assert.ok(outcome.questionnaire!.questions.length >= 10);
  });

  test('asks the two questions this whole interface exists for', () => {
    const keys = questionKeys(outcome.questionnaire!);
    assert.ok(keys.includes('most_worried_about'));
    assert.ok(keys.includes('hoping_for'));
  });

  test('asks what the patient already took, and asks it neutrally', () => {
    const question = outcome.questionnaire!.questions.find((q) => q.key === 'medicines_already_taken')!;
    const values = question.options.map((o) => o.value);
    assert.ok(values.includes('from_pharmacy'), 'buying without a prescription must be an ordinary option');
    assert.ok(values.includes('brought_strip'));
    assert.ok(values.includes('dont_know'));
    // Nothing in the wording should sound like a telling-off.
    const text = `${question.prompt.bn} ${question.prompt.en}`.toLowerCase();
    for (const word of ['should', 'without a prescription', 'wrongly', 'improper']) {
      assert.equal(text.includes(word), false, `"${word}" makes this sound like a telling-off`);
    }
  });

  test('every question has both languages', () => {
    for (const question of outcome.questionnaire!.questions) {
      assert.ok(question.prompt.bn.trim() !== '', `${question.key} has no Bangla`);
      assert.ok(question.prompt.en.trim() !== '', `${question.key} has no English`);
    }
  });

  test('the severity question is a three-point scale and shows no number', () => {
    const question = outcome.questionnaire!.questions.find((q) => q.key === 'severity')!;
    assert.equal(question.type, 'scale');
    assert.equal(question.options.length, 3);
    for (const option of question.options) {
      assert.equal(/\d/.test(option.label.bn + option.label.en), false, 'a scale must never show a number');
    }
  });

  test('the red flag rules only mention questions this file actually asks', () => {
    // The two files used to keep separate lists, which could drift apart
    // without anything noticing. Now the rules are checked against the
    // questions that exist.
    const rules = readFileSync(join(__dirname, '..', '..', 'config', 'red_flags.yaml'), 'utf8');
    const { rulebook, problems } = loadRulebook(rules, 'red_flags.yaml', questionKeys(outcome.questionnaire!));
    assert.deepEqual(problems, []);
    assert.ok(rulebook!.rules.length > 0);
  });
});

describe('checking a question file', () => {
  test('a question with no prompt in both languages is refused', () => {
    const { problems } = load(`questions:\n  - key: a\n    type: free_text\n    prompt: { en: "Only English" }\n`);
    assert.ok(problems.some((p) => /both languages/.test(p.problem)));
  });

  test('two questions with the same key are refused', () => {
    const { questionnaire, problems } = load(SIMPLE + `
  - key: severity
    type: free_text
    prompt: { bn: "আবার", en: "Again" }
`);
    assert.equal(questionnaire, null);
    assert.ok(problems.some((p) => /both have the key/.test(p.problem)));
  });

  test('a scale with the wrong number of answers is refused', () => {
    const { questionnaire, problems } = load(`
questions:
  - key: severity
    type: scale
    prompt: { bn: "ক", en: "A" }
    options:
      - { value: a, label: { bn: "১", en: "A" } }
      - { value: b, label: { bn: "২", en: "B" } }
`);
    assert.equal(questionnaire, null);
    assert.ok(problems.some((p) => /exactly three/.test(p.problem)));
  });

  test('a branch on a question asked LATER is refused', () => {
    // It could never be true when it was evaluated, so the question
    // would silently never be asked and nothing would say why.
    const { questionnaire, problems } = load(`
questions:
  - key: first
    type: free_text
    ask_when: { question: second, equals: yes }
    prompt: { bn: "ক", en: "A" }
  - key: second
    type: free_text
    prompt: { bn: "খ", en: "B" }
`);
    assert.equal(questionnaire, null);
    assert.ok(problems.some((p) => /no intake question called "second"/.test(p.problem)));
  });

  test('broken indentation is reported with a line number', () => {
    const { questionnaire, problems } = load('questions:\n  - key: a\n   type: free_text\n');
    assert.equal(questionnaire, null);
    assert.equal(problems[0]!.line, 3);
  });
});

describe('questions that must never be asked at a front desk', () => {
  // A tablet at a desk is overheard. Asked there, these get an answer
  // that is a lie, or the patient is humiliated in front of a room.
  for (const key of ['pregnancy', 'menstrual', 'alcohol', 'domestic_violence', 'mental_health']) {
    test(`a question keyed "${key}" is refused outright`, () => {
      const { questionnaire, problems } = load(`
questions:
  - key: ${key}
    type: free_text
    prompt: { bn: "প্রশ্ন", en: "A question" }
`);
      assert.equal(questionnaire, null);
      assert.ok(problems.some((p) => /cannot be asked at the front desk/.test(p.problem)));
    });
  }

  test('the refusal says where the question does belong', () => {
    const { problems } = load(`questions:\n  - key: pregnancy\n    type: free_text\n    prompt: { bn: "ক", en: "A" }\n`);
    const refusal = problems.find((p) => /cannot be asked/.test(p.problem))!;
    assert.match(refusal.whatToDo, /doctor's own section/);
  });

  test('a private question written under an innocent key is warned about, not silently allowed', () => {
    const { questionnaire, problems } = load(`
questions:
  - key: q17
    type: free_text
    prompt: { bn: "আপনি কি গর্ভবতী?", en: "Are you pregnant?" }
`);
    const warning = problems.find((p) => p.severity === 'warning');
    assert.ok(warning, 'no warning was raised');
    assert.match(warning!.problem, /something private/);
    // A warning does not block the file: the words could be innocent in
    // another question, and refusing on a guess would be worse.
    assert.notEqual(questionnaire, null);
  });
});

describe('deciding what to ask next', () => {
  const questionnaire = load(SIMPLE).questionnaire!;

  test('the first question comes first', () => {
    assert.equal(nextQuestion(questionnaire, facts({}), [])!.key, 'presenting_complaint');
  });

  test('questions already put on screen are not repeated', () => {
    assert.equal(nextQuestion(questionnaire, facts({}), ['presenting_complaint'])!.key, 'severity');
  });

  test('a follow-up is asked when its condition is met', () => {
    const answered = facts({ severity: { value: 'severe' } });
    assert.equal(nextQuestion(questionnaire, answered, ['presenting_complaint', 'severity'])!.key, 'severe_details');
  });

  test('and is not asked when it is not', () => {
    const answered = facts({ severity: { value: 'mild' } });
    assert.equal(nextQuestion(questionnaire, answered, ['presenting_complaint', 'severity']), null);
  });

  test('skipping a question also skips what hangs off it', () => {
    // The assistant skipped it because it did not apply, so asking the
    // follow-up anyway would be the software arguing with them.
    const answered = facts({ severity: { value: 'severe', skipped: true } });
    assert.equal(nextQuestion(questionnaire, answered, ['presenting_complaint', 'severity']), null);
  });

  test('the end of the questions is the end, not a loop', () => {
    assert.equal(nextQuestion(questionnaire, facts({}), ['presenting_complaint', 'severity', 'severe_details']), null);
  });

  test('the same answers always lead to the same question', () => {
    const answered = facts({ severity: { value: 'severe' } });
    const runs = [0, 1, 2].map(() => nextQuestion(questionnaire, answered, ['presenting_complaint', 'severity'])!.key);
    assert.equal(new Set(runs).size, 1);
  });

  test('how many questions are left changes as the branch opens', () => {
    assert.equal(expectedQuestionCount(questionnaire, facts({ severity: { value: 'mild' } })), 2);
    assert.equal(expectedQuestionCount(questionnaire, facts({ severity: { value: 'severe' } })), 3);
  });
});

describe('an installation made before the question file existed', () => {
  test('gets the shipped questions when it is opened', async () => {
    // Found the hard way: the template was only written when creating a
    // new installation, so an older one opened with the tablet having
    // nothing at all to ask.
    const { tempDir } = await import('./helpers');
    const { provision, openWithPassphrase } = await import('../src/main/db/provision');
    const { questionsPath } = await import('../src/main/paths');
    const { loadQuestionsFromDisk } = await import('../src/main/intake/store');
    const { rmSync, existsSync, writeFileSync, readFileSync } = await import('node:fs');

    const t = tempDir();
    provision(t.dir, 'passphrase', 'demo').db.close();
    rmSync(questionsPath(t.dir));
    assert.equal(existsSync(questionsPath(t.dir)), false);

    openWithPassphrase(t.dir, 'passphrase').close();
    assert.equal(existsSync(questionsPath(t.dir)), true);
    assert.ok(loadQuestionsFromDisk(t.dir).questionnaire);

    // And a doctor's own questions are never overwritten by reopening.
    const mine = readFileSync(questionsPath(t.dir), 'utf8') + '\n# my own note\n';
    writeFileSync(questionsPath(t.dir), mine, 'utf8');
    openWithPassphrase(t.dir, 'passphrase').close();
    assert.equal(readFileSync(questionsPath(t.dir), 'utf8'), mine);

    t.cleanup();
  });
});
