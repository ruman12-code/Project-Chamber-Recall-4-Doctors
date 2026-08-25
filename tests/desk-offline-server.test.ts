import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { provision } from '../src/main/db/provision';
import { nowIso, localDate } from '../src/main/db/clock';
import type { Db } from '../src/main/db/open';
import { setActiveChamber } from '../src/main/queue/queue';
import { todaysQueue } from '../src/main/queue/queue';
import { startTabletServer, type RunningServer } from '../src/main/server/server';
import { addStaff } from '../src/main/auth/staff';
import { unresolvedSerialClashes } from '../src/main/queue/deskArrival';
import { tempDir } from './helpers';

const SYSTEM = { id: null, role: 'system' as const };
const WEB_ROOT = join(__dirname, '..', 'tablet');
const TODAY = localDate();

/**
 * The evening this whole change exists for: the doctor is at Lubana
 * with the laptop, and Biplob is registering patients at Popular. These
 * go over real HTTP, the way the tablet does.
 */
describe('a desk working while the laptop is at the other chamber', () => {
  let db: Db; let cleanup: () => void; let server: RunningServer; let base: string;
  let token = ''; let biplob = ''; let dir = '';

  before(async () => {
    const t = tempDir();
    cleanup = t.cleanup;
    dir = t.dir;
    db = provision(t.dir, 'passphrase', 'demo').db;
    db.prepare('INSERT INTO chamber (id, name, created_at) VALUES (?, ?, ?)')
      .run('popular', 'Popular', nowIso());
    db.prepare('INSERT INTO chamber (id, name, created_at) VALUES (?, ?, ?)')
      .run('lubana', 'Lubana', nowIso());
    // The laptop is at LUBANA. Biplob's tablet is at POPULAR.
    setActiveChamber(db, 'lubana');
    const doctor = addStaff(db, { displayName: 'Dr Test', role: 'doctor', pin: '4021' }, SYSTEM);
    biplob = addStaff(db, { displayName: 'Biplob', role: 'front_desk', pin: '6172' },
      { id: doctor, role: 'doctor' });

    server = await startTabletServer({ db, dataDir: t.dir, webRoot: WEB_ROOT, port: 0 });
    base = `http://127.0.0.1:${server.port}`;
  });
  after(async () => { await server.close(); db.close(); cleanup(); });

  const call = async (path: string, body: unknown, method = 'POST') => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(token === '' ? {} : { 'x-chamber-token': token }) },
      ...(method === 'POST' ? { body: JSON.stringify(body ?? {}) } : {}),
    });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  };

  test('the tablet is paired to Popular, not to whichever chamber the laptop is at', async () => {
    server.pairingChamberId = 'popular';
    const paired = await call('/api/pair', { code: server.pairingCode, label: "Biplob's tablet" });
    assert.equal(paired.status, 200);
    token = String(paired.body.token);

    const session = await call('/api/session', null, 'GET');
    const desk = session.body.deskChamber as { id: string; name: string; nextSerial: number };
    assert.equal(desk.name, 'Popular', 'the tablet speaks for the desk it sits on');
    assert.equal(desk.nextSerial, 1, 'nobody has arrived at Popular yet today');
  });

  test('Biplob signs in, which the tablet needs the laptop once for', async () => {
    // The one thing that still needs the laptop in reach. After this
    // the desk works on its own; see docs/TWO-CHAMBERS.md.
    const signed = await call('/api/signin', { userId: biplob, pin: '6172' });
    assert.equal(signed.status, 200, JSON.stringify(signed.body));
  });

  test('arrivals land from a tablet this laptop has no sign-in for at all', async () => {
    // The case that would otherwise lose an evening's work. The doctor
    // closes the laptop at Lubana and opens it at Popular; the sign-in
    // it was holding in memory is gone with the restart, and the
    // buffered arrivals turn up against a laptop that has never heard
    // of anybody at that desk. Each one carries its own author, so each
    // one still lands.
    //
    // Stood in for here by a second tablet that has never signed in,
    // which meets the route in exactly the same state.
    server.pairingChamberId = 'popular';
    const second = await call('/api/pair', { code: server.pairingCode, label: 'a tablet that never signed in' });
    const strangerToken = String(second.body.token);
    const got = await fetch(`${base}/api/queue/desk-arrival`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-chamber-token': strangerToken },
      body: JSON.stringify({
        deskRef: 'desk-ref-0', takenBy: biplob, arrivedAt: nowIso(), visitDate: TODAY,
        serialAnnounced: 1,
        newPatient: {
          deskRef: 'desk-patient-0', fullNameBn: 'প্রথম রোগী', fullNameEn: null,
          phone: '01711000000', dob: null, approxAgeYears: 61, sex: 'male', addressFreeText: null,
        },
      }),
    });
    const body = await got.json() as Record<string, unknown>;
    assert.equal(got.status, 200, JSON.stringify(body));
    assert.equal(body.serialNo, 1);
    const row = db.prepare('SELECT created_by AS by FROM visit WHERE desk_ref = ?').get('desk-ref-0') as { by: string };
    assert.equal(row.by, biplob, 'attributed to who took it, not to the tablet that delivered it');
  });

  test('an arrival with no author is still refused, signed in or not', async () => {
    const got = await call('/api/queue/desk-arrival', {
      deskRef: 'desk-ref-nobody', takenBy: '', arrivedAt: nowIso(), visitDate: TODAY,
      serialAnnounced: 99,
      newPatient: {
        deskRef: 'desk-patient-nobody', fullNameBn: 'কেউ না', fullNameEn: null,
        phone: null, dob: null, approxAgeYears: 20, sex: 'male', addressFreeText: null,
      },
    });
    assert.equal(got.status, 400, 'a record with nobody\'s name on it must never be written');
  });


  test('the directory carries a name, a number and a last visit -- and nothing else', async () => {
    const got = await call('/api/directory', null, 'GET');
    assert.equal(got.status, 200);
    const entries = got.body.entries as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(entries));
    for (const entry of entries) {
      assert.deepEqual(Object.keys(entry).sort(),
        ['id', 'lastChamberName', 'lastVisitDate', 'nameBn', 'nameEn', 'phone', 'sBn', 'sEn', 'sPhone'],
        'nothing beyond a name, a number and when they were last seen may reach a tablet');
    }
  });

  test('three patients are registered at the desk and given numbers', async () => {
    for (let i = 2; i <= 4; i++) {
      const got = await call('/api/queue/desk-arrival', {
        deskRef: `desk-ref-${i}`, takenBy: biplob, arrivedAt: nowIso(), visitDate: TODAY,
        serialAnnounced: i,
        newPatient: {
          deskRef: `desk-patient-${i}`, fullNameBn: `রোগী ${i}`, fullNameEn: null,
          phone: `0171100000${i}`, dob: null, approxAgeYears: 30 + i, sex: 'female', addressFreeText: null,
        },
      });
      assert.equal(got.status, 200, JSON.stringify(got.body));
      assert.equal(got.body.serialNo, i);
      assert.equal(got.body.serialAnnounced, null, 'nobody had to be told a different number');
    }
  });

  test("they are on Popular's list, not Lubana's", () => {
    const popular = todaysQueue(db, 'popular', TODAY);
    const lubana = todaysQueue(db, 'lubana', TODAY);
    assert.equal(popular.length, 4);
    assert.equal(lubana.length, 0, "the laptop's own chamber must not collect the other desk's patients");
    assert.deepEqual(popular.map((e) => e.serialNo), [1, 2, 3, 4]);
  });

  test('each one carries the name of the assistant who took it', () => {
    const rows = db.prepare('SELECT created_by AS by FROM visit').all() as Array<{ by: string }>;
    for (const row of rows) assert.equal(row.by, biplob);
  });

  test('the whole evening sent a second time changes nothing', async () => {
    for (let i = 2; i <= 4; i++) {
      const again = await call('/api/queue/desk-arrival', {
        deskRef: `desk-ref-${i}`, takenBy: biplob, arrivedAt: nowIso(), visitDate: TODAY,
        serialAnnounced: i,
        newPatient: {
          deskRef: `desk-patient-${i}`, fullNameBn: `রোগী ${i}`, fullNameEn: null,
          phone: `0171100000${i}`, dob: null, approxAgeYears: 30 + i, sex: 'female', addressFreeText: null,
        },
      });
      assert.equal(again.body.alreadyHad, true);
    }
    assert.equal(todaysQueue(db, 'popular', TODAY).length, 4);
    const people = db.prepare('SELECT count(*) AS n FROM patient WHERE deleted_at IS NULL').get() as { n: number };
    assert.equal(people.n, 4, 'a resend must never double the chamber');
  });

  test('it is the whole register, not this chamber\'s', async () => {
    // A patient seen only at Lubana must be findable from the tablet at
    // Popular, or the desk registers her again and the doctor opens a
    // card with half her history on it.
    const { registerPatient } = await import('../src/main/patients/register');
    const { registerArrival } = await import('../src/main/queue/register');
    const atLubana = registerPatient(db, {
      fullNameBn: 'লুবানার রোগী', fullNameEn: null, phone: '01700000777', dob: null,
      approxAgeYears: 44, sex: 'female', addressFreeText: null,
    }, { id: biplob, role: 'front_desk' });
    registerArrival(db, atLubana, 'lubana', { id: biplob, role: 'front_desk' });

    const got = await call('/api/directory', null, 'GET');
    const entries = got.body.entries as Array<Record<string, unknown>>;
    const her = entries.find((e) => e.id === atLubana);
    assert.ok(her, 'a patient of the other chamber is still in this tablet\'s list');
    assert.equal(her!.lastChamberName, 'Lubana');
  });

  test('the session now says the register has moved on', async () => {
    const session = await call('/api/session', null, 'GET');
    const desk = session.body.deskChamber as { nextSerial: number };
    assert.equal(desk.nextSerial, 5);
  });

  test('a returning patient can be found by the number they gave', async () => {
    const got = await call('/api/patients/search', { query: '01711000002' });
    const results = got.body.results as Array<{ nameBn: string }>;
    assert.equal(results.length, 1);
    assert.equal(results[0]!.nameBn, 'রোগী 2');
  });

  test('a number the laptop took meanwhile is not given to two people', async () => {
    // The doctor added a walk-in at Popular from the laptop as serial 4
    // while the tablet was away holding an arrival it had called 4.
    const { registerPatient } = await import('../src/main/patients/register');
    const { registerArrival } = await import('../src/main/queue/register');
    const walkIn = registerPatient(db, {
      fullNameBn: 'হাঁটা রোগী', fullNameEn: null, phone: null, dob: null,
      approxAgeYears: 50, sex: 'male', addressFreeText: null,
    }, { id: biplob, role: 'front_desk' });
    registerArrival(db, walkIn, 'popular', { id: biplob, role: 'front_desk' });

    const late = await call('/api/queue/desk-arrival', {
      deskRef: 'desk-ref-late', takenBy: biplob, arrivedAt: nowIso(), visitDate: TODAY,
      serialAnnounced: 5,
      newPatient: {
        deskRef: 'desk-patient-late', fullNameBn: 'দেরিতে পৌঁছানো', fullNameEn: null,
        phone: '01711000009', dob: null, approxAgeYears: 28, sex: 'female', addressFreeText: null,
      },
    });
    assert.equal(late.body.serialNo, 6, 'they take the next free number');
    assert.equal(late.body.serialAnnounced, 5, 'and what they were told is written down');
  });

  test('and the laptop will not let that pass silently', () => {
    const clashes = unresolvedSerialClashes(db, 'popular', TODAY);
    assert.equal(clashes.length, 1);
    assert.equal(clashes[0]!.serialAnnounced, 5);
    assert.equal(clashes[0]!.serialNo, 6);
    assert.equal(clashes[0]!.nameBn, 'দেরিতে পৌঁছানো');
  });
});
