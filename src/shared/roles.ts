/**
 * The three roles, fixed. Who may do what is decided by these and
 * nothing else.
 *
 * The important line is between front_desk and the two clinical roles.
 * A front desk user may run the register and take the intake. A front
 * desk user may NOT enter examination findings, vitals, diagnosis,
 * decisions or medications, and this is enforced in the data layer
 * rather than only by hiding buttons.
 *
 * Only a doctor can confirm an encounter. A clinical assistant may type
 * everything in an encounter while the doctor speaks, but the record
 * stays a draft until the doctor confirms it.
 */
export const ROLES = ['doctor', 'clinical_assistant', 'front_desk'] as const;
export type Role = (typeof ROLES)[number];

export function mayEnterClinicalData(role: Role): boolean {
  return role === 'doctor' || role === 'clinical_assistant';
}

export function mayConfirmEncounter(role: Role): boolean {
  return role === 'doctor';
}

export function roleLabel(role: Role): { en: string; bn: string } {
  switch (role) {
    case 'doctor':
      return { en: 'Doctor', bn: 'ডাক্তার' };
    case 'clinical_assistant':
      return { en: 'Clinical assistant', bn: 'সহকারী' };
    case 'front_desk':
      return { en: 'Front desk', bn: 'অভ্যর্থনা' };
  }
}
