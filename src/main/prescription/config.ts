// ===================================================================
// The prescription letterhead.
// ===================================================================
// The printed sheet is the only part of this system that leaves the
// chamber. It may be read by a pharmacist tonight, by another doctor
// next year, or by a hospital in an emergency, and it carries the
// doctor's own name and registration number.
//
// So the same rule as the red flag rules and the consent wording: it
// is a file the doctor edits himself, it ships full of placeholders,
// and the software REFUSES to print against a real database until the
// placeholders are gone. A prescription reading "PLACEHOLDER —
// DOCTOR'S NAME" in a patient's hand would be worse than no
// prescription at all.
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { prescriptionPath } from '../paths';

export interface Bilingual { bn: string; en: string }

export interface ChamberLetterhead {
  name: string;
  address: Bilingual;
  phone: string;
  hours: Bilingual;
}

export interface PrescriptionConfig {
  doctor: {
    name: Bilingual;
    qualifications: string;
    designation: string;
    registration: string;
  };
  chambers: ChamberLetterhead[];
  footer: Bilingual;
  /**
   * Whether the diagnosis and today's readings go on the sheet the
   * patient carries out of the room. The doctor's call: the paper is
   * read by whoever the patient shows it to.
   */
  printDiagnosis: boolean;
  printVitals: boolean;
  paper: 'A5' | 'A4';
}

export interface LetterheadProblem {
  where: string;
  problem: string;
  whatToDo: string;
}

export interface PrescriptionOutcome {
  config: PrescriptionConfig | null;
  problems: LetterheadProblem[];
  /** Reasons this letterhead must not be printed for a real patient. */
  blocksLiveUse: Array<{ reason: string; whatToDo: string }>;
}

function shippedTemplatePath(): string {
  return join(__dirname, '..', '..', '..', 'config', 'prescription.yaml');
}

export function installPrescriptionTemplateIfMissing(dir: string): boolean {
  const target = prescriptionPath(dir);
  if (existsSync(target)) return false;
  copyFileSync(shippedTemplatePath(), target);
  return true;
}

function text(raw: unknown): string | null {
  return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : null;
}

function bilingual(raw: unknown): Bilingual | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const bn = text(value.bn);
  const en = text(value.en);
  return bn === null || en === null ? null : { bn, en };
}

const PLACEHOLDER = /placeholder/i;

/** Everything in the file that still says PLACEHOLDER, with its path. */
function placeholders(config: PrescriptionConfig): string[] {
  const found: string[] = [];
  const check = (where: string, value: string) => {
    if (PLACEHOLDER.test(value)) found.push(where);
  };
  check('the doctor\'s name in Bangla', config.doctor.name.bn);
  check('the doctor\'s name in English', config.doctor.name.en);
  check('the qualifications', config.doctor.qualifications);
  check('the designation', config.doctor.designation);
  check('the BMDC registration number', config.doctor.registration);
  for (const chamber of config.chambers) {
    check(`the address of ${chamber.name}`, chamber.address.bn);
    check(`the address of ${chamber.name} in English`, chamber.address.en);
    check(`the phone number for ${chamber.name}`, chamber.phone);
    check(`the hours for ${chamber.name}`, chamber.hours.bn);
    check(`the hours for ${chamber.name} in English`, chamber.hours.en);
  }
  check('the footer line in Bangla', config.footer.bn);
  check('the footer line in English', config.footer.en);
  return found;
}

