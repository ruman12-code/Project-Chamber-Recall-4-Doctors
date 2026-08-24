import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { provision } from '../src/main/db/provision';
import { newId } from '../src/main/db/ids';
import { nowIso } from '../src/main/db/clock';
import type { Db } from '../src/main/db/open';
import { addStaff } from '../src/main/auth/staff';
import { recordConsent, withdrawConsent } from '../src/main/consent/store';
import {
  addAttachment, attachmentsFor, attachmentsForVisit, attachmentContent, removeAttachment,
  AttachmentError, MAX_BYTES,
} from '../src/main/attachments/store';
import { tempDir } from './helpers';

/**
 * Milestone 11. Photographs of the paper a patient carries in.
 *
 * What these hold in place: a picture is never altered, never stored
 * for somebody who said no, and never shown when it does not match
 * what was saved.
 */

const system = { id: null, role: 'system' as const };
const CHAMBER = 'chamber-a';
const TODAY = '2026-08-24';
const CONSENT_VERSION = 'consent-v1';

/** The first bytes of a real JPEG, which is what the check looks at. */
function aJpeg(size = 512): Buffer {
  const buffer = Buffer.alloc(size, 0x20);
  buffer[0] = 0xff; buffer[1] = 0xd8; buffer[2] = 0xff; buffer[3] = 0xe0;
  return buffer;
}
function aPng(): Buffer {
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
}

function chamber() {
  const t = tempDir();
  const db = provision(t.dir, 'passphrase', 'demo').db;
  const doctorId = addStaff(db, { displayName: 'Dr Ashraful', role: 'doctor', pin: '4021' }, system);
  const deskId = addStaff(db, { displayName: 'Biplob', role: 'front_desk', pin: '6172' }, { id: doctorId, role: 'doctor' });
  db.prepare('INSERT INTO chamber (id, name, created_at) VALUES (?, ?, ?)').run(CHAMBER, 'Popular Chamber', nowIso());
  return {
    db, cleanup: t.cleanup,
    doctor: { id: doctorId, role: 'doctor' as const },
    desk: { id: deskId, role: 'front_desk' as const },
  };
}

let serial = 0;
function newPatient(db: Db, createdBy: string): { patientId: string; visitId: string } {
  const patientId = newId();
  db.prepare(`INSERT INTO patient (id, full_name_bn, full_name_en, search_name_en, phone,
                approx_age_years, approx_age_recorded_on, sex, created_at, created_by, updated_at)
              VALUES (?, 'তাসলিমা', 'Taslima', 'taslima', '01711000000', 40, ?, 'female', ?, ?, ?)`)
    .run(patientId, TODAY, nowIso(), createdBy, nowIso());
  serial += 1;
  const visitId = newId();
  db.prepare(`INSERT INTO visit (id, patient_id, chamber_id, visit_date, serial_no, arrived_at, status,
                created_at, created_by, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, 'waiting', ?, ?, ?)`)
    .run(visitId, patientId, CHAMBER, TODAY, serial, `${TODAY}T17:00:00.000Z`, nowIso(), createdBy, nowIso());
  return { patientId, visitId };
}

function aPaper(patientId: string, visitId: string | null, over: Partial<Parameters<typeof addAttachment>[1]> = {}) {
  return {
    patientId, visitId,
    kind: 'report' as const,
    caption: null,
    documentDate: null,
    content: aJpeg(),
    contentType: 'image/jpeg' as const,
    width: 1600, height: 1200,
    source: 'tablet' as const,
    ...over,
  };
}

