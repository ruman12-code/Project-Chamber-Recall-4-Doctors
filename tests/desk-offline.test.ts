import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { takeSerial, peekSerial, syncFromLaptop, forgetSerials } from '../src/tablet/serials';
import { searchDirectory, type Directory } from '../src/tablet/directory';
import { normaliseName, searchablePhone } from '../src/shared/names';

// The tablet's own storage, standing in for a browser's.
const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => store.clear(),
  key: () => null,
  length: 0,
} as unknown as Storage;

const POPULAR = 'chamber-popular';
const LUBANA = 'chamber-lubana';
const TODAY = '2026-08-25';

describe('numbers given out at the desk with no laptop', () => {
  beforeEach(() => { store.clear(); });

  test('a tablet that has never heard from the laptop starts at one', () => {
    assert.equal(peekSerial(POPULAR, TODAY), 1);
    assert.equal(takeSerial(POPULAR, TODAY), 1);
    assert.equal(takeSerial(POPULAR, TODAY), 2);
    assert.equal(takeSerial(POPULAR, TODAY), 3);
  });

  test('the laptop is the truth, and the tablet carries on from it', () => {
    syncFromLaptop(POPULAR, TODAY, 8);
    assert.equal(takeSerial(POPULAR, TODAY), 8);
    assert.equal(takeSerial(POPULAR, TODAY), 9);
  });

  test('the register starts again the next evening', () => {
    syncFromLaptop(POPULAR, TODAY, 12);
    assert.equal(takeSerial(POPULAR, TODAY), 12);
    assert.equal(takeSerial(POPULAR, '2026-08-26'), 1,
      'patient one arrives again every evening');
  });

  test('a count for the other chamber is never used for this one', () => {
    // Biplob's tablet is at Popular. Ruhul's is at Lubana. Neither
    // tablet may ever hand out a number from the other's register.
    syncFromLaptop(LUBANA, TODAY, 30);
    assert.equal(takeSerial(POPULAR, TODAY), 1);
  });

  test('forgetting leaves nothing behind', () => {
    takeSerial(POPULAR, TODAY);
    forgetSerials();
    assert.equal(peekSerial(POPULAR, TODAY), 1);
  });
});

describe('finding a patient on the tablet with no laptop', () => {
  const directory: Directory = {
    takenAt: '2026-08-25T10:00:00Z',
    entries: [
      { id: 'p1', nameBn: 'রহিমা বেগম', nameEn: 'Rahima Begum', phone: '01711000001',
        sBn: normaliseName('রহিমা বেগম'), sEn: normaliseName('Rahima Begum'),
        sPhone: searchablePhone('01711000001') },
      { id: 'p2', nameBn: 'সুরাইয়া আরা', nameEn: 'Suraiya Ara', phone: '+8801596176370',
        sBn: normaliseName('সুরাইয়া আরা'), sEn: normaliseName('Suraiya Ara'),
        sPhone: searchablePhone('+8801596176370') },
      { id: 'p3', nameBn: null, nameEn: 'Abdul Mia', phone: null,
        sBn: null, sEn: normaliseName('Abdul Mia'), sPhone: null },
    ],
  };

  test('by part of a phone number', () => {
    const found = searchDirectory(directory, '01711');
    assert.deepEqual(found.map((f) => f.id), ['p1']);
  });

  test('however the number was written down', () => {
    // The same handset, three ways. All of them must find her.
    for (const typed of ['01596176370', '+8801596176370', '01596-176370']) {
      assert.deepEqual(searchDirectory(directory, typed).map((f) => f.id), ['p2'], typed);
    }
  });

  test('by name in Bangla', () => {
    assert.deepEqual(searchDirectory(directory, 'রহিমা').map((f) => f.id), ['p1']);
  });

  test('by name in English, whatever the case', () => {
    assert.deepEqual(searchDirectory(directory, 'abdul').map((f) => f.id), ['p3']);
    assert.deepEqual(searchDirectory(directory, 'ABDUL').map((f) => f.id), ['p3']);
  });

  test('one letter is not a search', () => {
    // Otherwise the first tap shows half the chamber.
    assert.deepEqual(searchDirectory(directory, 'র'), []);
  });

  test('somebody who is not there is not guessed at', () => {
    // No phonetic matching. A search that makes the assistant type one
    // more letter beats one that offers the wrong person confidently.
    assert.deepEqual(searchDirectory(directory, 'Mohammad'), []);
    assert.deepEqual(searchDirectory(directory, '01999999999'), []);
  });

  test('what comes back is a name and a number and nothing else', () => {
    const [first] = searchDirectory(directory, '01711');
    assert.deepEqual(Object.keys(first!).sort(), ['id', 'nameBn', 'nameEn', 'phone']);
  });
});
