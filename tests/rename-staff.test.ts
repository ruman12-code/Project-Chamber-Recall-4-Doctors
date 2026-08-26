import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { provision } from '../src/main/db/provision';
import { nowIso, localDate } from '../src/main/db/clock';
import { addStaff, renameStaff, allStaff, StaffError } from '../src/main/auth/staff';
import { signIn } from '../src/main/auth/session';
import { registerPatient } from '../src/main/patients/register';
import { registerArrival } from '../src/main/queue/register';
import { recentAudit } from '../src/main/db/audit';
import { tempDir } from './helpers';

const SYSTEM = { id: null, role: 'system' as const };

function chamber() {
  const t = tempDir();
  const { db } = provision(t.dir, 'the pilot passphrase', 'demo');
  db.prepare('INSERT INTO chamber (id, name, created_at) VALUES (?, ?, ?)')
    .run('lubana', 'Lubana', nowIso());
  const doctorId = addStaff(db, { displayName: 'Doctor Strange', role: 'doctor', pin: '4021' }, SYSTEM);
  const doctor = { id: doctorId, role: 'doctor' as const };
  const deskId = addStaff(db, { displayName: 'Spiderman', role: 'front_desk', pin: '6172' }, doctor);
  return { db, doctor, doctorId, deskId, cleanup: () => { db.close(); t.cleanup(); } };
}

describe('correcting somebody’s name', () => {
  let c: ReturnType<typeof chamber>;
  before(() => { c = chamber(); });
  after(() => { c.cleanup(); });

  test('the name changes', () => {
    renameStaff(c.db, c.doctorId, 'Prof. Dr. Maruf Bin Habib', c.doctor);
    assert.equal(
      allStaff(c.db).find((p) => p.id === c.doctorId)?.displayName,
      'Prof. Dr. Maruf Bin Habib',
    );
  });

  test('it is the SAME person — the records follow them', () => {
    // Work done under the old name.
    const patientId = registerPatient(c.db, {
      fullNameBn: 'রোগী', fullNameEn: null, phone: null, dob: null,
      approxAgeYears: 40, sex: 'male', addressFreeText: null,
    }, { id: c.deskId, role: 'front_desk' });
    registerArrival(c.db, patientId, 'lubana', { id: c.deskId, role: 'front_desk' });

    renameStaff(c.db, c.deskId, 'Ruhul (Lubana)', c.doctor);

    // Same id, so every record still points at them, now spelt right.
    const written = c.db.prepare('SELECT created_by AS by FROM patient WHERE id = ?')
      .get(patientId) as { by: string };
    assert.equal(written.by, c.deskId, 'the record lost its author');
    assert.equal(
      (c.db.prepare('SELECT display_name AS n FROM app_user WHERE id = ?')
        .get(written.by) as { n: string }).n,
      'Ruhul (Lubana)',
    );
  });

  test('their PIN still works — it is not a new account', () => {
    assert.equal(signIn(c.db, c.deskId, '6172').displayName, 'Ruhul (Lubana)');
  });

  test('both spellings are in the audit, so an old record can be explained', () => {
    const entry = recentAudit(c.db, 200).find(
      (a) => a.action === 'user_renamed' && a.entity_id === c.deskId,
    );
    assert.ok(entry !== undefined, 'a rename was not written down');
    const details = JSON.parse(String(entry!.details_json ?? '{}')) as { from?: string; to?: string };
    assert.equal(details.from, 'Spiderman');
    assert.equal(details.to, 'Ruhul (Lubana)');
  });

  test('surrounding space is tidied, and doubled spaces collapse', () => {
    renameStaff(c.db, c.deskId, '  Ruhul   (Lubana)  ', c.doctor);
    assert.equal(
      allStaff(c.db).find((p) => p.id === c.deskId)?.displayName, 'Ruhul (Lubana)',
    );
  });

  test('an empty name is refused: it goes on every record they write', () => {
    assert.throws(() => renameStaff(c.db, c.deskId, '   ', c.doctor), StaffError);
    assert.equal(allStaff(c.db).find((p) => p.id === c.deskId)?.displayName, 'Ruhul (Lubana)');
  });

  test('two people may not end up with the same name', () => {
    assert.throws(
      () => renameStaff(c.db, c.deskId, 'prof. dr. maruf bin habib', c.doctor),
      (e: unknown) => e instanceof StaffError && /already here/.test((e as Error).message),
    );
  });

  test('renaming somebody to what they are already called does nothing', () => {
    const before_ = recentAudit(c.db, 200).filter((a) => a.action === 'user_renamed').length;
    renameStaff(c.db, c.deskId, 'Ruhul (Lubana)', c.doctor);
    assert.equal(
      recentAudit(c.db, 200).filter((a) => a.action === 'user_renamed').length, before_,
      'a rename that changed nothing was written to the record',
    );
  });

  test('somebody who is not here is refused', () => {
    assert.throws(() => renameStaff(c.db, 'nobody', 'Anybody', c.doctor), StaffError);
  });

  test('only a doctor may do it', () => {
    assert.throws(
      () => renameStaff(c.db, c.doctorId, 'Somebody Else', { id: c.deskId, role: 'front_desk' }),
      StaffError,
    );
  });
});
