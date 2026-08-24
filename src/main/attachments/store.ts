// ===================================================================
// Photographs of paper.
// ===================================================================
// A patient in a Bangladeshi chamber carries their history in a
// plastic bag. Photographing it at the desk is the cheapest way this
// system ever gets a real history - and the paper walks out of the
// door again five minutes later, so there is one chance at it.
//
// Three rules run through this file:
//
//   A picture is never altered. It goes in once, with a checksum, and
//   every read checks it. Removing one is a soft delete that records
//   who and why; the bytes stay.
//
//   Nothing is stored for a patient who said no. A photograph of
//   somebody's lab report is their health information, and the
//   permission that covers keeping a history covers this too.
//
//   The software never looks at what is IN the picture. No text is
//   read out of it, nothing is recognised, nothing is classified. It
//   is a photograph of a piece of paper, filed under a heading a
//   person chose.
import { createHash } from 'node:crypto';
import type { Db } from '../db/open';
import { newId } from '../db/ids';
import { nowIso } from '../db/clock';
import { recordAudit, type Actor } from '../db/audit';
import { recordUsage } from '../db/usage';
import { ChamberRecallError } from '../../shared/errors';
import { consentState } from '../consent/store';

export class AttachmentError extends ChamberRecallError {}

export const ATTACHMENT_KINDS = ['report', 'prescription_scan', 'old_paper_file', 'image'] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

/**
 * The biggest picture that will be accepted.
 *
 * The tablet shrinks a photograph to about 300 KB before sending it,
 * so this is not a limit anybody meets in normal use: it is there so a
 * mistake - a video, a raw camera file, a 40-megapixel scan - is
 * refused with a sentence rather than filling the database.
 */
export const MAX_BYTES = 8 * 1024 * 1024;

export interface NewAttachment {
  patientId: string;
  visitId: string | null;
  kind: AttachmentKind;
  caption: string | null;
  /** The date written on the paper, if anybody typed it. */
  documentDate: string | null;
  content: Buffer;
  contentType: 'image/jpeg' | 'image/png';
  width: number | null;
  height: number | null;
  source: 'tablet' | 'laptop';
}

export interface AttachmentView {
  id: string;
  patientId: string;
  visitId: string | null;
  kind: AttachmentKind;
  caption: string | null;
  documentDate: string | null;
  capturedAt: string;
  byteSize: number;
  contentType: string;
  width: number | null;
  height: number | null;
  source: string;
  addedByName: string | null;
  visitDate: string | null;
}

function looksLikeAnImage(content: Buffer, contentType: string): boolean {
  // The first bytes of the file, checked against what the caller says
  // it is. Not a security boundary - it is here so a file that is not
  // a picture at all is caught at the desk rather than showing up as a
  // grey box in the chamber three weeks later.
  if (contentType === 'image/jpeg') {
    return content.length > 3 && content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff;
  }
  if (contentType === 'image/png') {
    return content.length > 8 && content[0] === 0x89 && content[1] === 0x50
      && content[2] === 0x4e && content[3] === 0x47;
  }
  return false;
}

/**
 * Refuses to file anything for a patient who has said no, or who has
 * never been asked.
 *
 * The permission that covers keeping a history is the same permission
 * that covers keeping a photograph of their report. There is no
 * separate consent for this and there should not be one: it would be
 * a second question at a desk, about the same thing.
 */
function requireConsent(db: Db, patientId: string, consentVersion: string | null): void {
  if (consentVersion === null) return;
  const state = consentState(db, patientId, consentVersion);
  if (state.careRecord === 'declined') {
    throw new AttachmentError(
      'This patient asked for no history to be kept, so their papers cannot be photographed.',
      'Hand the paper back. Nothing about them is being recorded.',
    );
  }
  if (state.careRecord === 'withdrawn') {
    throw new AttachmentError(
      'This patient has withdrawn permission, so nothing further can be recorded for them.',
      'Hand the paper back, and tell the doctor they have withdrawn permission.',
    );
  }
}

