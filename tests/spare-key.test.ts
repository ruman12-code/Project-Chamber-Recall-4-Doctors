import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { provision } from '../src/main/db/provision';
import type { Db } from '../src/main/db/open';
import { recentAudit } from '../src/main/db/audit';
import { addStaff } from '../src/main/auth/staff';
import { signIn, resetSignInAttempts } from '../src/main/auth/session';
import {
  setSpareCode, clearSpareCode, spareCodeIsSet, whichSpareKey, peopleForSpareKey,
  resetPinWithSpareKey, pinResetNotice, acknowledgePinReset, SpareKeyError, SPARE_CODE_MIN,
} from '../src/main/auth/spareKey';
import { tempDir } from './helpers';

const PASSPHRASE = 'the pilot passphrase';
const SYSTEM = { id: null, role: 'system' as const };

function chamber() {
  const t = tempDir();
  const { db, recoveryKey } = provision(t.dir, PASSPHRASE, 'demo');
  const doctorId = addStaff(db, { displayName: 'Dr Test', role: 'doctor', pin: '4021' }, SYSTEM);
  // Once a doctor exists, only a doctor adds anybody else.
  const deskId = addStaff(db, { displayName: 'Biplob', role: 'front_desk', pin: '6172' },
    { id: doctorId, role: 'doctor' });
  return { db, dir: t.dir, recoveryKey, doctorId, deskId, cleanup: t.cleanup };
}

describe('the spare key: what opens it', () => {
  let c: ReturnType<typeof chamber>;
  before(() => { c = chamber(); });
  after(() => { c.db.close(); c.cleanup(); });

  test('the recovery key works with nothing set up at all', () => {
    // The chamber that most needs a spare key is the one that never got
    // round to making one, so this must work out of the box.
    assert.equal(spareCodeIsSet(c.db), false);
    assert.equal(whichSpareKey(c.db, c.dir, c.recoveryKey), 'recovery key');
  });

  test('the recovery key is accepted however it was written down', () => {
    const mangled = ` ${c.recoveryKey.toLowerCase().replace(/-/g, '')} `;
    assert.equal(whichSpareKey(c.db, c.dir, mangled), 'recovery key');
  });

  test('nothing else opens it', () => {
    assert.equal(whichSpareKey(c.db, c.dir, PASSPHRASE), null);
    assert.equal(whichSpareKey(c.db, c.dir, '4021'), null);
    assert.equal(whichSpareKey(c.db, c.dir, ''), null);
    assert.equal(whichSpareKey(c.db, c.dir, 'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH'), null);
  });

  test('a spare code works once the doctor sets one', () => {
    setSpareCode(c.db, 'biplob knows this', { id: c.doctorId, role: 'doctor' });
    assert.equal(spareCodeIsSet(c.db), true);
    assert.equal(whichSpareKey(c.db, c.dir, 'biplob knows this'), 'spare code');
  });

  test('and the recovery key still works alongside it', () => {
    assert.equal(whichSpareKey(c.db, c.dir, c.recoveryKey), 'recovery key');
  });

  test('clearing the spare code leaves the recovery key working', () => {
    clearSpareCode(c.db, { id: c.doctorId, role: 'doctor' });
    assert.equal(spareCodeIsSet(c.db), false);
    assert.equal(whichSpareKey(c.db, c.dir, 'biplob knows this'), null);
    assert.equal(whichSpareKey(c.db, c.dir, c.recoveryKey), 'recovery key');
  });

  test('only the doctor sets or clears it', () => {
    assert.throws(() => setSpareCode(c.db, 'a long enough code', { id: c.deskId, role: 'front_desk' }),
      SpareKeyError);
    assert.throws(() => clearSpareCode(c.db, { id: c.deskId, role: 'front_desk' }), SpareKeyError);
  });

  test('a spare code too short to be worth having is refused', () => {
    assert.throws(() => setSpareCode(c.db, 'a'.repeat(SPARE_CODE_MIN - 1), { id: c.doctorId, role: 'doctor' }),
      SpareKeyError);
  });
});

