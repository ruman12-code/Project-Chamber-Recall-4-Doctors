import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { provision } from '../src/main/db/provision';
import { setMeta, type Db } from '../src/main/db/open';
import { recentAudit } from '../src/main/db/audit';
import { addStaff } from '../src/main/auth/staff';
import { homePanels, setHomePanels, HomePanelError } from '../src/main/home/panels';
import { HOME_PANELS, DEFAULT_HOME_PANELS, panelsForRole, isHomePanelId } from '../src/shared/home';
import { tempDir } from './helpers';

const SYSTEM = { id: null, role: 'system' as const };

describe('what is on the home screen', () => {
  let db: Db; let cleanup: () => void; let doctorId: string; let deskId: string;
  before(() => {
    const t = tempDir(); cleanup = t.cleanup;
    db = provision(t.dir, 'the pilot passphrase', 'demo').db;
    doctorId = addStaff(db, { displayName: 'Dr Test', role: 'doctor', pin: '4021' }, SYSTEM);
    deskId = addStaff(db, { displayName: 'Biplob', role: 'front_desk', pin: '6172' },
      { id: doctorId, role: 'doctor' });
  });
  after(() => { db.close(); cleanup(); });

  test('a fresh installation has the four an ordinary evening wants', () => {
    assert.deepEqual(homePanels(db), DEFAULT_HOME_PANELS);
  });

  test('the doctor chooses, and the choice sticks', () => {
    setHomePanels(db, ['recall_card', 'pilot_report'], { id: doctorId, role: 'doctor' });
    assert.deepEqual(homePanels(db), ['recall_card', 'pilot_report']);
  });

  test('choosing nothing is a real choice, not a broken setting', () => {
    // A doctor who wants nothing but today's list gets nothing but
    // today's list. This must not silently spring back to the default.
    setHomePanels(db, [], { id: doctorId, role: 'doctor' });
    assert.deepEqual(homePanels(db), []);
  });

  test('nobody else changes his screen', () => {
    assert.throws(() => setHomePanels(db, ['database'], { id: deskId, role: 'front_desk' }),
      HomePanelError);
    assert.throws(() => setHomePanels(db, ['database'], { id: 'x', role: 'clinical_assistant' }),
      HomePanelError);
  });

  test('a panel this program has never heard of is dropped, not stored', () => {
    setHomePanels(db, ['recall_card', 'open_the_pod_bay_doors'], { id: doctorId, role: 'doctor' });
    assert.deepEqual(homePanels(db), ['recall_card']);
  });

  test('a setting damaged by hand falls back rather than showing a blank screen', () => {
    setMeta(db, 'home_panels', 'this is not json');
    assert.deepEqual(homePanels(db), DEFAULT_HOME_PANELS);
    setMeta(db, 'home_panels', '{"not":"an array"}');
    assert.deepEqual(homePanels(db), DEFAULT_HOME_PANELS);
  });

  test('the change is recorded, like every other setting', () => {
    setHomePanels(db, ['backup'], { id: doctorId, role: 'doctor' });
    const entry = recentAudit(db).find((e) => e.action === 'home_panels_set');
    assert.ok(entry);
    assert.match(entry!.details_json!, /backup/);
  });
});

describe('who may see which panel', () => {
  test('the front desk is never offered anything clinical', () => {
    const theirs = panelsForRole('front_desk').map((p) => p.id);
    assert.ok(!theirs.includes('recall_card'), 'the Recall Card is not for the desk');
    assert.ok(!theirs.includes('patient_copy'));
    assert.ok(!theirs.includes('pilot_report'));
    assert.ok(!theirs.includes('who_works_here'));
  });

  test('only the doctor manages people', () => {
    assert.ok(panelsForRole('doctor').some((p) => p.id === 'who_works_here'));
    assert.ok(!panelsForRole('clinical_assistant').some((p) => p.id === 'who_works_here'));
  });

  test('every panel names at least one role, or it could never be seen', () => {
    for (const panel of HOME_PANELS) {
      assert.ok(panel.roles.length > 0, `${panel.id} can never appear for anybody`);
    }
  });

  test('every default is a panel that exists', () => {
    for (const id of DEFAULT_HOME_PANELS) assert.ok(isHomePanelId(id));
  });

  test('every default is one the doctor is allowed to see', () => {
    const his = panelsForRole('doctor').map((p) => p.id);
    for (const id of DEFAULT_HOME_PANELS) {
      assert.ok(his.includes(id), `${id} is pinned by default but the doctor may not see it`);
    }
  });
});