export function addAttachment(
  db: Db, input: NewAttachment, actor: Actor,
  options: { consentVersion?: string | null; at?: string } = {},
): string {
  if (actor.id === null) {
    throw new AttachmentError(
      'Nobody is signed in, so this photograph cannot be recorded against anyone.',
      'Sign in and take it again.',
    );
  }
  const at = options.at ?? nowIso();

  const patient = db.prepare('SELECT id FROM patient WHERE id = ? AND deleted_at IS NULL').get(input.patientId);
  if (patient === undefined) {
    throw new AttachmentError('That patient record is not there.', 'Search for the patient again.');
  }
  requireConsent(db, input.patientId, options.consentVersion ?? null);

  if (input.content.length === 0) {
    throw new AttachmentError(
      'The photograph did not arrive.',
      'Nothing was saved. Take it again — the paper is still with the patient.',
    );
  }
  if (input.content.length > MAX_BYTES) {
    throw new AttachmentError(
      `That file is ${(input.content.length / 1024 / 1024).toFixed(1)} MB, which is bigger than this will accept.`,
      'Photograph the paper with the tablet rather than sending a file from somewhere else. Nothing was saved.',
    );
  }
  if (!looksLikeAnImage(input.content, input.contentType)) {
    throw new AttachmentError(
      'That file is not a photograph.',
      'Only pictures can be filed here, in JPEG or PNG. Nothing was saved.',
    );
  }
  if (!ATTACHMENT_KINDS.includes(input.kind)) {
    throw new AttachmentError('That is not one of the kinds of paper this files.', 'Choose one from the list.');
  }

  const id = newId();
  const sha256 = createHash('sha256').update(input.content).digest('hex');

  const write = db.transaction(() => {
    db.prepare(
      `INSERT INTO attachment (id, patient_id, visit_id, kind, caption, document_date, captured_at,
         content, content_type, byte_size, sha256, width, height, source, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, input.patientId, input.visitId, input.kind,
      input.caption === null || input.caption.trim() === '' ? null : input.caption.trim(),
      input.documentDate, at,
      input.content, input.contentType, input.content.length, sha256,
      input.width, input.height, input.source, at, actor.id);

    // The picture itself is never written to the audit log - it is in
    // the record already, and a log full of photographs is a log
    // nobody can read.
    recordAudit(db, {
      actor, action: 'attachment_added', entity: 'attachment', entityId: id,
      details: { patient_id: input.patientId, visit_id: input.visitId, kind: input.kind, bytes: input.content.length, source: input.source },
    });
  });
  write();

  recordUsage(db, {
    eventType: 'attachment_added', actorId: actor.id, visitId: input.visitId, timestamp: at,
  });
  return id;
}

const VIEW_COLUMNS = `
  a.id, a.patient_id AS patientId, a.visit_id AS visitId, a.kind, a.caption,
  a.document_date AS documentDate, a.captured_at AS capturedAt, a.byte_size AS byteSize,
  a.content_type AS contentType, a.width, a.height, a.source,
  u.display_name AS addedByName, v.visit_date AS visitDate`;

function toView(row: Record<string, unknown>): AttachmentView {
  return {
    id: String(row.id),
    patientId: String(row.patientId),
    visitId: row.visitId as string | null,
    kind: row.kind as AttachmentKind,
    caption: row.caption as string | null,
    documentDate: row.documentDate as string | null,
    capturedAt: String(row.capturedAt),
    byteSize: Number(row.byteSize),
    contentType: String(row.contentType),
    width: row.width as number | null,
    height: row.height as number | null,
    source: String(row.source),
    addedByName: row.addedByName as string | null,
    visitDate: row.visitDate as string | null,
  };
}

/**
 * Everything filed for this patient, newest first by the date on the
 * paper where there is one, and by when it was photographed otherwise.
 */
export function attachmentsFor(db: Db, patientId: string): AttachmentView[] {
  return (db.prepare(
    `SELECT ${VIEW_COLUMNS}
     FROM attachment a
     LEFT JOIN app_user u ON u.id = a.created_by
     LEFT JOIN visit v ON v.id = a.visit_id
     WHERE a.patient_id = ? AND a.deleted_at IS NULL
     ORDER BY coalesce(a.document_date, a.captured_at) DESC, a.captured_at DESC`,
  ).all(patientId) as Array<Record<string, unknown>>).map(toView);
}

export function attachmentsForVisit(db: Db, visitId: string): AttachmentView[] {
  return (db.prepare(
    `SELECT ${VIEW_COLUMNS}
     FROM attachment a
     LEFT JOIN app_user u ON u.id = a.created_by
     LEFT JOIN visit v ON v.id = a.visit_id
     WHERE a.visit_id = ? AND a.deleted_at IS NULL
     ORDER BY a.captured_at`,
  ).all(visitId) as Array<Record<string, unknown>>).map(toView);
}

/**
 * The picture, with its checksum checked.
 *
 * A file that does not match what was stored is a corrupted record,
 * not a picture to display anyway. It is reported in a sentence that
 * says what is wrong, because a doctor looking at a grey box would
 * reasonably assume the photograph was simply bad.
 */
export function attachmentContent(db: Db, id: string): { content: Buffer; contentType: string; view: AttachmentView } {
  const row = db.prepare(
    `SELECT ${VIEW_COLUMNS}, a.content, a.sha256
     FROM attachment a
     LEFT JOIN app_user u ON u.id = a.created_by
     LEFT JOIN visit v ON v.id = a.visit_id
     WHERE a.id = ? AND a.deleted_at IS NULL`,
  ).get(id) as Record<string, unknown> | undefined;

  if (row === undefined) {
    throw new AttachmentError(
      'That photograph is not there.',
      'It may have been removed. Go back to the list and look again.',
    );
  }
  const content = row.content as Buffer;
  const actual = createHash('sha256').update(content).digest('hex');
  if (actual !== row.sha256) {
    throw new AttachmentError(
      'This photograph does not match what was saved, so it is not being shown.',
      'The records file may be damaged. Do not rely on anything else from this patient until somebody has checked it, and restore from the most recent backup.',
    );
  }
  return { content, contentType: String(row.contentType), view: toView(row) };
}

/**
 * Removing a photograph.
 *
 * Soft only, with a reason, because it is part of a medical record.
 * The commonest real use is a picture of the wrong patient's paper,
 * and that has to be takeable off the record - visibly, with a name
 * against it, rather than by making it disappear.
 */
export function removeAttachment(db: Db, id: string, reason: string, actor: Actor, at: string = nowIso()): void {
  if (actor.id === null) {
    throw new AttachmentError(
      'Nobody is signed in, so this cannot be recorded against anyone.',
      'Sign in and try again.',
    );
  }
  if (reason.trim() === '') {
    throw new AttachmentError(
      'Say why this photograph is being taken off the record.',
      'A photograph is part of a medical record. One sentence is enough — "wrong patient", "unreadable" — and it stays with it.',
    );
  }
  const row = db.prepare('SELECT patient_id AS patientId FROM attachment WHERE id = ? AND deleted_at IS NULL')
    .get(id) as { patientId: string } | undefined;
  if (row === undefined) return;

  const write = db.transaction(() => {
    db.prepare('UPDATE attachment SET deleted_at = ?, deleted_by = ?, deleted_reason = ? WHERE id = ?')
      .run(at, actor.id, reason.trim(), id);
    recordAudit(db, {
      actor, action: 'attachment_removed', entity: 'attachment', entityId: id,
      details: { patient_id: row.patientId, reason: reason.trim() },
    });
  });
  write();
}
