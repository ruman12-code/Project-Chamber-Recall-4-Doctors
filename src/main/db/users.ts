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

/**
 * Who is at the laptop.
 *
 * This is NOT sign-in. There is no password, nothing is proved, and it
 * is a setting rather than an identity. It exists because some rules in
 * this system are about roles rather than people - only a doctor may
 * confirm a history as his own - and building that rule against an
 * actor who is always the same would be building it as a decoration.
 *
 * The setup wizard at milestone 9 replaces this with real users who
 * sign in. Until then the laptop says which chair it is speaking for,
 * defaults to the doctor because it is the doctor's laptop, and the
 * screen says plainly that it is a setting and not a login.
 */
export function laptopRole(db: import('./open').Db): UnassignedRole {
  const stored = db.prepare(`SELECT value FROM app_meta WHERE key = 'laptop_role'`).get() as { value: string } | undefined;
  const role = stored?.value;
  return role === 'clinical_assistant' || role === 'front_desk' ? role : 'doctor';
}

export function setLaptopRole(db: import('./open').Db, role: UnassignedRole): void {
  db.prepare(
    `INSERT INTO app_meta (key, value, updated_at) VALUES ('laptop_role', ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(role, new Date().toISOString());
}

export function laptopActor(db: import('./open').Db): { id: string; role: UnassignedRole } {
  return unassignedActor(laptopRole(db));
}
