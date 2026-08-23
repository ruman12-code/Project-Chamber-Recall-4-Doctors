// ===================================================================
// The consent wording, and whether it may be used yet.
// ===================================================================
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { consentPath, consentAudioDir } from '../paths';

export type ConsentKind = 'care_record' | 'research';
export interface Bilingual { bn: string; en: string }

export interface ConsentPart {
  kind: ConsentKind;
  title: Bilingual;
  points: Bilingual[];
  accept: Bilingual;
  decline: Bilingual;
  declinedNote: Bilingual;
  /** Whether a real recording exists for each language. */
  audioAvailable: { bn: boolean; en: boolean };
  audioUrl: { bn: string | null; en: string | null };
}

export interface ConsentConfig {
  version: string;
  approvedBy: string;
  approvedOn: string;
  careRecord: ConsentPart;
  research: ConsentPart;
  checksum: string;
}

export interface ConsentProblem {
  where: string;
  problem: string;
  whatToDo: string;
}

export interface ConsentOutcome {
  config: ConsentConfig | null;
  problems: ConsentProblem[];
  /** Reasons this wording must not be put to a real patient. */
  blocksLiveUse: Array<{ reason: string; whatToDo: string }>;
}

function bilingual(raw: unknown): Bilingual | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.bn !== 'string' || typeof value.en !== 'string') return null;
  if (value.bn.trim() === '' || value.en.trim() === '') return null;
  return { bn: value.bn, en: value.en };
}

function part(
  raw: unknown, kind: ConsentKind, dir: string, problems: ConsentProblem[],
): ConsentPart | null {
  const where = kind === 'care_record' ? 'the permission to keep a history' : 'the research permission';
  if (raw === null || typeof raw !== 'object') {
    problems.push({ where, problem: `The "${kind}" section is missing.`,
      whatToDo: 'Start again from the consent.yaml that came with the software.' });
    return null;
  }
  const node = raw as Record<string, unknown>;
  const title = bilingual(node.title);
  const accept = bilingual(node.accept);
  const decline = bilingual(node.decline);
  const declinedNote = bilingual(node.declined_note);
  const points = Array.isArray(node.points)
    ? node.points.map((p) => bilingual(p)).filter((p): p is Bilingual => p !== null)
    : [];

  for (const [name, value] of [['title', title], ['accept', accept], ['decline', decline], ['declined_note', declinedNote]] as const) {
    if (value === null) {
      problems.push({ where, problem: `"${name}" is missing, or is not written in both languages.`,
        whatToDo: 'Every line a patient is shown needs a bn: and an en: version.' });
    }
  }
  if (points.length === 0) {
    problems.push({ where, problem: 'There is nothing for the patient to be told.',
      whatToDo: 'Add the points explaining what is recorded, who can see it, and what happens if they say no.' });
  }
  if (Array.isArray(node.points) && points.length !== node.points.length) {
    problems.push({ where, problem: 'One of the points is not written in both languages.',
      whatToDo: 'Give every point a bn: and an en: line.' });
  }

  const audio = (node.audio ?? {}) as Record<string, unknown>;
  const audioFor = (language: 'bn' | 'en') => {
    const file = audio[language];
    if (typeof file !== 'string' || file.trim() === '') return { available: false, url: null };
    const name = file.replace(/^audio\//, '');
    return { available: existsSync(join(consentAudioDir(dir), name)), url: `/api/consent/audio/${encodeURIComponent(name)}` };
  };
  const bn = audioFor('bn');
  const en = audioFor('en');

  if (title === null || accept === null || decline === null || declinedNote === null || points.length === 0) return null;

  return {
    kind, title, points, accept, decline, declinedNote,
    audioAvailable: { bn: bn.available, en: en.available },
    audioUrl: { bn: bn.url, en: en.url },
  };
}

export function loadConsentConfig(dir: string): ConsentOutcome {
  const path = consentPath(dir);
  if (!existsSync(path)) {
    return {
      config: null,
      problems: [{ where: 'the consent file', problem: 'The consent wording is missing.',
        whatToDo: `It should be at ${path}. Without it no patient can be asked for permission, so no history can be taken.` }],
      blocksLiveUse: [{ reason: 'There is no consent wording at all.',
        whatToDo: 'Restore consent.yaml, or reinstall the software to get a fresh draft and have it approved again.' }],
    };
  }

  const source = readFileSync(path, 'utf8');
  const problems: ConsentProblem[] = [];
  let raw: Record<string, unknown>;
  try {
    raw = parse(source) as Record<string, unknown>;
  } catch (error) {
    const problem = { where: 'the consent file', problem: (error as Error).message.split('\n')[0] ?? 'It could not be read.',
      whatToDo: 'This is usually spacing. Every line inside a section must be indented by the same amount.' };
    return { config: null, problems: [problem],
      blocksLiveUse: [{ reason: 'The consent wording could not be read.', whatToDo: problem.whatToDo }] };
  }

  const version = typeof raw.version === 'string' ? raw.version.trim() : '';
  const approvedBy = typeof raw.approved_by === 'string' ? raw.approved_by.trim() : '';
  const approvedOn = typeof raw.approved_on === 'string' ? String(raw.approved_on).trim() : '';
  if (version === '') {
    problems.push({ where: 'the consent file', problem: 'The wording has no version.',
      whatToDo: 'Give it a version line. A patient\'s consent is recorded against the version they were actually given.' });
  }

  const careRecord = part(raw.care_record, 'care_record', dir, problems);
  const research = part(raw.research, 'research', dir, problems);

  const blocksLiveUse: ConsentOutcome['blocksLiveUse'] = [];
  if (problems.length > 0) {
    blocksLiveUse.push({ reason: `The consent wording has ${problems.length} problem${problems.length === 1 ? '' : 's'}.`,
      whatToDo: 'Fix them in consent.yaml. Until it can be read, no history can be taken from anybody.' });
  }
  if (approvedBy === '') {
    blocksLiveUse.push({
      reason: 'Nobody has approved the consent wording.',
      whatToDo: 'This tells patients what happens to their medical history, and health information is sensitive personal data under the Personal Data Protection Act. It needs the supervising physician AND a lawyer in Bangladesh to read it. When they have, write the name on the approved_by line.',
    });
  }
  if (approvedOn === '') {
    blocksLiveUse.push({ reason: 'The consent wording does not say when it was approved.',
      whatToDo: 'Write the date on the approved_on line, for example 2026-09-01.' });
  }
  if (/draft|placeholder/i.test(version)) {
    blocksLiveUse.push({ reason: `The version is still marked as a draft ("${version}").`,
      whatToDo: 'Once the wording is agreed, give it a version that is not a draft.' });
  }

  if (careRecord === null || research === null) return { config: null, problems, blocksLiveUse };

  return {
    config: {
      version, approvedBy, approvedOn, careRecord, research,
      checksum: createHash('sha256').update(source, 'utf8').digest('hex').slice(0, 16),
    },
    problems,
    blocksLiveUse,
  };
}

function shippedTemplatePath(file: string): string {
  return join(__dirname, '..', '..', '..', 'config', file);
}

/** Written once, never overwritten, like the other hand-edited files. */
export function installConsentTemplateIfMissing(dir: string): boolean {
  mkdirSync(consentAudioDir(dir), { recursive: true });
  const target = consentPath(dir);
  if (existsSync(target)) return false;
  copyFileSync(shippedTemplatePath('consent.yaml'), target);
  return true;
}
