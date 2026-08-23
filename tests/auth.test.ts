import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { provision } from '../src/main/db/provision';
import { nowIso } from '../src/main/db/clock';
import type { Db } from '../src/main/db/open';
import { checkPin, hashPin, verifyPin, BadPinError } from '../src/main/auth/pin';
import { needsSetup, signInList, allStaff, addStaff, setPin, setStaffActive, StaffError } from '../src/main/auth/staff';
import { signIn, SignInError, resetSignInAttempts } from '../src/main/auth/session';
import { tempDir } from './helpers';

/**
 * Milestone 9. Nothing in a medical record is anonymous.
 *
 * What is being defended here is not the database - that is defended
 * by the passphrase and by SQLCipher, and it is already unlocked
 * before anybody signs in. It is the truth of "who wrote this", which
 * cannot be reconstructed afterwards if it was never recorded.
 */

const system = { id: null, role: 'system' as const };

function fresh() {
  const t = tempDir();
  const db = provision(t.dir, 'passphrase', 'demo').db;
  return { db, cleanup: t.cleanup };
}

describe('PINs', () => {
  test('a PIN is digits, and long enough to not be guessed by standing there', () => {
    assert.throws(() => checkPin('12'), BadPinError);
    assert.throws(() => checkPin('abcd'), BadPinError);
    assert.throws(() => checkPin('12 34'), BadPinError);
    assert.throws(() => checkPin('123456789'), BadPinError);
    checkPin('4021');
    checkPin('90210');
  });

  test('the four everybody picks are refused', () => {
    for (const obvious of ['1234', '0000', '1111', '123456', '7777']) {
      assert.throws(() => checkPin(obvious), BadPinError, `${obvious} was accepted`);
    }
  });

  test('a refusal says what to do instead of only that it failed', () => {
    try {
      checkPin('1234');
      assert.fail('1234 was accepted');
    } catch (error) {
      assert.ok(error instanceof BadPinError);
      assert.ok(error.whatToDo.length > 20);
    }
  });

  test('the right PIN verifies and a wrong one does not', () => {
    const { salt, hash } = hashPin('4021');
    assert.equal(verifyPin('4021', salt, hash), true);
    assert.equal(verifyPin('4022', salt, hash), false);
    assert.equal(verifyPin('', salt, hash), false);
  });

  test('two people with the same PIN do not share a stored value', () => {
    const a = hashPin('4021');
    const b = hashPin('4021');
    assert.notEqual(a.salt, b.salt);
    assert.notEqual(a.hash, b.hash);
  });

  test('a user with no PIN can never be verified into', () => {
    assert.equal(verifyPin('4021', null, null), false);
    assert.equal(verifyPin('', null, null), false);
  });
});

describe('setting up who works here', () => {
  let db: Db; let cleanup: () => void; let doctorId: string;
  before(() => { const f = fresh(); db = f.db; cleanup = f.cleanup; });
  after(() => { db.close(); cleanup(); });

  test('a new installation has nobody who can sign in', () => {
    assert.equal(needsSetup(db), true);
    assert.deepEqual(signInList(db), []);
  });

  test('the first doctor can be added before anybody is signed in', () => {
    doctorId = addStaff(db, { displayName: 'Dr Ashraful Haque', role: 'doctor', pin: '4021' }, system);
    assert.equal(needsSetup(db), false);
  });

  test('after that, only the doctor may add anybody', () => {
    const desk = { id: 'nobody', role: 'front_desk' as const };
    assert.throws(() => addStaff(db, { displayName: 'Biplob', role: 'front_desk', pin: '6172' }, desk), StaffError);
    addStaff(db, { displayName: 'Biplob', role: 'front_desk', pin: '6172' }, { id: doctorId, role: 'doctor' });
    assert.equal(signInList(db).length, 2);
  });

  test('two people cannot share a name on screen', () => {
    assert.throws(
      () => addStaff(db, { displayName: 'biplob', role: 'front_desk', pin: '5544' }, { id: doctorId, role: 'doctor' }),
      StaffError,
    );
  });

  test('somebody with no name is refused', () => {
    assert.throws(
      () => addStaff(db, { displayName: '   ', role: 'front_desk', pin: '5544' }, { id: doctorId, role: 'doctor' }),
      StaffError,
    );
  });

  test('the placeholder users from before sign-in are never listed as people', () => {
    const names = allStaff(db).map((p) => p.displayName);
    assert.ok(!names.some((n) => n.toLowerCase().includes('before sign-in')));
  });

  test('somebody who has left is switched off, not deleted', () => {
    const biplob = signInList(db).find((p) => p.displayName === 'Biplob')!;
    setStaffActive(db, biplob.id, false, { id: doctorId, role: 'doctor' });
    assert.equal(signInList(db).some((p) => p.id === biplob.id), false);
    assert.equal(allStaff(db).some((p) => p.id === biplob.id), true, 'the record does not lose its author');
    setStaffActive(db, biplob.id, true, { id: doctorId, role: 'doctor' });
  });

  test('the only doctor cannot be switched off', () => {
    const other = { id: 'someone-else', role: 'doctor' as const };
    assert.throws(() => setStaffActive(db, doctorId, false, other), StaffError);
  });

  test('nobody can switch off the account they are using', () => {
    assert.throws(() => setStaffActive(db, doctorId, false, { id: doctorId, role: 'doctor' }), StaffError);
  });

  test('a person may change their own PIN and nobody else\'s', () => {
    const biplob = signInList(db).find((p) => p.displayName === 'Biplob')!;
    setPin(db, biplob.id, '8899', { id: biplob.id, role: 'front_desk' });
    assert.throws(() => setPin(db, doctorId, '9999', { id: biplob.id, role: 'front_desk' }), StaffError);
    // The doctor can, because somebody who has forgotten theirs on a
    // Tuesday evening cannot wait for anything else.
    setPin(db, biplob.id, '6172', { id: doctorId, role: 'doctor' });
  });
});

