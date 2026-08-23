/**
 * Who the software says did something, before anybody has signed in.
 *
 * These are real rows in app_user with names that tell the truth. They
 * exist because attribution is not optional in this project and the
 * database enforces it, while sign-in does not arrive until the setup
 * wizard at milestone 9.
 *
 * When the wizard runs it creates the real people. Anything recorded
 * before then keeps pointing at one of these, and reads as what it is:
 * done at the front desk, before there was a name to attach.
 */
export const UNASSIGNED_USER = {
  doctor: 'unassigned-doctor',
  clinical_assistant: 'unassigned-clinical-assistant',
  front_desk: 'unassigned-front-desk',
} as const;

export type UnassignedRole = keyof typeof UNASSIGNED_USER;

/** The actor to use for a role while nobody is signed in. */
export function unassignedActor(role: UnassignedRole): { id: string; role: UnassignedRole } {
  return { id: UNASSIGNED_USER[role], role };
}
