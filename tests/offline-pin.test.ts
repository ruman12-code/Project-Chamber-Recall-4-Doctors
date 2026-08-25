import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { pbkdf2Sync } from 'node:crypto';
import { provision } from '../src/main/db/provision';
import { storedPin, verifyPin } from '../src/main/auth/pin';
import { offlineVerifier, deskKeys, deskPeopleWithoutOfflineKeys, OFFLINE_PIN } from '../src/main/auth/offlinePin';
import { addStaff, setPin, setStaffActive } from '../src/main/auth/staff';
import { resetPinWithSpareKey } from '../src/main/auth/spareKey';
import { tempDir } from './helpers';

const SYSTEM = { id: null, role: 'system' as const };

function chamber() {
  const t = tempDir();
  const { db, recoveryKey } = provision(t.dir, 'the pilot passphrase', 'demo');
  const doctor = addStaff(db, { displayName: 'Dr Test', role: 'doctor', pin: '4021' }, SYSTEM);
  return {
    db, dir: t.dir, recoveryKey,
    doctor: { id: doctor, role: 'doctor' as const },
    cleanup: () => { db.close(); t.cleanup(); },
  };
}

/** What the tablet does, in the same arithmetic WebCrypto will do. */
function tabletWouldAccept(
  key: { salt: string; hash: string; iterations: number }, pin: string,
): boolean {
  const got = pbkdf2Sync(pin, Buffer.from(key.salt, 'hex'), key.iterations, 32, 'sha256');
  return got.toString('hex') === key.hash;
}

describe('the verifier the tablet checks a PIN with', () => {
  test('accepts the PIN and refuses anything else', () => {
    const v = offlineVerifier('7483');
    assert.ok(tabletWouldAccept(v, '7483'));
    assert.ok(!tabletWouldAccept(v, '7484'));
    assert.ok(!tabletWouldAccept(v, '748'));
    assert.ok(!tabletWouldAccept(v, ''));
  });

  test('two people with the same PIN do not share a verifier', () => {
    const a = offlineVerifier('7483');
    const b = offlineVerifier('7483');
    assert.notEqual(a.salt, b.salt);
    assert.notEqual(a.hash, b.hash);
  });

  test('carries its own cost, so raising it later does not break old ones', () => {
    const v = offlineVerifier('7483');
    assert.equal(v.iterations, OFFLINE_PIN.iterations);
    assert.ok(v.iterations >= 100000, 'a cheap verifier on a stolen tablet is four digits in seconds');
  });

  test('is not the scrypt hash, and cannot be used as one', () => {
    const stored = storedPin('7483');
    assert.notEqual(stored.hash, stored.offlineHash);
    assert.notEqual(stored.salt, stored.offlineSalt);
    // The thing that actually signs people in still only accepts the
    // real hash. Feeding it the offline one gets nobody in.
    assert.ok(verifyPin('7483', stored.salt, stored.hash));
    assert.ok(!verifyPin('7483', stored.offlineSalt, stored.hash));
  });
});

