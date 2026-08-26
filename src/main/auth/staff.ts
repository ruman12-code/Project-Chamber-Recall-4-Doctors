// ===================================================================
// The people who work here.
// ===================================================================
// Three or four people, entered once by the doctor and changed rarely.
// There is no self-registration, no email, no password reset link and
// nothing that reaches the internet, because none of those things
// exist in a chamber.
import type { Db } from '../db/open';
import { newId } from '../db/ids';
import { nowIso } from '../db/clock';
import { recordAudit, type Actor } from '../db/audit';
import { ChamberRecallError } from '../../shared/errors';
import { ROLES, type Role } from '../../shared/roles';
import { checkPin, storedPin } from './pin';

export class StaffError extends ChamberRecallError {}

export interface StaffMember {
  id: string;
  displayName: string;
  role: Role;
  canSignIn: boolean;
  isActive: boolean;
  lastSignedInAt: string | null;
}

/**
 * True when nobody can sign in yet, which is the state a freshly
 * installed program is in. The setup screen is shown until at least
 * one doctor has a PIN, and the program will not record anything
 * clinical before then.
 */
export function needsSetup(db: Db): boolean {
  const row = db.prepare(
    `SELECT count(*) AS n FROM app_user
     WHERE role = 'doctor' AND pin_hash IS NOT NULL AND is_active = 1 AND deleted_at IS NULL`,
  ).get() as { n: number };
  return row.n === 0;
}

/** Everyone who can sign in, for the list on the sign-in screen. */
export function signInList(db: Db): StaffMember[] {
  return rows(db, `WHERE pin_hash IS NOT NULL AND is_active = 1 AND deleted_at IS NULL`);
}

/**
 * Who the TABLET offers to sign in. The front desk, and nobody else.
 *
 * The tablet is the front desk's -- it sits on their counter and it
 * asks patients screening questions. The doctor and the clinical
 * assistant work at the laptop, and offering their names on a screen
 * in a waiting room is three wrong things at once: it invites somebody
 * to sign in as the doctor, it puts the doctor's name in front of
 * every patient who glances at the counter, and it is a list of PINs
 * worth guessing. None of them can open this tablet offline either --
 * see src/main/auth/offlinePin.ts -- so a name that cannot work is
 * being offered as though it could.
 */
export function deskSignInList(db: Db): StaffMember[] {
  return rows(db,
    `WHERE pin_hash IS NOT NULL AND is_active = 1 AND deleted_at IS NULL
       AND role = 'front_desk'`);
}

/** Everyone, including people who cannot sign in yet, for the doctor. */
export function allStaff(db: Db): StaffMember[] {
  // The placeholder users from before sign-in existed are not people
  // and are never listed. They stay in the database because rows point
  // at them and a medical record does not lose its author.
  return rows(db, `WHERE deleted_at IS NULL AND id NOT LIKE 'unassigned-%'`);
}

function rows(db: Db, where: string): StaffMember[] {
  return db.prepare(
    `SELECT id, display_name AS displayName, role, pin_hash AS pinHash, is_active AS isActive,
            last_signed_in_at AS lastSignedInAt
     FROM app_user ${where} ORDER BY CASE role WHEN 'doctor' THEN 0 WHEN 'clinical_assistant' THEN 1 ELSE 2 END, display_name`,
  ).all().map((r) => {
    const row = r as Record<string, unknown>;
    return {
      id: String(row.id),
      displayName: String(row.displayName),
      role: row.role as Role,
      canSignIn: row.pinHash !== null,
      isActive: row.isActive === 1,
      lastSignedInAt: row.lastSignedInAt as string | null,
    };
  });
}

function requireDoctorOrSetup(db: Db, actor: Actor, what: string): void {
  if (needsSetup(db)) return;
  if (actor.role !== 'doctor') {
    throw new StaffError(
      `Only the doctor can ${what}.`,
      'Ask him to sign in and do it. Everything written in this program is recorded against the person who did it, so who can add people has to be one person.',
    );
  }
}

export interface NewStaffInput {
  displayName: string;
  role: Role;
  pin: string;
}

