import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { provision } from '../src/main/db/provision';
import { nowIso } from '../src/main/db/clock';
import { addStaff } from '../src/main/auth/staff';
import { chamberCards } from '../src/main/queue/chambers';
import {
  setChamberLogo, clearChamberLogo, chamberLogoDataUri, renameChamber,
  ChamberLogoError, LOGO_MAX_BYTES,
} from '../src/main/queue/chamberLogo';
import { recentAudit } from '../src/main/db/audit';
import { tempDir } from './helpers';

const SYSTEM = { id: null, role: 'system' as const };
const PNG = Buffer.from('89504e470d0a1a0a', 'hex');

function chamber() {
  const t = tempDir();
  const { db } = provision(t.dir, 'the pilot passphrase', 'demo');
  for (const [id, name] of [['lubana', 'Lubana'], ['popular', 'Popular']]) {
    db.prepare('INSERT INTO chamber (id, name, created_at) VALUES (?, ?, ?)').run(id, name, nowIso());
  }
  const doctorId = addStaff(db, { displayName: 'Dr Test', role: 'doctor', pin: '4021' }, SYSTEM);
  return { db, doctor: { id: doctorId, role: 'doctor' as const }, cleanup: () => { db.close(); t.cleanup(); } };
}

describe('a chamber and its logo', () => {
  let c: ReturnType<typeof chamber>;
  before(() => { c = chamber(); });
  after(() => { c.cleanup(); });

  test('there is none to begin with', () => {
    assert.equal(chamberLogoDataUri(c.db, 'lubana'), null);
    assert.equal(chamberCards(c.db).find((x) => x.id === 'lubana')?.logo, null);
  });

  test('one can be set, and comes back ready for the screen', () => {
    setChamberLogo(c.db, 'lubana', PNG, 'image/png', c.doctor);
    const uri = chamberLogoDataUri(c.db, 'lubana');
    assert.ok(uri !== null && uri.startsWith('data:image/png;base64,'));
    assert.equal(uri, `data:image/png;base64,${PNG.toString('base64')}`);
  });

  test('it reaches the card the doctor actually taps', () => {
    const card = chamberCards(c.db).find((x) => x.id === 'lubana');
    assert.ok(card?.logo?.startsWith('data:image/png;base64,'));
    // And only that chamber's.
    assert.equal(chamberCards(c.db).find((x) => x.id === 'popular')?.logo, null);
  });

  test('it carries the name of whoever set it', () => {
    const row = c.db.prepare('SELECT logo_set_by AS by FROM chamber WHERE id = ?').get('lubana') as
      { by: string | null };
    assert.equal(row.by, c.doctor.id);
    assert.ok(recentAudit(c.db, 50).some((a) => a.action === 'chamber_logo_set'));
  });

  test('a picture too big to belong in every backup is refused, with the size', () => {
    assert.throws(
      () => setChamberLogo(c.db, 'popular', Buffer.alloc(LOGO_MAX_BYTES + 1), 'image/png', c.doctor),
      (e: unknown) => e instanceof ChamberLogoError && /KB/.test((e as ChamberLogoError).whatToDo),
    );
    assert.equal(chamberLogoDataUri(c.db, 'popular'), null, 'it was stored anyway');
  });

  test('a kind of file that will not display is refused', () => {
    assert.throws(
      () => setChamberLogo(c.db, 'popular', PNG, 'application/pdf', c.doctor),
      ChamberLogoError,
    );
    assert.throws(() => setChamberLogo(c.db, 'popular', Buffer.alloc(0), 'image/png', c.doctor),
      ChamberLogoError);
  });

  test('a chamber that is not there is refused rather than silently doing nothing', () => {
    assert.throws(() => setChamberLogo(c.db, 'no-such', PNG, 'image/png', c.doctor), ChamberLogoError);
  });

  test('removing it leaves the chamber, and the patients, alone', () => {
    const before_ = c.db.prepare('SELECT id, name FROM chamber WHERE id = ?').get('lubana');
    clearChamberLogo(c.db, 'lubana', c.doctor);
    assert.equal(chamberLogoDataUri(c.db, 'lubana'), null);
    assert.deepEqual(c.db.prepare('SELECT id, name FROM chamber WHERE id = ?').get('lubana'), before_);
  });
});

describe('naming a chamber', () => {
  test('the doctor’s own words, recorded with the old name beside them', () => {
    const c = chamber();
    renameChamber(c.db, 'lubana', '  Lubana Diagnostic  ', c.doctor);
    assert.equal(
      (c.db.prepare('SELECT name FROM chamber WHERE id = ?').get('lubana') as { name: string }).name,
      'Lubana Diagnostic',
      'the name was not trimmed',
    );
    const entry = recentAudit(c.db, 50).find((a) => a.action === 'chamber_renamed');
    assert.ok(entry !== undefined);
    c.cleanup();
  });

  test('two chambers may not share a name, however it is capitalised', () => {
    const c = chamber();
    assert.throws(
      () => renameChamber(c.db, 'lubana', 'popular', c.doctor),
      (e: unknown) => e instanceof ChamberLogoError && /already a chamber/.test((e as Error).message),
    );
    // Its own name is not a clash with itself.
    renameChamber(c.db, 'lubana', 'Lubana', c.doctor);
    c.cleanup();
  });

  test('an empty name is refused: it is what the doctor taps', () => {
    const c = chamber();
    assert.throws(() => renameChamber(c.db, 'lubana', '   ', c.doctor), ChamberLogoError);
    assert.equal(
      (c.db.prepare('SELECT name FROM chamber WHERE id = ?').get('lubana') as { name: string }).name,
      'Lubana',
    );
    c.cleanup();
  });
});
