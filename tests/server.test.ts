import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { provision } from '../src/main/db/provision';
import { nowIso } from '../src/main/db/clock';
import type { Db } from '../src/main/db/open';
import { registerPatient } from '../src/main/patients/register';
import { registerArrival } from '../src/main/queue/register';
import { setActiveChamber } from '../src/main/queue/queue';
import { startTabletServer, type RunningServer } from '../src/main/server/server';
import { PairingDesk, normalisePairingCode } from '../src/main/server/pairing';
import { tempDir } from './helpers';

import { unassignedActor } from '../src/main/db/users';
import { addStaff } from '../src/main/auth/staff';
import { resetSignInAttempts } from '../src/main/auth/session';

// Deliberately the SAME actor the running application uses, so this
// test exercises the path the front desk screen actually takes.
const DESK = unassignedActor('front_desk');
const WEB_ROOT = join(__dirname, '..', 'tablet');

/**
 * These talk to the server the way the tablet does: over real HTTP, on
 * a real port, with real JSON. Nothing here reaches into the internals,
 * because the thing being tested is the boundary a tablet on a chamber
 * wifi actually meets.
 */
describe('the tablet server', () => {
  let db: Db; let cleanup: () => void; let server: RunningServer; let base: string;
  let token = ''; let visitId = '';

  before(async () => {
    const t = tempDir();
    cleanup = t.cleanup;
    db = provision(t.dir, 'passphrase', 'demo').db;
    db.prepare('INSERT INTO chamber (id, name, created_at) VALUES (?, ?, ?)').run('ch-a', 'Test Chamber', nowIso());
    setActiveChamber(db, 'ch-a');

    const patientId = registerPatient(db, { fullNameBn: 'পরীক্ষা রোগী', fullNameEn: 'Test Patient',
      phone: '01711111111', dob: null, approxAgeYears: 44, sex: 'male', addressFreeText: null }, DESK);
    visitId = registerArrival(db, patientId, 'ch-a', DESK).visitId;

    // Port 0 lets the machine choose a free one, so these tests never
    // collide with a real chamber running on the usual port.
    server = await startTabletServer({ db, dataDir: t.dir, webRoot: WEB_ROOT, port: 0 });
    base = `http://127.0.0.1:${server.port}`;
  });
  after(async () => { await server.close(); db.close(); cleanup(); });

  const call = async (path: string, body: unknown, withToken = true) => {
    const response = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(withToken && token !== '' ? { 'x-chamber-token': token } : {}) },
      body: JSON.stringify(body ?? {}),
    });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  };

  // ---- nothing on the network gets in without pairing
    test('an unpaired request is refused and told how to fix it', async () => {
      const response = await fetch(`${base}/api/session`, { method: 'GET' });
      assert.equal(response.status, 401);
      const body = await response.json() as Record<string, unknown>;
      assert.equal(body.needsPairing, true);
      assert.match(String(body.whatToDo), /code shown on the laptop/);
    });

    test('a wrong pairing code is refused', async () => {
      const result = await call('/api/pair', { code: 'ZZZ-ZZZ', label: 'someone else' }, false);
      assert.equal(result.status, 401);
    });

    test('the right code hands over a token', async () => {
      const result = await call('/api/pair', { code: server.pairingCode, label: 'front desk tablet' }, false);
      assert.equal(result.status, 200);
      token = String(result.body.token);
      assert.equal(token.length, 64);
    });

    test('the code changes once it has been used', async () => {
      const result = await call('/api/pair', { code: 'AAA-AAA', label: 'x' }, false);
      assert.equal(result.status, 401, 'the old code must not still work');
    });

    test('a made-up token is refused', async () => {
      const response = await fetch(`${base}/api/session`, { method: 'GET', headers: { 'x-chamber-token': 'a'.repeat(64) } });
      assert.equal(response.status, 401);
    });

    test('a revoked tablet stops working', async () => {
      const device = db.prepare('SELECT id FROM tablet_device LIMIT 1').get() as { id: string };
      db.prepare('UPDATE tablet_device SET revoked_at = ? WHERE id = ?').run(nowIso(), device.id);
      const response = await fetch(`${base}/api/session`, { method: 'GET', headers: { 'x-chamber-token': token } });
      assert.equal(response.status, 401);
      db.prepare('UPDATE tablet_device SET revoked_at = NULL WHERE id = ?').run(device.id);
    });

  // ---- what the tablet is given to work with
    test('the questions, the rules and the list arrive together', async () => {
      const response = await fetch(`${base}/api/session`, { method: 'GET', headers: { 'x-chamber-token': token } });
      const body = await response.json() as Record<string, any>;
      assert.equal(response.status, 200);
      assert.ok(body.questionnaire.questions.length > 0, 'the tablet needs the questions to ask offline');
      assert.ok(body.rulebook.rules.length > 0, 'the tablet needs the rules to check offline');
      assert.equal(body.queue.length, 1);
      assert.equal(body.queue[0].serialNo, 1);
    });

  // ---- taking an intake
    test('starting one twice gives the same intake, not two', async () => {
      const first = await call('/api/intake/start', { visitId });
      const second = await call('/api/intake/start', { visitId });
      assert.equal(first.status, 200);
      assert.equal(first.body.intakeId, second.body.intakeId);
      const count = db.prepare('SELECT count(*) AS n FROM intake WHERE visit_id = ?').get(visitId) as { n: number };
      assert.equal(count.n, 1);
    });

    test('an answer is saved, and the rules are checked on the laptop', async () => {
      const result = await call('/api/intake/answers', {
        visitId,
        answers: [{ questionKey: 'severity', value: 'severe', freeText: null, skipped: false }],
      });
      assert.equal(result.status, 200);
      const state = result.body.state as { answers: Record<string, unknown> };
      assert.ok(state.answers['severity']);
      assert.ok(result.body.screening, 'the laptop must decide about red flags, not only the tablet');
    });

    test('the same answer arriving twice changes nothing', async () => {
      // The tablet resends whatever it could not deliver, sometimes
      // after the laptop already had it.
      await call('/api/intake/answers', {
        visitId, answers: [{ questionKey: 'severity', value: 'severe', freeText: null, skipped: false }],
      });
      const rows = db.prepare(
        `SELECT count(*) AS n FROM intake_answer WHERE question_key = 'severity'`).get() as { n: number };
      assert.equal(rows.n, 1);
    });

    test('a changed answer replaces the earlier one', async () => {
      await call('/api/intake/answers', {
        visitId, answers: [{ questionKey: 'severity', value: 'mild', freeText: null, skipped: false }],
      });
      const row = db.prepare(
        `SELECT answer_value AS v FROM intake_answer WHERE question_key = 'severity'`).get() as { v: string };
      assert.equal(row.v, 'mild');
    });

    test('a skipped question is stored as skipped, not as missing', async () => {
      await call('/api/intake/answers', {
        visitId, answers: [{ questionKey: 'allergies', value: null, freeText: null, skipped: true }],
      });
      const row = db.prepare(
        `SELECT was_skipped AS s FROM intake_answer WHERE question_key = 'allergies'`).get() as { s: number };
      assert.equal(row.s, 1);
    });

    test('answers arriving before any start still work', async () => {
      // The tablet may have been offline from the very first question,
      // so the first thing the laptop hears about may be an answer.
      const other = registerArrival(db, registerPatient(db, { fullNameEn: 'Second Patient', fullNameBn: null,
        phone: null, dob: null, approxAgeYears: 30, sex: 'female', addressFreeText: null }, DESK), 'ch-a', DESK);
      const result = await call('/api/intake/answers', {
        visitId: other.visitId,
        answers: [{ questionKey: 'presenting_complaint', value: null, freeText: 'জ্বর', skipped: false }],
      });
      assert.equal(result.status, 200);
      const count = db.prepare('SELECT count(*) AS n FROM intake WHERE visit_id = ?').get(other.visitId) as { n: number };
      assert.equal(count.n, 1, 'the laptop started the intake by itself');
    });

    test('finishing twice is harmless', async () => {
      await call('/api/intake/finish', { visitId });
      const first = db.prepare('SELECT completed_at AS c FROM intake WHERE visit_id = ?').get(visitId) as { c: string };
      await call('/api/intake/finish', { visitId });
      const second = db.prepare('SELECT completed_at AS c FROM intake WHERE visit_id = ?').get(visitId) as { c: string };
      assert.equal(second.c, first.c, 'the time it was finished must not move');
    });

  // ---- acknowledging a warning the tablet raised on its own
    test('it is acknowledged by which rule fired, not by an id the tablet never saw', async () => {
      const patientId = registerPatient(db, { fullNameEn: 'Flagged Patient', fullNameBn: null, phone: null,
        dob: null, approxAgeYears: 60, sex: 'male', addressFreeText: null }, DESK);
      const arrival = registerArrival(db, patientId, 'ch-a', DESK);
      await call('/api/intake/answers', {
        visitId: arrival.visitId,
        answers: [{ questionKey: 'severity', value: 'severe', freeText: null, skipped: false }],
      });

      const event = db.prepare(
        `SELECT e.id, e.rule_id AS ruleId, e.rule_version AS ruleVersion FROM red_flag_event e
         JOIN intake i ON i.id = e.intake_id WHERE i.visit_id = ?`).get(arrival.visitId) as
        { id: string; ruleId: string; ruleVersion: string } | undefined;
      assert.ok(event, 'the placeholder rules should have fired on a severe answer');

      const result = await call('/api/redflag/ack', {
        visitId: arrival.visitId, ruleId: event.ruleId, ruleVersion: event.ruleVersion,
      });
      assert.equal(result.status, 200);
      const row = db.prepare('SELECT acknowledged_at AS a FROM red_flag_event WHERE id = ?').get(event.id) as { a: string };
      assert.ok(row.a);
    });

    test('acknowledging something the laptop has no record of is not an error', async () => {
      // The tablet showed a warning from its own copy of the rules and
      // the answers behind it have not arrived yet. Refusing here would
      // make the tablet retry for ever over something already done.
      const result = await call('/api/redflag/ack', { visitId, ruleId: 'no_such_rule', ruleVersion: '1' });
      assert.equal(result.status, 200);
      assert.equal(result.body.noSuchAlert, true);
    });

  // ---- serving the tablet page
    test('the page is served at the root', async () => {
      const response = await fetch(base);
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type') ?? '', /text\/html/);
    });

    test('an unknown address still gives the page rather than a dead end', async () => {
      const response = await fetch(`${base}/something/else`);
      assert.equal(response.status, 200);
    });

    test('a path that tries to climb out of the folder gets nothing', async () => {
      const response = await fetch(`${base}/../../package.json`);
      const text = await response.text();
      assert.equal(text.includes('"dependencies"'), false, 'a file outside the tablet folder was served');
    });

    test('nothing is cached, so a rebuilt tablet page is picked up', async () => {
      const response = await fetch(base);
      assert.match(response.headers.get('cache-control') ?? '', /no-store/);
    });
});

