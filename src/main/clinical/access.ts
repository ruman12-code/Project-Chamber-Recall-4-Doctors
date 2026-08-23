// ===================================================================
// Who may see and write what.
// ===================================================================
// The line that matters is between the front desk and the two clinical
// roles, and it is drawn in two places for two different reasons.
//
// WRITING. A front desk user may run the register and take the intake.
// They may not enter vitals, examination findings, a diagnosis, a
// decision or a medicine. This is the brief's rule and it is enforced
// here, in the data layer, rather than only by hiding buttons.
//
// READING. A front desk user does not open the Recall Card. It is a
// consolidated view of somebody's medical history - previous
// diagnoses, medicines, results - assembled for the person treating
// them. The desk needs to know who is here, who is waiting and who is
// next, and they get all of that from the register and the queue. They
// do not need four years of a neighbour's history to give out a serial
// number, and in a chamber where the assistant lives in the same
// neighbourhood as the patients, "does not need" is the whole
// argument.
import { ChamberRecallError } from '../../shared/errors';
import type { Actor } from '../db/audit';
import { mayEnterClinicalData, mayConfirmEncounter } from '../../shared/roles';

export class NotAllowedError extends ChamberRecallError {}

export function requireClinicalRole(actor: Actor, what: string): void {
  if (actor.role === 'system') return;
  if (!mayEnterClinicalData(actor.role)) {
    throw new NotAllowedError(
      `The front desk cannot ${what}.`,
      'This is for the doctor and the clinical assistant. Sign out and let one of them sign in.',
    );
  }
  if (actor.id === null) {
    throw new NotAllowedError(
      'Nobody is signed in, so this cannot be recorded against anyone.',
      'That is a fault in the software rather than anything you did. Report it before carrying on.',
    );
  }
}

export function requireDoctor(actor: Actor, what: string): void {
  if (actor.role === 'system') return;
  if (!mayConfirmEncounter(actor.role)) {
    throw new NotAllowedError(
      `Only the doctor can ${what}.`,
      'A clinical assistant can type everything while the doctor speaks, but it stays a draft until he signs it.',
    );
  }
  if (actor.id === null) {
    throw new NotAllowedError(
      'Nobody is signed in, so this cannot be recorded against anyone.',
      'That is a fault in the software rather than anything you did. Report it before carrying on.',
    );
  }
}