export function addStaff(db: Db, input: NewStaffInput, actor: Actor): string {
  requireDoctorOrSetup(db, actor, 'add somebody');

  const displayName = input.displayName.trim();
  if (displayName === '') {
    throw new StaffError(
      'This person needs a name.',
      'Type the name the way the doctor would say it out loud. It appears on every record they write.',
    );
  }
  if (!ROLES.includes(input.role)) {
    throw new StaffError('That is not one of the three roles.', 'Choose doctor, clinical assistant or front desk.');
  }
  const clash = db.prepare(
    `SELECT id FROM app_user WHERE lower(display_name) = lower(?) AND deleted_at IS NULL`,
  ).get(displayName);
  if (clash !== undefined) {
    throw new StaffError(
      `Somebody called "${displayName}" is already here.`,
      'Two people with the same name on screen is how a record ends up attributed to the wrong one. Add something that tells them apart, such as a second name.',
    );
  }

  checkPin(input.pin);
  const pin = storedPin(input.pin);
  const id = newId();
  const at = nowIso();

  const write = db.transaction(() => {
    db.prepare(
      `INSERT INTO app_user (id, display_name, role, pin_salt, pin_hash, pin_set_at,
                             pin_offline_salt, pin_offline_hash, pin_offline_iterations,
                             is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    ).run(id, displayName, input.role, pin.salt, pin.hash, at,
          pin.offlineSalt, pin.offlineHash, pin.offlineIterations, at);
    recordAudit(db, {
      actor: needsSetup(db) ? { id: null, role: 'system' } : actor,
      action: 'user_created', entity: 'app_user', entityId: id,
      details: { role: input.role, display_name: displayName },
    });
  });
  write();
  return id;
}

/**
 * Changing a PIN. A person may change their own; the doctor may change
 * anybody's, because somebody who has forgotten theirs on a Tuesday
 * evening cannot wait for anything else.
 */
export function setPin(db: Db, userId: string, pin: string, actor: Actor): void {
  if (actor.id !== userId && actor.role !== 'doctor') {
    throw new StaffError(
      'You can only change your own PIN.',
      'Ask the doctor if you need somebody else\'s changed.',
    );
  }
  const user = db.prepare('SELECT id FROM app_user WHERE id = ? AND deleted_at IS NULL').get(userId);
  if (user === undefined) throw new StaffError('That person is not here.', 'Check the list and try again.');

  checkPin(pin);
  const stored = storedPin(pin);
  const write = db.transaction(() => {
    db.prepare(
      `UPDATE app_user
          SET pin_salt = ?, pin_hash = ?, pin_set_at = ?,
              pin_offline_salt = ?, pin_offline_hash = ?, pin_offline_iterations = ?
        WHERE id = ?`,
    ).run(stored.salt, stored.hash, nowIso(),
          stored.offlineSalt, stored.offlineHash, stored.offlineIterations, userId);
    recordAudit(db, {
      actor, action: 'user_pin_changed', entity: 'app_user', entityId: userId,
      details: { by_themselves: actor.id === userId },
    });
  });
  write();
}

/**
 * Somebody who has left.
 *
 * Their account stops working; their name and everything they ever
 * wrote stays exactly where it is. A record does not lose its author
 * because the author found another job.
 */
export function setStaffActive(db: Db, userId: string, active: boolean, actor: Actor): void {
  requireDoctorOrSetup(db, actor, 'remove somebody');
  if (userId === actor.id && !active) {
    throw new StaffError(
      'You cannot switch off your own account.',
      'You would be locked out of your own records. Ask somebody else to do it, or leave it as it is.',
    );
  }
  const user = db.prepare('SELECT role FROM app_user WHERE id = ? AND deleted_at IS NULL').get(userId) as
    { role: Role } | undefined;
  if (user === undefined) throw new StaffError('That person is not here.', 'Check the list and try again.');

  if (!active && user.role === 'doctor') {
    const others = db.prepare(
      `SELECT count(*) AS n FROM app_user
       WHERE role = 'doctor' AND id <> ? AND pin_hash IS NOT NULL AND is_active = 1 AND deleted_at IS NULL`,
    ).get(userId) as { n: number };
    if (others.n === 0) {
      throw new StaffError(
        'This is the only doctor who can sign in.',
        'Switching them off would leave nobody able to confirm a history or a consultation. Add another doctor first.',
      );
    }
  }

  const write = db.transaction(() => {
    db.prepare('UPDATE app_user SET is_active = ? WHERE id = ?').run(active ? 1 : 0, userId);
    recordAudit(db, {
      actor, action: active ? 'user_reactivated' : 'user_deactivated', entity: 'app_user', entityId: userId,
    });
  });
  write();
}