describe('filing a photograph', () => {
  let c: ReturnType<typeof chamber>;
  before(() => { c = chamber(); });
  after(() => { c.db.close(); c.cleanup(); });

  test('a photograph is kept with who took it and which visit', () => {
    const { patientId, visitId } = newPatient(c.db, c.desk.id);
    addAttachment(c.db, aPaper(patientId, visitId), c.desk);
    const [filed] = attachmentsFor(c.db, patientId);
    assert.equal(filed!.kind, 'report');
    assert.equal(filed!.addedByName, 'Biplob');
    assert.equal(filed!.visitId, visitId);
    assert.equal(filed!.source, 'tablet');
    assert.equal(filed!.byteSize, 512);
  });

  test('the picture comes back exactly as it went in', () => {
    const { patientId, visitId } = newPatient(c.db, c.desk.id);
    const original = aJpeg(2048);
    const id = addAttachment(c.db, aPaper(patientId, visitId, { content: original }), c.desk);
    const { content, contentType } = attachmentContent(c.db, id);
    assert.equal(Buffer.compare(content, original), 0);
    assert.equal(contentType, 'image/jpeg');
  });

  test('a PNG is accepted too, and anything else is not', () => {
    const { patientId, visitId } = newPatient(c.db, c.desk.id);
    addAttachment(c.db, aPaper(patientId, visitId, { content: aPng(), contentType: 'image/png' }), c.desk);
    assert.throws(
      () => addAttachment(c.db, aPaper(patientId, visitId, { content: Buffer.from('%PDF-1.4 not a picture') }), c.desk),
      AttachmentError,
    );
  });

  test('a file claiming to be a JPEG but not starting like one is refused', () => {
    const { patientId, visitId } = newPatient(c.db, c.desk.id);
    assert.throws(
      () => addAttachment(c.db, aPaper(patientId, visitId, { content: Buffer.alloc(400, 7) }), c.desk),
      AttachmentError,
    );
  });

  test('an empty upload is refused, and says the paper is still in their hand', () => {
    const { patientId, visitId } = newPatient(c.db, c.desk.id);
    try {
      addAttachment(c.db, aPaper(patientId, visitId, { content: Buffer.alloc(0) }), c.desk);
      assert.fail('an empty photograph was filed');
    } catch (error) {
      assert.ok(error instanceof AttachmentError);
      assert.match(error.whatToDo, /still with the patient/i);
    }
  });

  test('something far too big is refused rather than filling the records', () => {
    const { patientId, visitId } = newPatient(c.db, c.desk.id);
    const huge = aJpeg(MAX_BYTES + 1);
    assert.throws(() => addAttachment(c.db, aPaper(patientId, visitId, { content: huge }), c.desk), AttachmentError);
  });

  test('nothing is filed against nobody', () => {
    const { patientId, visitId } = newPatient(c.db, c.desk.id);
    assert.throws(
      () => addAttachment(c.db, aPaper(patientId, visitId), { id: null, role: 'front_desk' }),
      AttachmentError,
    );
  });

  test('a photograph can belong to the patient without belonging to a visit', () => {
    const { patientId } = newPatient(c.db, c.desk.id);
    addAttachment(c.db, aPaper(patientId, null), c.desk);
    assert.equal(attachmentsFor(c.db, patientId).length, 1);
  });

  test('the papers taken at one visit can be listed on their own', () => {
    const { patientId, visitId } = newPatient(c.db, c.desk.id);
    addAttachment(c.db, aPaper(patientId, visitId), c.desk);
    addAttachment(c.db, aPaper(patientId, visitId, { kind: 'prescription_scan' }), c.desk);
    addAttachment(c.db, aPaper(patientId, null), c.desk);
    assert.equal(attachmentsForVisit(c.db, visitId).length, 2);
    assert.equal(attachmentsFor(c.db, patientId).length, 3);
  });

  test('the date on the paper is what orders the list, not the day it was photographed', () => {
    const { patientId, visitId } = newPatient(c.db, c.desk.id);
    addAttachment(c.db, aPaper(patientId, visitId, { documentDate: '2019-03-01', caption: 'old' }), c.desk);
    addAttachment(c.db, aPaper(patientId, visitId, { documentDate: '2024-11-20', caption: 'newer' }), c.desk);
    const captions = attachmentsFor(c.db, patientId).map((a) => a.caption);
    assert.deepEqual(captions, ['newer', 'old']);
  });

  test('filing one is recorded, and the picture itself never reaches the log', () => {
    const { patientId, visitId } = newPatient(c.db, c.desk.id);
    const id = addAttachment(c.db, aPaper(patientId, visitId), c.desk);
    const row = c.db.prepare(
      `SELECT details_json AS details FROM audit_log WHERE action = 'attachment_added' AND entity_id = ?`,
    ).get(id) as { details: string };
    assert.match(row.details, /"kind":"report"/);
    assert.ok(row.details.length < 400, 'the audit log must not fill up with photographs');
  });
});

describe('a patient who said no', () => {
  let c: ReturnType<typeof chamber>;
  before(() => { c = chamber(); });
  after(() => { c.db.close(); c.cleanup(); });

  const given = (patientId: string, decision: 'given' | 'declined') => recordConsent(c.db, {
    patientId, kind: 'care_record', version: CONSENT_VERSION, decision,
    givenBy: 'self', givenByName: null, relationship: null, method: 'read_aloud', language: 'bn',
  }, c.desk);

  test('nothing is photographed for somebody who declined', () => {
    const { patientId, visitId } = newPatient(c.db, c.desk.id);
    given(patientId, 'declined');
    try {
      addAttachment(c.db, aPaper(patientId, visitId), c.desk, { consentVersion: CONSENT_VERSION });
      assert.fail('a paper was filed for a patient who declined');
    } catch (error) {
      assert.ok(error instanceof AttachmentError);
      assert.match(error.whatToDo, /hand the paper back/i);
    }
  });

  test('nothing further is photographed after permission is withdrawn', () => {
    const { patientId, visitId } = newPatient(c.db, c.desk.id);
    given(patientId, 'given');
    addAttachment(c.db, aPaper(patientId, visitId), c.desk, { consentVersion: CONSENT_VERSION });
    withdrawConsent(c.db, patientId, 'care_record', c.doctor, 'asked at the desk');
    assert.throws(
      () => addAttachment(c.db, aPaper(patientId, visitId), c.desk, { consentVersion: CONSENT_VERSION }),
      AttachmentError,
    );
    // What was already filed stays: it is a medical record, and
    // destroying it is the doctor's decision to document, not a
    // side effect of a tap at the front desk.
    assert.equal(attachmentsFor(c.db, patientId).length, 1);
  });

  test('a patient who agreed is photographed as normal', () => {
    const { patientId, visitId } = newPatient(c.db, c.desk.id);
    given(patientId, 'given');
    addAttachment(c.db, aPaper(patientId, visitId), c.desk, { consentVersion: CONSENT_VERSION });
    assert.equal(attachmentsFor(c.db, patientId).length, 1);
  });
});