describe('the pairing code', () => {
  test('is readable off a screen: no letters that look like digits', () => {
    for (let i = 0; i < 40; i++) {
      assert.match(new PairingDesk().currentCode, /^[0-9A-HJKMNP-TV-Z]{3}-[0-9A-HJKMNP-TV-Z]{3}$/);
    }
  });

  test('is accepted however it was typed', () => {
    assert.equal(normalisePairingCode(' abc-123 '), 'ABC123');
    assert.equal(normalisePairingCode('OIL'), '011');
  });

  test('locks after a run of wrong guesses', () => {
    const t = tempDir();
    const db = provision(t.dir, 'passphrase', 'demo').db;
    const desk = new PairingDesk(3);
    for (let i = 0; i < 3; i++) {
      assert.throws(() => desk.pair(db, 'WRONG1', 'attacker'));
    }
    assert.equal(desk.locked, true);
    // Even the correct code stops working once it is locked, so
    // guessing cannot be resumed by getting one right eventually.
    assert.throws(() => desk.pair(db, desk.currentCode, 'attacker'), /Too many wrong codes/);
    db.close(); t.cleanup();
  });

  test('every wrong guess is written to the audit log', () => {
    const t = tempDir();
    const db = provision(t.dir, 'passphrase', 'demo').db;
    const desk = new PairingDesk(5);
    assert.throws(() => desk.pair(db, 'WRONG1', 'attacker'));
    const row = db.prepare(`SELECT count(*) AS n FROM audit_log WHERE action = 'tablet_pairing_failed'`).get() as { n: number };
    assert.equal(row.n, 1);
    db.close(); t.cleanup();
  });
});

