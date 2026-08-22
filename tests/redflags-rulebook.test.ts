import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadRulebook } from '../src/main/redflags/rulebook';
import { blocksLiveUse } from '../src/main/redflags/guard';

const SHIPPED = join(__dirname, '..', '..', 'config', 'red_flags.yaml');

function load(yaml: string) {
  return loadRulebook(yaml, '/data/red_flags.yaml');
}

const APPROVED_FILE = `
approved_by: "Dr Test"
approved_on: "2026-09-01"
rules:
  - id: test_rule_one
    version: 2
    status: approved
    message:
      bn: "এখনই ডাক্তারকে জানান।"
      en: "Tell the doctor now."
    when:
      question: severity
      equals: severe
`;

describe('reading the rules file', () => {
  test('a well-formed file loads', () => {
    const { rulebook, problems } = load(APPROVED_FILE);
    assert.deepEqual(problems, []);
    assert.equal(rulebook!.rules.length, 1);
    assert.equal(rulebook!.rules[0]!.id, 'test_rule_one');
    assert.equal(rulebook!.approvedBy, 'Dr Test');
  });

  test('the version is kept as written, as a label rather than a number', () => {
    assert.equal(load(APPROVED_FILE).rulebook!.rules[0]!.version, '2');
  });

  test('the checksum changes when the file changes, and only then', () => {
    const a = load(APPROVED_FILE).rulebook!.checksum;
    const b = load(APPROVED_FILE).rulebook!.checksum;
    const c = load(APPROVED_FILE.replace('severe', 'moderate')).rulebook!.checksum;
    assert.equal(a, b);
    assert.notEqual(a, c);
  });

  describe('a bad file is refused, and the message points at the line', () => {
    test('broken indentation', () => {
      const { rulebook, problems } = load('rules:\n  - id: a\n   version: 1\n');
      assert.equal(rulebook, null);
      assert.equal(problems[0]!.line, 3);
    });

    test('a file with no rules list', () => {
      const { rulebook, problems } = load('approved_by: "Dr Test"\n');
      assert.equal(rulebook, null);
      assert.match(problems[0]!.problem, /no list of rules/i);
    });

    test('an empty rules list is refused, because no rules means no screening', () => {
      const { rulebook, problems } = load('approved_by: x\nrules: []\n');
      assert.equal(rulebook, null);
      assert.match(problems[0]!.whatToDo, /no screening/i);
    });

    test('two rules sharing an id', () => {
      const doubled = APPROVED_FILE + APPROVED_FILE.slice(APPROVED_FILE.indexOf('  - id:'));
      const { rulebook, problems } = load(doubled);
      assert.equal(rulebook, null);
      assert.ok(problems.some((p) => /both have the id/.test(p.problem)));
    });

    test('a rule with no message', () => {
      const { problems } = load(APPROVED_FILE.replace(/    message:[\s\S]*?\n    when:/, '    when:'));
      assert.ok(problems.some((p) => /no message/i.test(p.problem)));
    });

    test('a rule with no version', () => {
      const { problems } = load(APPROVED_FILE.replace('    version: 2\n', ''));
      assert.ok(problems.some((p) => /version/i.test(p.problem)));
    });
  });

  // These two are the important ones. Both mistakes produce a rule that
  // looks fine and can never fire, which is the most dangerous thing
  // this file can contain.
  describe('a mistake that would leave a rule unable to fire is refused outright', () => {
    test('a misspelled comparison word', () => {
      const { rulebook, problems } = load(APPROVED_FILE.replace('equals: severe', 'equal: severe'));
      assert.equal(rulebook, null, 'a rule with a misspelled key must not load');
      assert.match(problems[0]!.problem, /"equal" is not something a condition can use/);
      assert.match(problems[0]!.whatToDo, /equals/);
    });

    test('a question that does not exist', () => {
      const { rulebook, problems } = load(APPROVED_FILE.replace('question: severity', 'question: severty'));
      assert.equal(rulebook, null);
      assert.match(problems[0]!.problem, /no intake question called "severty"/);
      assert.match(problems[0]!.whatToDo, /can never fire/);
    });

    test('a patient fact that does not exist', () => {
      const { rulebook } = load(APPROVED_FILE.replace('      question: severity\n      equals: severe',
        '      patient: blood_group\n      equals: o'));
      assert.equal(rulebook, null);
    });

    test('a condition with nothing to compare against', () => {
      const { rulebook, problems } = load(APPROVED_FILE.replace('      equals: severe\n', ''));
      assert.equal(rulebook, null);
      assert.match(problems[0]!.problem, /does not say what to compare/);
    });

    test('an empty all: list', () => {
      const { rulebook } = load(APPROVED_FILE.replace('      question: severity\n      equals: severe', '      all: []'));
      assert.equal(rulebook, null);
    });
  });
});

describe('the refuse-to-run guard', () => {
  test('the file shipped with the software cannot be used for real patients', () => {
    const { rulebook, problems } = load(readFileSync(SHIPPED, 'utf8'));
    assert.notEqual(rulebook, null, 'the shipped template must still be a valid file');
    const blocks = blocksLiveUse(rulebook, problems);
    assert.ok(blocks.length > 0, 'the shipped placeholder rules must never be usable for real patients');
    assert.ok(blocks.some((b) => /placeholder/i.test(b.reason)));
  });

  test('an approved file with a signature passes', () => {
    const { rulebook, problems } = load(APPROVED_FILE);
    assert.deepEqual(blocksLiveUse(rulebook, problems), []);
  });

  test('an approved file nobody signed is blocked', () => {
    const { rulebook, problems } = load(APPROVED_FILE.replace('approved_by: "Dr Test"', 'approved_by: ""'));
    assert.ok(blocksLiveUse(rulebook, problems).some((b) => /signed off/i.test(b.reason)));
  });

  test('an approved file with no approval date is blocked', () => {
    const { rulebook, problems } = load(APPROVED_FILE.replace('approved_on: "2026-09-01"', 'approved_on: ""'));
    assert.ok(blocksLiveUse(rulebook, problems).some((b) => /when it was approved/i.test(b.reason)));
  });

  test('one placeholder rule among approved ones still blocks everything', () => {
    const mixed = APPROVED_FILE + `
  - id: still_being_written
    version: 1
    status: placeholder
    message:
      bn: "..."
      en: "..."
    when:
      question: severity
      equals: mild
`;
    const { rulebook, problems } = load(mixed);
    const blocks = blocksLiveUse(rulebook, problems);
    assert.ok(blocks.some((b) => /still_being_written/.test(b.reason)));
  });

  test('a rule that is approved but still says PLACEHOLDER in its text is blocked', () => {
    // Someone marking the shipped examples approved without rewriting
    // them is the exact mistake this guard exists to catch.
    const sneaky = APPROVED_FILE.replace('en: "Tell the doctor now."', 'en: "PLACEHOLDER — MUST BE REPLACED"');
    const { rulebook, problems } = load(sneaky);
    assert.ok(blocksLiveUse(rulebook, problems).some((b) => /PLACEHOLDER/.test(b.reason)));
  });

  test('a file that could not be read at all blocks live use', () => {
    const { rulebook, problems } = load('nonsense: [');
    assert.ok(blocksLiveUse(rulebook, problems).length > 0);
  });
});
