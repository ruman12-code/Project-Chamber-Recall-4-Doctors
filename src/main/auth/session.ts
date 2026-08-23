// ===================================================================
// Who is signed in at this laptop.
// ===================================================================
// This replaces the role setting from milestone 8. That said which
// chair the laptop was speaking for; this says which person, and asks
// them to prove it with a PIN.
//
// The session lives in memory in the main process and nowhere else.
// Closing the program signs everybody out, which is the behaviour a
// chamber wants at the end of an evening.
//
// There is no automatic sign-out on a timer, deliberately. A screen
// that logs the doctor out mid-consultation, with a patient in front
// of him and half an examination typed, is a screen that gets worked
// around within a week - the PIN written on the desk, or the sign-out
// button avoided. The laptop is in the doctor's own room and the
// database is already encrypted; the thing being protected here is the
// truth of "who wrote this", and a timer does not help it.
import type { Db } from '../db/open';
import { nowIso } from '../db/clock';
import { recordAudit, type Actor } from '../db/audit';
import { ChamberRecallError } from '../../shared/errors';
import type { Role } from '../../shared/roles';
import { verifyPin } from './pin';

/**
 * A sign-in refusal, with a Bangla version.
 *
 * The tablet is Bangla first. A refusal that arrives in English on a
 * screen where every other word is Bangla is a refusal the person
 * reading it may not be able to act on, and this one is read by the
 * assistant at the desk rather than by the doctor.
 */
export class SignInError extends ChamberRecallError {
  readonly bn: { userMessage: string; whatToDo: string };
  constructor(userMessage: string, whatToDo: string, bn: { userMessage: string; whatToDo: string }) {
    super(userMessage, whatToDo);
    this.bn = bn;
  }
}

export interface SignedIn {
  id: string;
  displayName: string;
  role: Role;
  since: string;
}

/**
 * Wrong PINs, per user, in this process only.
 *
 * Not a security boundary - restarting the program clears it - but it
 * stops somebody standing at the desk working through four-digit
 * numbers while the assistant is out of the room.
 */
const LOCKOUT = { attempts: 5, seconds: 60 } as const;
const failures = new Map<string, { count: number; until: number }>();

export function signIn(db: Db, userId: string, pin: string, at: string = nowIso()): SignedIn {
  const blocked = failures.get(userId);
  if (blocked !== undefined && blocked.until > Date.now()) {
    const seconds = Math.ceil((blocked.until - Date.now()) / 1000);
    throw new SignInError(
      `Too many wrong PINs. Wait ${seconds} seconds.`,
      'If you have forgotten your PIN, the doctor can set you a new one.',
      {
        userMessage: `অনেকবার ভুল পিন দেওয়া হয়েছে। ${seconds} সেকেন্ড অপেক্ষা করুন।`,
        whatToDo: 'পিন ভুলে গেলে ডাক্তার নতুন পিন দিতে পারবেন।',
      },
    );
  }

  const user = db.prepare(
    `SELECT id, display_name AS displayName, role, pin_salt AS salt, pin_hash AS hash, is_active AS isActive
     FROM app_user WHERE id = ? AND deleted_at IS NULL`,
  ).get(userId) as
    { id: string; displayName: string; role: Role; salt: string | null; hash: string | null; isActive: number } | undefined;

  if (user === undefined || user.isActive !== 1) {
    throw new SignInError(
      'That person cannot sign in.',
      'They may have been switched off. Ask the doctor.',
      { userMessage: 'এই নামে সাইন ইন করা যাচ্ছে না।', whatToDo: 'ডাক্তারকে জানান।' },
    );
  }
  if (user.hash === null) {
    throw new SignInError(
      'This person has no PIN yet.',
      'The doctor sets one from the people screen before they can sign in.',
      { userMessage: 'এই নামের জন্য এখনো পিন দেওয়া হয়নি।', whatToDo: 'ডাক্তার ল্যাপটপ থেকে পিন দেবেন।' },
    );
  }

  if (!verifyPin(pin, user.salt, user.hash)) {
    const previous = failures.get(userId)?.count ?? 0;
    const count = previous + 1;
    failures.set(userId, {
      count,
      until: count >= LOCKOUT.attempts ? Date.now() + LOCKOUT.seconds * 1000 : 0,
    });
    // Recorded, because repeated wrong PINs on one account is worth
    // being able to see afterwards. The PIN itself is never recorded.
    recordAudit(db, {
      actor: { id: null, role: 'system' }, action: 'sign_in_refused', entity: 'app_user', entityId: userId,
      details: { attempt: count },
    });
    throw new SignInError(
      'That PIN is not right.',
      count >= LOCKOUT.attempts - 1
        ? 'One more wrong try and this account waits a minute before it will let you in again.'
        : 'Type it again. If you have forgotten it, the doctor can set you a new one.',
      {
        userMessage: 'পিন মেলেনি।',
        whatToDo: count >= LOCKOUT.attempts - 1
          ? 'আর একবার ভুল হলে এক মিনিট অপেক্ষা করতে হবে।'
          : 'আবার লিখুন। ভুলে গেলে ডাক্তার নতুন পিন দিতে পারবেন।',
      },
    );
  }

  failures.delete(userId);
  const write = db.transaction(() => {
    db.prepare('UPDATE app_user SET last_signed_in_at = ? WHERE id = ?').run(at, userId);
    recordAudit(db, {
      actor: { id: user.id, role: user.role }, action: 'signed_in', entity: 'app_user', entityId: user.id,
    });
  });
  write();

  return { id: user.id, displayName: user.displayName, role: user.role, since: at };
}

export function signOutAudit(db: Db, who: SignedIn): void {
  recordAudit(db, {
    actor: { id: who.id, role: who.role }, action: 'signed_out', entity: 'app_user', entityId: who.id,
  });
}

export function actorOf(who: SignedIn): Actor {
  return { id: who.id, role: who.role };
}

/** For tests only: forget the wrong-PIN counters. */
export function resetSignInAttempts(): void {
  failures.clear();
}