describe('signing in', () => {
  let db: Db; let cleanup: () => void; let doctorId: string; let deskId: string;
  before(() => {
    const f = fresh(); db = f.db; cleanup = f.cleanup;
    doctorId = addStaff(db, { displayName: 'Dr Ashraful', role: 'doctor', pin: '4021' }, system);
    deskId = addStaff(db, { displayName: 'Biplob', role: 'front_desk', pin: '6172' }, { id: doctorId, role: 'doctor' });
    resetSignInAttempts();
  });
  after(() => { db.close(); cleanup(); });

  test('the right PIN signs you in as yourself', () => {
    const who = signIn(db, doctorId, '4021');
    assert.equal(who.id, doctorId);
    assert.equal(who.role, 'doctor');
    assert.equal(who.displayName, 'Dr Ashraful');
  });

  test('signing in is recorded, and so is the time', () => {
    signIn(db, deskId, '6172', '2026-08-23T17:00:00.000Z');
    const row = db.prepare('SELECT last_signed_in_at AS at FROM app_user WHERE id = ?').get(deskId) as { at: string };
    assert.equal(row.at, '2026-08-23T17:00:00.000Z');
    const audit = db.prepare(
      `SELECT count(*) AS n FROM audit_log WHERE action = 'signed_in' AND entity_id = ?`,
    ).get(deskId) as { n: number };
    assert.equal(audit.n, 1);
  });

  test('a wrong PIN is refused and recorded, without the PIN itself', () => {
    assert.throws(() => signIn(db, deskId, '0001'), SignInError);
    const row = db.prepare(
      `SELECT details_json AS details FROM audit_log
       WHERE action = 'sign_in_refused' AND entity_id = ? ORDER BY id DESC LIMIT 1`,
    ).get(deskId) as { details: string };
    assert.ok(!row.details.includes('0001'), 'the PIN somebody typed must never reach the log');
  });

  test('five wrong PINs make the account wait', () => {
    resetSignInAttempts();
    for (let i = 0; i < 5; i++) {
      assert.throws(() => signIn(db, deskId, '0002'), SignInError);
    }
    // Even the right one, now.
    assert.throws(() => signIn(db, deskId, '6172'), /Wait/);
    resetSignInAttempts();
    assert.equal(signIn(db, deskId, '6172').id, deskId);
  });

  test('somebody switched off cannot sign in', () => {
    setStaffActive(db, deskId, false, { id: doctorId, role: 'doctor' });
    resetSignInAttempts();
    assert.throws(() => signIn(db, deskId, '6172'), SignInError);
    setStaffActive(db, deskId, true, { id: doctorId, role: 'doctor' });
  });

  test('somebody with no PIN at all cannot sign in', () => {
    const id = 'no-pin-user';
    db.prepare('INSERT INTO app_user (id, display_name, role, is_active, created_at) VALUES (?, ?, ?, 1, ?)')
      .run(id, 'Never set up', 'front_desk', nowIso());
    resetSignInAttempts();
    assert.throws(() => signIn(db, id, '1357'), SignInError);
  });
});