describe('a photograph on the record', () => {
  let c: ReturnType<typeof chamber>;
  before(() => { c = chamber(); });
  after(() => { c.db.close(); c.cleanup(); });

  test('the picture cannot be swapped for a different one', () => {
    const { patientId, visitId } = newPatient(c.db, c.desk.id);
    const id = addAttachment(c.db, aPaper(patientId, visitId), c.desk);
    const different = aJpeg(600);
    assert.throws(
      () => c.db.prepare('UPDATE attachment SET content = ?, sha256 = ? WHERE id = ?')
        .run(different, createHash('sha256').update(different).digest('hex'), id),
      /never replaced/,
    );
  });

  test('it cannot be deleted outright', () => {
    const { patientId, visitId } = newPatient(c.db, c.desk.id);
    const id = addAttachment(c.db, aPaper(patientId, visitId), c.desk);
    assert.throws(() => c.db.prepare('DELETE FROM attachment WHERE id = ?').run(id), /never deleted/);
  });

  test('a picture that does not match what was saved is reported, not shown', () => {
    const { patientId, visitId } = newPatient(c.db, c.desk.id);
    const id = addAttachment(c.db, aPaper(patientId, visitId), c.desk);
    // Real corruption arrives from the disk rather than through SQL,
    // so the trigger that normally forbids this is stood down for a
    // moment to produce the same state a damaged file would.
    c.db.exec('DROP TRIGGER attachment_content_is_never_replaced');
    c.db.prepare('UPDATE attachment SET sha256 = ? WHERE id = ?').run('0'.repeat(64), id);
    c.db.exec(`CREATE TRIGGER attachment_content_is_never_replaced
      BEFORE UPDATE ON attachment
      WHEN NEW.content IS NOT OLD.content OR NEW.sha256 <> OLD.sha256
      BEGIN
        SELECT RAISE(ABORT, 'the picture in an attachment is never replaced: add another one instead');
      END`);
    try {
      attachmentContent(c.db, id);
      assert.fail('a photograph that did not match was handed back anyway');
    } catch (error) {
      assert.ok(error instanceof AttachmentError);
      assert.match(error.userMessage, /does not match/);
      assert.match(error.whatToDo, /backup/i);
    }
  });

  test('taking one off the record needs a reason, and keeps it', () => {
    const { patientId, visitId } = newPatient(c.db, c.desk.id);
    const id = addAttachment(c.db, aPaper(patientId, visitId), c.desk);
    assert.throws(() => removeAttachment(c.db, id, '   ', c.doctor), AttachmentError);

    removeAttachment(c.db, id, 'wrong patient', c.doctor);
    assert.equal(attachmentsFor(c.db, patientId).length, 0);

    const row = c.db.prepare(
      'SELECT deleted_reason AS reason, deleted_by AS by, content IS NOT NULL AS kept FROM attachment WHERE id = ?',
    ).get(id) as { reason: string; by: string; kept: number };
    assert.equal(row.reason, 'wrong patient');
    assert.equal(row.by, c.doctor.id);
    assert.equal(row.kept, 1, 'the picture stays in the record even when it is taken off the list');
  });

  test('one taken off the record cannot be opened', () => {
    const { patientId, visitId } = newPatient(c.db, c.desk.id);
    const id = addAttachment(c.db, aPaper(patientId, visitId), c.desk);
    removeAttachment(c.db, id, 'unreadable', c.doctor);
    assert.throws(() => attachmentContent(c.db, id), AttachmentError);
  });

  test('removing is recorded with the reason', () => {
    const { patientId, visitId } = newPatient(c.db, c.desk.id);
    const id = addAttachment(c.db, aPaper(patientId, visitId), c.desk);
    removeAttachment(c.db, id, 'photographed twice', c.doctor);
    const row = c.db.prepare(
      `SELECT details_json AS details FROM audit_log WHERE action = 'attachment_removed' AND entity_id = ?`,
    ).get(id) as { details: string };
    assert.match(row.details, /photographed twice/);
  });
});