export function loadPrescriptionConfig(dir: string): PrescriptionOutcome {
  const path = prescriptionPath(dir);
  const problems: LetterheadProblem[] = [];

  if (!existsSync(path)) {
    return {
      config: null,
      problems: [{
        where: 'the letterhead file',
        problem: 'The prescription letterhead file is missing.',
        whatToDo: `It should be at ${path}. Without it nothing can be printed. Restore it from a backup, or reinstall the software to get a fresh template and fill it in.`,
      }],
      blocksLiveUse: [{
        reason: 'There is no letterhead file, so a printed prescription would have no doctor on it.',
        whatToDo: `Put prescription.yaml back at ${path}.`,
      }],
    };
  }

  let raw: unknown;
  try {
    raw = parse(readFileSync(path, 'utf8'));
  } catch (error) {
    return {
      config: null,
      problems: [{
        where: 'the letterhead file',
        problem: `The letterhead file could not be read: ${(error as Error).message}`,
        whatToDo: 'Something in the file is not laid out correctly. Compare it with the template in config/prescription.yaml and fix the line the message mentions.',
      }],
      blocksLiveUse: [{
        reason: 'The letterhead file cannot be read.',
        whatToDo: 'Fix the file before printing anything.',
      }],
    };
  }

  const root = (raw ?? {}) as Record<string, unknown>;
  const doctorRaw = (root.doctor ?? {}) as Record<string, unknown>;
  const name = bilingual(doctorRaw.name);
  const qualifications = text(doctorRaw.qualifications);
  const registration = text(doctorRaw.registration);

  if (name === null) {
    problems.push({
      where: 'doctor.name', problem: 'The doctor\'s name is missing in one of the two languages.',
      whatToDo: 'Give both "bn" and "en" under doctor.name. Both are printed.',
    });
  }
  if (registration === null) {
    problems.push({
      where: 'doctor.registration', problem: 'The BMDC registration number is missing.',
      whatToDo: 'A prescription in Bangladesh carries the prescriber\'s registration number. Put the real one in doctor.registration.',
    });
  }

  const chambers: ChamberLetterhead[] = [];
  const chambersRaw = Array.isArray(root.chambers) ? root.chambers : [];
  if (chambersRaw.length === 0) {
    problems.push({
      where: 'chambers', problem: 'No chamber addresses are listed.',
      whatToDo: 'Add one entry under "chambers" for each chamber, with the name spelled exactly as it is in the software.',
    });
  }
  for (const entry of chambersRaw) {
    const chamber = (entry ?? {}) as Record<string, unknown>;
    const chamberName = text(chamber.name);
    const address = bilingual(chamber.address);
    if (chamberName === null || address === null) {
      problems.push({
        where: 'chambers', problem: `A chamber entry is missing its name or its address (${String(chamberName ?? 'unnamed')}).`,
        whatToDo: 'Every chamber needs a name and an address in both languages.',
      });
      continue;
    }
    chambers.push({
      name: chamberName,
      address,
      phone: text(chamber.phone) ?? '',
      hours: bilingual(chamber.hours) ?? { bn: '', en: '' },
    });
  }

  const footer = bilingual(root.footer) ?? { bn: '', en: '' };
  const paper = root.paper === 'A4' ? 'A4' : 'A5';

  if (name === null || registration === null || qualifications === null) {
    return {
      config: null,
      problems,
      blocksLiveUse: [{
        reason: 'The letterhead is incomplete, so a printed prescription would be missing part of who prescribed it.',
        whatToDo: 'Fill in the missing lines listed above and press Print again.',
      }],
    };
  }

  const config: PrescriptionConfig = {
    doctor: {
      name,
      qualifications,
      designation: text(doctorRaw.designation) ?? '',
      registration,
    },
    chambers,
    footer,
    printDiagnosis: root.print_diagnosis !== false,
    printVitals: root.print_vitals !== false,
    paper,
  };

  const stillPlaceholder = placeholders(config);
  const blocksLiveUse = stillPlaceholder.length === 0 ? [] : [{
    reason: `The letterhead has not been filled in yet: ${stillPlaceholder.join(', ')} still say PLACEHOLDER.`,
    whatToDo: `Open ${path}, replace every PLACEHOLDER with the real wording, save it, and press Print again. Nothing needs restarting.`,
  }];

  return { config, problems, blocksLiveUse };
}

/**
 * The address block for the chamber this visit happened in.
 *
 * A chamber the letterhead does not know about is not an error worth
 * refusing over - the prescription is still correct without an address
 * - but the caller is told, so the screen can say so.
 */
export function letterheadFor(config: PrescriptionConfig, chamberName: string): ChamberLetterhead | null {
  return config.chambers.find((c) => c.name === chamberName) ?? null;
}