describe('the spare key: resetting a PIN', () => {
  let c: ReturnType<typeof chamber>;
  before(() => { c = chamber(); });
  after(() => { c.db.close(); c.cleanup(); });

  test('the screen behind it shows people and nothing else', () => {
    const people = peopleForSpareKey(c.db);
    assert.deepEqual(people.map((p) => p.displayName).sort(), ['Biplob', 'Dr Test']);
    // Names, roles, and whether they can sign in. No patient anywhere.
    for (const person of people) {
      assert.deepEqual(Object.keys(person).sort(),
        ['canSignIn', 'displayName', 'id', 'isActive', 'role']);
    }
  });

  test('a wrong spare key resets nothing, and says what the two keys are', () => {
    assert.throws(
      () => resetPinWithSpareKey(c.db, c.dir, 'not the key', c.doctorId, '1357'),
      (e: unknown) => e instanceof SpareKeyError && /recovery key/i.test((e as SpareKeyError).whatToDo),
    );
    // The old PIN still works.
    resetSignInAttempts();
    assert.equal(signIn(c.db, c.doctorId, '4021').displayName, 'Dr Test');
  });

  test('the doctor who forgot his PIN can be given a new one', () => {
    const done = resetPinWithSpareKey(c.db, c.dir, c.recoveryKey, c.doctorId, '9182');
    assert.equal(done.displayName, 'Dr Test');
    assert.equal(done.using, 'recovery key');
    resetSignInAttempts();
    assert.equal(signIn(c.db, c.doctorId, '9182').displayName, 'Dr Test');
  });

  test('and the PIN he forgot stops working', () => {
    resetSignInAttempts();
    assert.throws(() => signIn(c.db, c.doctorId, '4021'));
  });

  test('a PIN the software would refuse from a person is refused here too', () => {
    assert.throws(() => resetPinWithSpareKey(c.db, c.dir, c.recoveryKey, c.doctorId, '12'));
    assert.throws(() => resetPinWithSpareKey(c.db, c.dir, c.recoveryKey, c.doctorId, 'abcd'));
  });

  test('somebody who is not in this installation cannot be reset', () => {
    assert.throws(() => resetPinWithSpareKey(c.db, c.dir, c.recoveryKey, 'nobody', '1357'), SpareKeyError);
  });

  test('the reset is in the audit log, saying which key was used', () => {
    const entry = recentAudit(c.db).find((e) => e.action === 'pin_reset_with_spare_key');
    assert.ok(entry, 'a PIN reset that leaves no trace is the thing this must never be');
    assert.equal(entry!.entity_id, c.doctorId);
    assert.match(entry!.details_json!, /recovery key/);
  });
});

describe('the spare key: the person is told', () => {
  let c: ReturnType<typeof chamber>;
  before(() => { c = chamber(); });
  after(() => { c.db.close(); c.cleanup(); });

  test('nobody is told anything before a reset happens', () => {
    assert.equal(pinResetNotice(c.db, c.doctorId), null);
  });

  test('after a reset the notice is waiting on their own screen', () => {
    resetPinWithSpareKey(c.db, c.dir, c.recoveryKey, c.doctorId, '9182');
    const notice = pinResetNotice(c.db, c.doctorId);
    assert.ok(notice, 'a reset the person is never told about is a reset that can be done covertly');
    assert.equal(notice!.using, 'recovery key');
  });

  test('it is only on the screen of the person it happened to', () => {
    assert.equal(pinResetNotice(c.db, c.deskId), null);
  });

  test('it stays until they say they knew about it', () => {
    assert.ok(pinResetNotice(c.db, c.doctorId));
    acknowledgePinReset(c.db, { id: c.doctorId, role: 'doctor' });
    assert.equal(pinResetNotice(c.db, c.doctorId), null);
  });

  test('acknowledging is itself recorded, so "I was never told" is checkable', () => {
    assert.ok(recentAudit(c.db).some((e) => e.action === 'pin_reset_acknowledged'));
  });

  test('a second reset raises the notice again', () => {
    resetPinWithSpareKey(c.db, c.dir, c.recoveryKey, c.doctorId, '2468');
    assert.ok(pinResetNotice(c.db, c.doctorId));
  });
});
