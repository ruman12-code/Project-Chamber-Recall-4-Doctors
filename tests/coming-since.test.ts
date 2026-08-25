import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { provision } from '../src/main/db/provision';
import type { Db } from '../src/main/db/open';
import { nowIso, localDate } from '../src/main/db/clock';
import { registerPatient, normaliseAttendingSince } from '../src/main/patients/register';
import { registerArrival } from '../src/main/queue/register';
import { todaysQueue } from '../src/main/queue/queue';
import { addStaff } from '../src/main/auth/staff';
import { tempDir } from './helpers';

const SYSTEM = { id: null, role: 'system' as const };
const TODAY = localDate();

function chamber() {
  const t = tempDir();
  const { db } = provision(t.dir, 'the pilot passphrase', 'demo');
  db.prepare('INSERT INTO chamber (id, name, created_at) VALUES (?, ?, ?)')
    .run('popular', 'Popular', nowIso());
  const doctor = addStaff(db, { displayName: 'Dr Test', role: 'doctor', pin: '4021' }, SYSTEM);
  return { db, desk: { id: doctor, role: 'doctor' as const }, cleanup: t.cleanup };
}

describe('a year the patient gives at the desk', () => {
  test('a plain year is kept', () => {
    assert.equal(normaliseAttendingSince('2019'), '2019');
    assert.equal(normaliseAttendingSince(' 2019 '), '2019');
  });

  test('a year inside a sentence is found', () => {
    assert.equal(normaliseAttendingSince('since about 2016 I think'), '2016');
  });

  test('anything that is not a year is dropped, not guessed at', () => {
    // A wrong year on a record is worse than no year. "About five
    // years" is not turned into a date by arithmetic nobody checked.
    assert.equal(normaliseAttendingSince('about five years'), null);
    assert.equal(normaliseAttendingSince('a long time'), null);
    assert.equal(normaliseAttendingSince(''), null);
    assert.equal(normaliseAttendingSince(null), null);
  });

  test('a year that could not have happened is dropped', () => {
    assert.equal(normaliseAttendingSince('1066'), null);
    assert.equal(normaliseAttendingSince('2099'), null);
    assert.equal(normaliseAttendingSince(String(new Date().getFullYear() + 1)), null);
  });

  test('this year is allowed: somebody who first came in January', () => {
    assert.equal(normaliseAttendingSince(String(new Date().getFullYear())),
      String(new Date().getFullYear()));
  });
});

describe('the software stops calling long-standing patients new', () => {
  let c: ReturnType<typeof chamber>;
  before(() => { c = chamber(); });
  after(() => { c.db.close(); c.cleanup(); });

  test('somebody genuinely new has no year against them', () => {
    const id = registerPatient(c.db, {
      fullNameBn: 'সত্যিই নতুন', fullNameEn: null, phone: null, dob: null,
      approxAgeYears: 25, sex: 'female', addressFreeText: null,
    }, c.desk);
    registerArrival(c.db, id, 'popular', c.desk);
    const entry = todaysQueue(c.db, 'popular', TODAY).find((e) => e.nameBn === 'সত্যিই নতুন')!;
    assert.equal(entry.previousVisits, 0);
    assert.equal(entry.attendingSince, null, 'the screen may say "first visit" about this one');
  });

  test("somebody coming since 2019 carries that onto today's list", () => {
    const id = registerPatient(c.db, {
      fullNameBn: 'আট বছরের রোগী', fullNameEn: null, phone: null, dob: null,
      approxAgeYears: 61, sex: 'male', addressFreeText: null,
      attendingSince: '2019',
    }, c.desk);
    registerArrival(c.db, id, 'popular', c.desk);
    const entry = todaysQueue(c.db, 'popular', TODAY).find((e) => e.nameBn === 'আট বছরের রোগী')!;
    assert.equal(entry.previousVisits, 0, 'no visits in THIS program');
    assert.equal(entry.attendingSince, '2019',
      'and the screen must not call that a first visit');
  });

  test('what the patient said is recorded as the patient having said it', () => {
    const row = c.db.prepare(
      `SELECT attending_since AS since, attending_since_source AS source
         FROM patient WHERE full_name_bn = 'আট বছরের রোগী'`,
    ).get() as { since: string; source: string };
    assert.equal(row.since, '2019');
    assert.equal(row.source, 'patient', 'an estimate from the desk, not a fact from the doctor');
  });

  test('a source the program never heard of cannot be written', () => {
    assert.throws(() => c.db.prepare(
      `UPDATE patient SET attending_since_source = 'somebody' WHERE attending_since = '2019'`,
    ).run(), /CHECK constraint failed/);
  });

  test('nothing about this changes what anybody may do', () => {
    // It is one fact for one sentence on one screen. It gates nothing,
    // orders nothing and decides nothing.
    const queue = todaysQueue(c.db, 'popular', TODAY);
    assert.equal(queue.length, 2);
    assert.deepEqual(queue.map((e) => e.serialNo), [1, 2]);
    for (const entry of queue) assert.equal(entry.status, 'waiting');
  });
});