describe('what a tablet is given', () => {
  test('front desk only -- never the doctor, never the assistant', () => {
    const c = chamber();
    addStaff(c.db, { displayName: 'Nusrat', role: 'clinical_assistant', pin: '5390' }, c.doctor);
    addStaff(c.db, { displayName: 'Ruhul', role: 'front_desk', pin: '6172' }, c.doctor);
    addStaff(c.db, { displayName: 'Biplob', role: 'front_desk', pin: '7483' }, c.doctor);

    const keys = deskKeys(c.db);
    assert.deepEqual(keys.map((k) => k.displayName).sort(), ['Biplob', 'Ruhul']);
    c.cleanup();
  });

  test('the doctor\'s PIN is not in it under any name', () => {
    const c = chamber();
    addStaff(c.db, { displayName: 'Ruhul', role: 'front_desk', pin: '6172' }, c.doctor);
    const keys = deskKeys(c.db);
    for (const key of keys) {
      assert.ok(!tabletWouldAccept(key, '4021'), 'the doctor\'s PIN opened a tablet');
    }
    c.cleanup();
  });

  test('a key opens for its own person and for nobody else', () => {
    const c = chamber();
    addStaff(c.db, { displayName: 'Ruhul', role: 'front_desk', pin: '6172' }, c.doctor);
    addStaff(c.db, { displayName: 'Biplob', role: 'front_desk', pin: '7483' }, c.doctor);
    const keys = deskKeys(c.db);
    const ruhul = keys.find((k) => k.displayName === 'Ruhul')!;
    const biplob = keys.find((k) => k.displayName === 'Biplob')!;
    assert.ok(tabletWouldAccept(ruhul, '6172'));
    assert.ok(!tabletWouldAccept(ruhul, '7483'));
    assert.ok(tabletWouldAccept(biplob, '7483'));
    assert.ok(!tabletWouldAccept(biplob, '6172'));
    c.cleanup();
  });

  test('somebody switched off stops opening tablets', () => {
    const c = chamber();
    const ruhul = addStaff(c.db, { displayName: 'Ruhul', role: 'front_desk', pin: '6172' }, c.doctor);
    assert.equal(deskKeys(c.db).length, 1);
    setStaffActive(c.db, ruhul, false, c.doctor);
    assert.equal(deskKeys(c.db).length, 0);
    c.cleanup();
  });

  test('changing a PIN changes what the tablet will accept', () => {
    const c = chamber();
    const ruhul = addStaff(c.db, { displayName: 'Ruhul', role: 'front_desk', pin: '6172' }, c.doctor);
    setPin(c.db, ruhul, '8891', c.doctor);
    const key = deskKeys(c.db)[0]!;
    assert.ok(tabletWouldAccept(key, '8891'));
    assert.ok(!tabletWouldAccept(key, '6172'), 'the old PIN still opened the tablet');
    c.cleanup();
  });

  test('the spare key changes it too', () => {
    const c = chamber();
    const ruhul = addStaff(c.db, { displayName: 'Ruhul', role: 'front_desk', pin: '6172' }, c.doctor);
    resetPinWithSpareKey(c.db, c.dir, c.recoveryKey, ruhul, '9042');
    const key = deskKeys(c.db)[0]!;
    assert.ok(tabletWouldAccept(key, '9042'));
    assert.ok(!tabletWouldAccept(key, '6172'), 'a PIN reset left the old one working on the tablet');
    c.cleanup();
  });
});

describe('the invariant that keeps this from rotting', () => {
  test('every PIN that exists has an offline verifier beside it', () => {
    const c = chamber();
    addStaff(c.db, { displayName: 'Nusrat', role: 'clinical_assistant', pin: '5390' }, c.doctor);
    const ruhul = addStaff(c.db, { displayName: 'Ruhul', role: 'front_desk', pin: '6172' }, c.doctor);
    setPin(c.db, ruhul, '8891', c.doctor);
    resetPinWithSpareKey(c.db, c.dir, c.recoveryKey, ruhul, '9042');

    // Every way a PIN can be set, in one query. A fifth way that
    // forgets the offline verifier fails here rather than showing up
    // as a front desk locked out of a tablet on a Tuesday evening.
    const orphans = c.db.prepare(
      `SELECT display_name AS name FROM app_user
        WHERE pin_hash IS NOT NULL
          AND (pin_offline_hash IS NULL OR pin_offline_salt IS NULL OR pin_offline_iterations IS NULL)`,
    ).all() as Array<{ name: string }>;
    assert.deepEqual(orphans, [], 'a PIN was set without the verifier the tablet needs');
    c.cleanup();
  });

  test('a PIN from before this existed is named, not silently dropped', () => {
    const c = chamber();
    const ruhul = addStaff(c.db, { displayName: 'Ruhul', role: 'front_desk', pin: '6172' }, c.doctor);
    // Exactly what an upgraded database looks like: the scrypt hash is
    // there, the offline verifier is not.
    c.db.prepare(
      `UPDATE app_user SET pin_offline_salt = NULL, pin_offline_hash = NULL,
                           pin_offline_iterations = NULL WHERE id = ?`,
    ).run(ruhul);

    assert.equal(deskKeys(c.db).length, 0, 'a half-set-up person must not be offered as openable');
    assert.deepEqual(
      deskPeopleWithoutOfflineKeys(c.db).map((p) => p.displayName), ['Ruhul'],
      'the tablet has to be able to say why Ruhul is not on the list',
    );

    // And setting the PIN again is the fix, which is what the tablet
    // tells the doctor to do.
    setPin(c.db, ruhul, '6172', c.doctor);
    assert.equal(deskKeys(c.db).length, 1);
    assert.deepEqual(deskPeopleWithoutOfflineKeys(c.db), []);
    c.cleanup();
  });
});
