import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  createKeystore, unlockWithPassphrase, unlockWithRecoveryKey,
  changePassphrase, parseKeystore, normaliseRecoveryKey,
} from '../src/main/keystore/keystore';
import { WrongPassphraseError, WrongRecoveryKeyError, KeystoreCorruptError } from '../src/shared/errors';

describe('key custody', () => {
  test('the passphrase opens the records', () => {
    const { keystore, dekHex } = createKeystore('correct horse battery staple');
    assert.equal(unlockWithPassphrase(keystore, 'correct horse battery staple'), dekHex);
  });

  test('the printed recovery key opens the same records', () => {
    const { keystore, dekHex, recoveryKey } = createKeystore('a passphrase');
    assert.equal(unlockWithRecoveryKey(keystore, recoveryKey), dekHex);
  });

  test('a wrong passphrase is refused, and says so as a wrong passphrase', () => {
    const { keystore } = createKeystore('a passphrase');
    assert.throws(() => unlockWithPassphrase(keystore, 'not the passphrase'), WrongPassphraseError);
  });

  test('a wrong recovery key is refused', () => {
    const { keystore } = createKeystore('a passphrase');
    assert.throws(() => unlockWithRecoveryKey(keystore, 'ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ'), WrongRecoveryKeyError);
  });

  test('the data key is never stored in the clear', () => {
    const { keystore, dekHex } = createKeystore('a passphrase');
    assert.equal(JSON.stringify(keystore).includes(dekHex), false);
  });

  test('two installations never share a key', () => {
    assert.notEqual(createKeystore('same').dekHex, createKeystore('same').dekHex);
  });

  describe('the recovery key survives being read off paper', () => {
    test('accepts it lowercase, without dashes, with stray spaces', () => {
      const { keystore, dekHex, recoveryKey } = createKeystore('a passphrase');
      const mangled = ` ${recoveryKey.toLowerCase().replace(/-/g, '')} `;
      assert.equal(unlockWithRecoveryKey(keystore, mangled), dekHex);
    });

    test('repairs the four characters people mis-transcribe', () => {
      // Someone writing the key by hand turns 0 into O and 1 into l.
      assert.equal(normaliseRecoveryKey('O0l1IU'), '00111V');
    });

    test('is 8 groups of 4 characters', () => {
      const { recoveryKey } = createKeystore('a passphrase');
      assert.match(recoveryKey, /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){7}$/);
    });
  });

  test('changing the passphrase keeps the recovery key working', () => {
    const { keystore, dekHex, recoveryKey } = createKeystore('old passphrase');
    const updated = changePassphrase(keystore, dekHex, 'new passphrase');

    assert.equal(unlockWithPassphrase(updated, 'new passphrase'), dekHex, 'new passphrase opens it');
    assert.equal(unlockWithRecoveryKey(updated, recoveryKey), dekHex, 'printed key still opens it');
    assert.throws(() => unlockWithPassphrase(updated, 'old passphrase'), WrongPassphraseError);
  });

  describe('a damaged key file is reported as damaged, not as a wrong password', () => {
    // These are completely different situations for the user: one means
    // "try again", the other means "stop and restore from backup".
    test('rejects text that is not json', () => {
      assert.throws(() => parseKeystore('this is not json', '/data/keystore.json'), KeystoreCorruptError);
    });
    test('rejects json that is missing a wrapper', () => {
      const { keystore } = createKeystore('a passphrase');
      const broken = JSON.parse(JSON.stringify(keystore));
      delete broken.wrappers.recovery;
      assert.throws(() => parseKeystore(JSON.stringify(broken), '/data/keystore.json'), KeystoreCorruptError);
    });
    test('rejects json that is missing a field inside a wrapper', () => {
      const { keystore } = createKeystore('a passphrase');
      const broken = JSON.parse(JSON.stringify(keystore));
      delete broken.wrappers.passphrase.tag;
      assert.throws(() => parseKeystore(JSON.stringify(broken), '/data/keystore.json'), KeystoreCorruptError);
    });
    test('accepts a good keystore round-tripped through json', () => {
      const { keystore, dekHex } = createKeystore('a passphrase');
      const reloaded = parseKeystore(JSON.stringify(keystore), '/data/keystore.json');
      assert.equal(unlockWithPassphrase(reloaded, 'a passphrase'), dekHex);
    });
  });

  test('a tampered keystore does not silently hand back a wrong key', () => {
    // The authentication tag has to catch this. If it did not, we would
    // open a database with a corrupted key and blame the database.
    const { keystore } = createKeystore('a passphrase');
    const tampered = JSON.parse(JSON.stringify(keystore));
    const ct = tampered.wrappers.passphrase.ciphertext;
    tampered.wrappers.passphrase.ciphertext = (ct[0] === 'a' ? 'b' : 'a') + ct.slice(1);
    assert.throws(() => unlockWithPassphrase(tampered, 'a passphrase'), WrongPassphraseError);
  });
});
