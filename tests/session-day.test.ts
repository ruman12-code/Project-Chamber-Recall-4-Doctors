import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { provision } from '../src/main/db/provision';
import { nowIso } from '../src/main/db/clock';
import { sessionDate, pastMidnight, ROLL_HOUR } from '../src/shared/sessionDay';
import { registerPatient } from '../src/main/patients/register';
import { registerArrival } from '../src/main/queue/register';
import { todaysQueue } from '../src/main/queue/queue';
import { addStaff } from '../src/main/auth/staff';
import { tempDir } from './helpers';

const SYSTEM = { id: null, role: 'system' as const };

/** A local wall-clock moment, the way the chamber experiences it. */
function at(y: number, m: number, d: number, h: number, min = 0): Date {
  return new Date(y, m - 1, d, h, min, 0, 0);
}

describe('which evening a moment belongs to', () => {
  test('an ordinary Lubana session is its own calendar day', () => {
    assert.equal(sessionDate(at(2026, 8, 26, 15, 30)), '2026-08-26');
    assert.equal(sessionDate(at(2026, 8, 26, 19, 30)), '2026-08-26');
  });

  test('the Popular session keeps that day right through midnight', () => {
    assert.equal(sessionDate(at(2026, 8, 26, 20, 30)), '2026-08-26');
    assert.equal(sessionDate(at(2026, 8, 26, 23, 59)), '2026-08-26');
    // One minute later. Still the same evening, still the same list.
    assert.equal(sessionDate(at(2026, 8, 27, 0, 0)), '2026-08-26');
    assert.equal(sessionDate(at(2026, 8, 27, 0, 30)), '2026-08-26');
    // A night that overran badly.
    assert.equal(sessionDate(at(2026, 8, 27, 4, 59)), '2026-08-26');
  });

  test('and a new day starts in the morning, not at midnight', () => {
    assert.equal(sessionDate(at(2026, 8, 27, ROLL_HOUR, 0)), '2026-08-27');
    assert.equal(sessionDate(at(2026, 8, 27, 9, 0)), '2026-08-27');
  });

  test('it crosses a month, and a year, without help', () => {
    assert.equal(sessionDate(at(2026, 9, 1, 0, 20)), '2026-08-31');
    assert.equal(sessionDate(at(2027, 1, 1, 0, 20)), '2026-12-31');
    assert.equal(sessionDate(at(2026, 3, 1, 0, 20)), '2026-02-28');
  });

  test('the screens can tell when it is after midchamber-night', () => {
    assert.equal(pastMidnight(at(2026, 8, 26, 23, 59)), false);
    assert.equal(pastMidnight(at(2026, 8, 27, 0, 30)), true);
    assert.equal(pastMidnight(at(2026, 8, 27, 9, 0)), false);
  });
});

describe('the register does not restart in the middle of an evening', () => {
  function chamber() {
    const t = tempDir();
    const { db } = provision(t.dir, 'the pilot passphrase', 'demo');
    db.prepare('INSERT INTO chamber (id, name, created_at) VALUES (?, ?, ?)')
      .run('popular', 'Popular', nowIso());
    const doctorId = addStaff(db, { displayName: 'Dr Test', role: 'doctor', pin: '4021' }, SYSTEM);
    return { db, doctor: { id: doctorId, role: 'doctor' as const }, cleanup: () => { db.close(); t.cleanup(); } };
  }

  function arrive(c: ReturnType<typeof chamber>, name: string, when: Date) {
    const p = registerPatient(c.db, {
      fullNameBn: name, fullNameEn: null, phone: null, dob: null,
      approxAgeYears: 40, sex: 'male', addressFreeText: null,
    }, c.doctor);
    return registerArrival(c.db, p, 'popular', c.doctor, { visitDate: sessionDate(when) });
  }

  test('23:50 and 00:10 are the same evening, with consecutive serials', () => {
    const c = chamber();
    const before = arrive(c, 'আগে', at(2026, 8, 26, 23, 50));
    const after = arrive(c, 'পরে', at(2026, 8, 27, 0, 10));
    assert.equal(before.serialNo, 1);
    assert.equal(after.serialNo, 2, 'the register restarted at midnight and two patients were called 1');

    // And they are on ONE list -- the doctor's screen does not empty.
    const list = todaysQueue(c.db, 'popular', sessionDate(at(2026, 8, 27, 0, 15)));
    assert.equal(list.length, 2);
    assert.deepEqual(list.map((e) => e.serialNo).sort(), [1, 2]);
    c.cleanup();
  });

  test('the next evening does start again at 1', () => {
    const c = chamber();
    arrive(c, 'গতকাল', at(2026, 8, 26, 20, 0));
    arrive(c, 'গতকাল রাতে', at(2026, 8, 27, 0, 10));
    // Tomorrow afternoon at Lubana. A fresh register.
    const tomorrow = arrive(c, 'আজ', at(2026, 8, 27, 16, 0));
    assert.equal(tomorrow.serialNo, 1, 'the new day carried on from yesterday’s numbers');

    assert.equal(todaysQueue(c.db, 'popular', '2026-08-26').length, 2);
    assert.equal(todaysQueue(c.db, 'popular', '2026-08-27').length, 1);
    c.cleanup();
  });

  test('two chambers on one evening keep separate registers', () => {
    const c = chamber();
    c.db.prepare('INSERT INTO chamber (id, name, created_at) VALUES (?, ?, ?)')
      .run('lubana', 'Lubana', nowIso());
    const p = registerPatient(c.db, {
      fullNameBn: 'লুবানার রোগী', fullNameEn: null, phone: null, dob: null,
      approxAgeYears: 40, sex: 'male', addressFreeText: null,
    }, c.doctor);
    const lubana = registerArrival(c.db, p, 'lubana', c.doctor,
      { visitDate: sessionDate(at(2026, 8, 26, 16, 0)) });
    const popular = arrive(c, 'পপুলারের রোগী', at(2026, 8, 26, 21, 0));
    // Lubana ran first and Popular second, on the same evening, and
    // each starts its own register at 1.
    assert.equal(lubana.serialNo, 1);
    assert.equal(popular.serialNo, 1);
    c.cleanup();
  });
});
