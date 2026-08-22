// ===================================================================
// Registering a patient.
// ===================================================================
import type { Db } from '../db/open';
import { newId } from '../db/ids';
import { nowIso, localDate } from '../db/clock';
import { normaliseName, searchablePhone } from '../db/names';
import { recordAudit, type Actor } from '../db/audit';
import { ChamberRecallError } from '../../shared/errors';
import type { RegisterPatientInput } from '../../shared/patients';

export class PatientNotValidError extends ChamberRecallError {
  constructor(problem: string, whatToDo: string) {
    super(problem, whatToDo);
  }
}

/**
 * Almost everything is optional, on purpose.
 *
 * A front desk under queue pressure will abandon a tool that blocks
 * them behind a field the patient cannot answer, and plenty of patients
 * genuinely do not know their date of birth or have no phone. A name is
 * the one thing required, because a register of unnamed people is not a
 * register.
 *
 * An age given as an estimate is stored with today's date attached, so
 * that it can be aged forward later rather than being frozen at
 * whatever it was on the day it was taken.
 */
export function registerPatient(db: Db, input: RegisterPatientInput, actor: Actor): string {
  const nameBn = input.fullNameBn?.trim() ?? null;
  const nameEn = input.fullNameEn?.trim() ?? null;

  if ((nameBn === null || nameBn === '') && (nameEn === null || nameEn === '')) {
    throw new PatientNotValidError(
      'A patient needs a name before they can be registered.',
      'Type the name in Bangla or in English. Either one is enough.',
    );
  }
  if (input.dob !== null && input.approxAgeYears !== null) {
    throw new PatientNotValidError(
      'This patient has both a date of birth and an estimated age.',
      'Keep whichever one is real. If the date of birth is known, use that; otherwise use the estimate.',
    );
  }
  if (input.approxAgeYears !== null && (input.approxAgeYears < 0 || input.approxAgeYears > 130)) {
    throw new PatientNotValidError(
      `An age of ${input.approxAgeYears} years is not possible.`,
      'Check the age and type it again.',
    );
  }

  const id = newId();
  const at = nowIso();
  const phone = input.phone?.trim() ?? null;

  const write = db.transaction(() => {
    db.prepare(
      `INSERT INTO patient (id, full_name_bn, full_name_en, search_name_bn, search_name_en,
         phone, search_phone, dob, approx_age_years, approx_age_recorded_on, sex, address_free_text,
         created_at, created_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id, nameBn === '' ? null : nameBn, nameEn === '' ? null : nameEn,
      normaliseName(nameBn), normaliseName(nameEn),
      phone === '' ? null : phone, searchablePhone(phone),
      input.dob, input.approxAgeYears,
      input.approxAgeYears === null ? null : localDate(),
      input.sex, input.addressFreeText?.trim() ?? null,
      at, actor.id, at,
    );
    recordAudit(db, {
      actor, action: 'patient_registered', entity: 'patient', entityId: id,
      details: { has_phone: phone !== null && phone !== '', age_given_as: input.dob !== null ? 'date_of_birth' : input.approxAgeYears !== null ? 'estimate' : 'not_given' },
    });
  });
  write();
  return id;
}

export interface PatientEdit {
  fullNameBn?: string | null;
  fullNameEn?: string | null;
  phone?: string | null;
  sex?: 'male' | 'female' | 'other' | null;
  addressFreeText?: string | null;
}

/** Corrects details on an existing record. Every change is audited. */
export function updatePatient(db: Db, id: string, edit: PatientEdit, actor: Actor): void {
  const before = db.prepare(
    'SELECT full_name_bn, full_name_en, phone, sex, address_free_text FROM patient WHERE id = ? AND deleted_at IS NULL',
  ).get(id) as Record<string, string | null> | undefined;
  if (before === undefined) throw new Error(`no patient with id ${id}`);

  const changed: Record<string, { from: string | null; to: string | null }> = {};
  const set: string[] = [];
  const values: Array<string | null> = [];

  const apply = (column: string, key: keyof PatientEdit, extraColumn?: string,
                 derive?: (v: string | null) => string | null) => {
    if (!(key in edit)) return;
    const next = (edit[key] as string | null)?.trim() ?? null;
    const value = next === '' ? null : next;
    if (value === before[column]) return;
    changed[column] = { from: before[column] ?? null, to: value };
    set.push(`${column} = ?`);
    values.push(value);
    if (extraColumn !== undefined && derive !== undefined) {
      set.push(`${extraColumn} = ?`);
      values.push(derive(value));
    }
  };

  apply('full_name_bn', 'fullNameBn', 'search_name_bn', normaliseName);
  apply('full_name_en', 'fullNameEn', 'search_name_en', normaliseName);
  apply('phone', 'phone', 'search_phone', searchablePhone);
  apply('sex', 'sex');
  apply('address_free_text', 'addressFreeText');

  if (set.length === 0) return;

  const write = db.transaction(() => {
    db.prepare(`UPDATE patient SET ${set.join(', ')}, updated_at = ? WHERE id = ?`).run(...values, nowIso(), id);
    recordAudit(db, { actor, action: 'patient_updated', entity: 'patient', entityId: id, details: { changed } });
  });
  write();
}
