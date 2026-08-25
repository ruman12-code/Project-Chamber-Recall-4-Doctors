import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { provision } from '../src/main/db/provision';
import type { Db } from '../src/main/db/open';
import { nowIso, localDate } from '../src/main/db/clock';
import { registerPatient } from '../src/main/patients/register';
import { registerArrival, setVisitStatus } from '../src/main/queue/register';
import { chamberCards } from '../src/main/queue/chambers';
import { addStaff } from '../src/main/auth/staff';
import { tempDir } from './helpers';

const SYSTEM = { id: null, role: 'system' as const };
const TODAY = localDate();

function twoChambers() {
  const t = tempDir();
  const { db } = provision(t.dir, 'the pilot passphrase', 'demo');
  for (const [id, name] of [['popular', 'Popular'], ['lubana', 'Lubana']]) {
    db.prepare('INSERT INTO chamber (id, name, created_at) VALUES (?, ?, ?)').run(id, name, nowIso());
  }
  const doctor = addStaff(db, { displayName: 'Dr Test', role: 'doctor', pin: '4021' }, SYSTEM);
  return { db, actor: { id: doctor, role: 'doctor' as const }, cleanup: t.cleanup };
}

function arrive(db: Db, chamberId: string, name: string, actor: { id: string; role: 'doctor' },
  kind: 'consultation' | 'reports_only' = 'consultation') {
  const id = registerPatient(db, {
    fullNameBn: name, fullNameEn: null, phone: null, dob: null,
    approxAgeYears: 40, sex: 'female', addressFreeText: null,
  }, actor);
  return registerArrival(db, id, chamberId, actor, { visitKind: kind }).visitId;
}

describe('the chambers, as the doctor sees them when he sits down', () => {
  let c: ReturnType<typeof twoChambers>;
  before(() => { c = twoChambers(); });
  after(() => { c.db.close(); c.cleanup(); });

  test('both chambers appear, even the one nobody has come to', () => {
    const cards = chamberCards(c.db, TODAY);
    assert.deepEqual(cards.map((x) => x.name), ['Popular', 'Lubana']);
    for (const card of cards) {
      assert.equal(card.waiting, 0);
      assert.equal(card.seen, 0);
      assert.equal(card.tabletPaired, false);
    }
  });

  test('each chamber counts its own people and nobody else’s', () => {
    arrive(c.db, 'popular', 'পপুলার এক', c.actor);
    arrive(c.db, 'popular', 'পপুলার দুই', c.actor);
    arrive(c.db, 'lubana', 'লুবানা এক', c.actor);

    const cards = chamberCards(c.db, TODAY);
    assert.equal(cards.find((x) => x.name === 'Popular')!.waiting, 2);
    assert.equal(cards.find((x) => x.name === 'Lubana')!.waiting, 1);
  });

  test('somebody with the doctor is counted apart from those waiting', () => {
    const visitId = arrive(c.db, 'lubana', 'লুবানা দুই', c.actor);
    setVisitStatus(c.db, visitId, 'in_chamber', c.actor);
    const lubana = chamberCards(c.db, TODAY).find((x) => x.name === 'Lubana')!;
    assert.equal(lubana.waiting, 1);
    assert.equal(lubana.withDoctor, 1);
    assert.equal(lubana.seen, 0);
  });

  test('and once seen, counted as seen', () => {
    const lubanaBefore = chamberCards(c.db, TODAY).find((x) => x.name === 'Lubana')!;
    const visit = c.db.prepare(
      `SELECT id FROM visit WHERE chamber_id = 'lubana' AND status = 'in_chamber'`,
    ).get() as { id: string };
    setVisitStatus(c.db, visit.id, 'done', c.actor);
    const after = chamberCards(c.db, TODAY).find((x) => x.name === 'Lubana')!;
    assert.equal(after.withDoctor, 0);
    assert.equal(after.seen, lubanaBefore.seen + 1);
  });

  test('patients here to show a report are counted separately', () => {
    arrive(c.db, 'popular', 'রিপোর্ট', c.actor, 'reports_only');
    const popular = chamberCards(c.db, TODAY).find((x) => x.name === 'Popular')!;
    assert.equal(popular.reportsOnly, 1);
    assert.equal(popular.waiting, 3, 'still waiting like anybody else');
  });

  test('the longest wait is on the card, so he can see which room to open', () => {
    const popular = chamberCards(c.db, TODAY).find((x) => x.name === 'Popular')!;
    assert.ok(popular.longestWaitMinutes !== null);
    assert.ok(popular.longestWaitMinutes! >= 0);
  });

  test('a chamber with nobody waiting reports no longest wait', () => {
    const t = tempDir();
    const { db } = provision(t.dir, 'passphrase', 'demo');
    db.prepare('INSERT INTO chamber (id, name, created_at) VALUES (?, ?, ?)')
      .run('empty', 'Empty', nowIso());
    const card = chamberCards(db, TODAY)[0]!;
    assert.equal(card.longestWaitMinutes, null);
    assert.equal(card.flagged, 0);
    db.close(); t.cleanup();
  });

  test('a tablet paired here but never heard from does not count as connected', () => {
    c.db.prepare(
      `INSERT INTO tablet_device (id, label, token_hash, paired_at, chamber_id)
       VALUES ('t1', 'Biplob', 'hash', ?, 'popular')`,
    ).run(nowIso());
    assert.equal(chamberCards(c.db, TODAY).find((x) => x.name === 'Popular')!.tabletPaired, false);
  });

  test('and once it has been heard from, it does', () => {
    c.db.prepare('UPDATE tablet_device SET last_seen_at = ? WHERE id = ?').run(nowIso(), 't1');
    assert.equal(chamberCards(c.db, TODAY).find((x) => x.name === 'Popular')!.tabletPaired, true);
  });

  test('a revoked tablet stops counting as connected', () => {
    c.db.prepare('UPDATE tablet_device SET revoked_at = ? WHERE id = ?').run(nowIso(), 't1');
    assert.equal(chamberCards(c.db, TODAY).find((x) => x.name === 'Popular')!.tabletPaired, false);
  });
});
