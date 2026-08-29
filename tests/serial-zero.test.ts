import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { provision } from '../src/main/db/provision';
import { nowIso, sessionDate } from '../src/main/db/clock';
import { addStaff } from '../src/main/auth/staff';
import { registerPatient } from '../src/main/patients/register';
import { registerArrival } from '../src/main/queue/register';
import { receiveDeskArrival } from '../src/main/queue/deskArrival';
import { todaysQueue } from '../src/main/queue/queue';
import { tempDir } from './helpers';

const SYSTEM = { id: null, role: 'system' as const };

function chamber() {
  const t = tempDir();
  const { db } = provision(t.dir, 'the pilot passphrase', 'demo');
  db.prepare('INSERT INTO chamber (id, name, created_at) VALUES (?, ?, ?)')
    .run('lubana', 'Lubana', nowIso());
  const doctorId = addStaff(db, { displayName: 'Dr Test', role: 'doctor', pin: '4021' }, SYSTEM);
  const doctor = { id: doctorId, role: 'doctor' as const };
  const deskId = addStaff(db, { displayName: 'Ruhul', role: 'front_desk', pin: '6172' }, doctor);
  // Three people already on today's list, serials 1..3.
  for (let i = 1; i <= 3; i++) {
    const p = registerPatient(db, {
      fullNameBn: `রোগী ${i}`, fullNameEn: null, phone: null, dob: null,
      approxAgeYears: 40, sex: 'male', addressFreeText: null,
    }, doctor);
    registerArrival(db, p, 'lubana', doctor);
  }
  return { db, doctor, deskId, cleanup: () => { db.close(); t.cleanup(); } };
}

let n = 0;
function fromTablet(c: ReturnType<typeof chamber>, serialAnnounced: number) {
  return receiveDeskArrival(db_(c), {
    deskRef: `r-${++n}`,
    chamberId: 'lubana',
    takenBy: c.deskId,
    arrivedAt: nowIso(),
    visitDate: sessionDate(),
    serialAnnounced,
    newPatient: {
      fullNameBn: `নতুন ${n}`, fullNameEn: null, phone: null, dob: null,
      approxAgeYears: 30, sex: 'male', addressFreeText: null,
      deskRef: `p-${n}`,
    },
  }, { id: c.deskId, role: 'front_desk' });
}
const db_ = (c: ReturnType<typeof chamber>) => c.db;

describe('a serial number is never zero', () => {
  test('no serial announced at all gets the NEXT number, not zero', () => {
    const c = chamber();
    const got = fromTablet(c, 0);
    assert.equal(got.serialNo, 4, 'a missing serial became zero and jumped the whole queue');
    c.cleanup();
  });

  test('and zero never reaches the list, where it would sort above everybody', () => {
    const c = chamber();
    fromTablet(c, 0);
    const list = todaysQueue(c.db, 'lubana', sessionDate());
    assert.ok(list.every((e) => e.serialNo > 0), 'a patient is on the list with serial 0');
    assert.equal(list[0]?.serialNo, 1, 'somebody jumped ahead of serial 1');
    c.cleanup();
  });

  test('nonsense serials are treated as none announced', () => {
    for (const bad of [0, -3, 1.5, Number.NaN]) {
      const c = chamber();
      const got = fromTablet(c, bad);
      assert.equal(got.serialNo, 4, `serial ${bad} was accepted`);
      assert.equal(
        (c.db.prepare('SELECT serial_announced AS a FROM visit WHERE serial_no = 4')
          .get() as { a: number | null }).a,
        null,
        'a number nobody said was recorded as announced',
      );
      c.cleanup();
    }
  });

  test('a real announced number is still honoured', () => {
    const c = chamber();
    const got = fromTablet(c, 4);
    assert.equal(got.serialNo, 4);
    c.cleanup();
  });

  test('an announced number already taken still gets the next one, and is written down', () => {
    const c = chamber();
    const got = fromTablet(c, 2);
    assert.equal(got.serialNo, 4, 'two patients were given serial 2');
    assert.equal(
      (c.db.prepare('SELECT serial_announced AS a FROM visit WHERE serial_no = 4')
        .get() as { a: number | null }).a,
      2,
      'nobody will be told the number they were given changed',
    );
    c.cleanup();
  });
});