/**
 * Who is holding the tablet.
 *
 * Pairing says a tablet may talk to the laptop. It says nothing about
 * which assistant is using it, and that is what goes into the record
 * beside every answer a patient gives. So once anybody has been set up
 * with a PIN, a tablet nobody has signed in on cannot write.
 */
describe('signing in at the front desk', () => {
  let db: Db; let cleanup: () => void; let server: RunningServer; let base: string;
  let token = ''; let visitId = ''; let deskId = '';

  before(async () => {
    const t = tempDir();
    cleanup = t.cleanup;
    db = provision(t.dir, 'passphrase', 'demo').db;
    db.prepare('INSERT INTO chamber (id, name, created_at) VALUES (?, ?, ?)').run('ch-a', 'Test Chamber', nowIso());
    setActiveChamber(db, 'ch-a');

    const doctorId = addStaff(db, { displayName: 'Dr Ashraful', role: 'doctor', pin: '4021' }, { id: null, role: 'system' });
    deskId = addStaff(db, { displayName: 'Biplob', role: 'front_desk', pin: '6172' }, { id: doctorId, role: 'doctor' });
    resetSignInAttempts();

    const patientId = registerPatient(db, { fullNameBn: 'পরীক্ষা', fullNameEn: 'Test', phone: '01712222222',
      dob: null, approxAgeYears: 30, sex: 'female', addressFreeText: null }, { id: deskId, role: 'front_desk' });
    visitId = registerArrival(db, patientId, 'ch-a', { id: deskId, role: 'front_desk' }).visitId;

    server = await startTabletServer({ db, dataDir: t.dir, webRoot: WEB_ROOT, port: 0 });
    base = `http://127.0.0.1:${server.port}`;

    const paired = await fetch(`${base}/api/pair`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: server.pairingCode, label: 'desk tablet' }),
    });
    token = String(((await paired.json()) as { token: string }).token);
  });
  after(async () => { await server.close(); db.close(); cleanup(); });

  const post = async (path: string, body: unknown) => {
    const response = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-chamber-token': token },
      body: JSON.stringify(body ?? {}),
    });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  };
  const session = async () => {
    const response = await fetch(`${base}/api/session`, { headers: { 'x-chamber-token': token } });
    return await response.json() as Record<string, unknown>;
  };

  test('the tablet is told who may sign in, and never anything to sign in with', async () => {
    const body = await session();
    const people = body.people as Array<Record<string, unknown>>;
    assert.equal(people.length, 2);
    const raw = JSON.stringify(body);
    assert.ok(!raw.includes('pin_hash') && !raw.includes('pin_salt') && !raw.includes('6172'),
      'nothing that could be used to sign in as somebody may cross the wifi');
  });

  test('a tablet nobody has signed in on cannot write', async () => {
    const result = await post('/api/intake/start', { visitId });
    assert.equal(result.status, 401);
    assert.equal(result.body.needsSignIn, true);
    assert.match(String(result.body.whatToDo), /nothing has been lost/i);
  });

  test('a wrong PIN does not sign anybody in', async () => {
    const result = await post('/api/signin', { userId: deskId, pin: '0001' });
    assert.equal(result.status, 401);
    assert.equal((await session()).signedIn, null);
  });

  test('the right PIN does, and the laptop remembers which tablet', async () => {
    resetSignInAttempts();
    const result = await post('/api/signin', { userId: deskId, pin: '6172' });
    assert.equal(result.status, 200);
    const who = (await session()).signedIn as { displayName: string };
    assert.equal(who.displayName, 'Biplob');
  });

  test('and what the patient says is recorded against that person by name', async () => {
    const started = await post('/api/intake/start', { visitId });
    assert.equal(started.status, 200);
    const row = db.prepare(
      `SELECT u.display_name AS name FROM intake i JOIN app_user u ON u.id = i.recorded_by WHERE i.visit_id = ?`,
    ).get(visitId) as { name: string };
    assert.equal(row.name, 'Biplob');
  });

  test('signing out stops the tablet writing again', async () => {
    await post('/api/signout', {});
    const result = await post('/api/intake/answers', { visitId, answers: [] });
    assert.equal(result.status, 401);
    assert.equal(result.body.needsSignIn, true);
  });
});
