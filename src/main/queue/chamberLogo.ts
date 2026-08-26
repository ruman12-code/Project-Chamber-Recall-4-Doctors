// ===================================================================
// The chamber's own mark.
// ===================================================================
// Two large cards, and the doctor picks one before he does anything
// else. Words are slower to tell apart than a logo he has seen on the
// door of the building every week for four years, so the card carries
// the logo if there is one.
//
// The bytes live in the database beside everything else, so they are
// inside the encryption and inside the backup. See migration 017.
import { ChamberRecallError } from '../../shared/errors';
import { recordAudit, type Actor } from '../db/audit';
import { nowIso } from '../db/clock';
import type { Db } from '../db/open';

export class ChamberLogoError extends ChamberRecallError {}

/**
 * Small on purpose. A logo is shown at about 120 points on one screen;
 * anything above this is a photograph somebody picked by mistake, and
 * quietly accepting it would put megabytes into every backup from now
 * on for no gain at all.
 */
export const LOGO_MAX_BYTES = 512 * 1024;

export const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml'] as const;
export type LogoType = (typeof LOGO_TYPES)[number];

export function setChamberLogo(
  db: Db, chamberId: string, content: Buffer, contentType: string, actor: Actor,
): void {
  const chamber = db.prepare(
    'SELECT id, name FROM chamber WHERE id = ? AND deleted_at IS NULL',
  ).get(chamberId) as { id: string; name: string } | undefined;
  if (chamber === undefined) {
    throw new ChamberLogoError('That chamber is not here.', 'Go back and choose one from the list.');
  }
  if (!(LOGO_TYPES as readonly string[]).includes(contentType)) {
    throw new ChamberLogoError(
      'That kind of picture cannot be used.',
      'Choose a PNG, a JPEG, or an SVG. Most logos are one of those already.',
    );
  }
  if (content.byteLength === 0) {
    throw new ChamberLogoError('That file is empty.', 'Choose the picture again.');
  }
  if (content.byteLength > LOGO_MAX_BYTES) {
    throw new ChamberLogoError(
      `That picture is too big (${Math.round(content.byteLength / 1024)} KB).`,
      `A logo needs to be under ${Math.round(LOGO_MAX_BYTES / 1024)} KB. It is shown small on one screen — a photograph is not needed, and a large one goes into every backup from now on.`,
    );
  }

  const at = nowIso();
  const write = db.transaction(() => {
    db.prepare(
      `UPDATE chamber SET logo = ?, logo_content_type = ?, logo_set_at = ?, logo_set_by = ?
        WHERE id = ?`,
    ).run(content, contentType, at, actor.id, chamberId);
    recordAudit(db, {
      actor, action: 'chamber_logo_set', entity: 'chamber', entityId: chamberId,
      details: { name: chamber.name, content_type: contentType, bytes: content.byteLength },
    });
  });
  write();
}

export function clearChamberLogo(db: Db, chamberId: string, actor: Actor): void {
  db.prepare(
    `UPDATE chamber SET logo = NULL, logo_content_type = NULL, logo_set_at = NULL, logo_set_by = NULL
      WHERE id = ?`,
  ).run(chamberId);
  recordAudit(db, {
    actor, action: 'chamber_logo_cleared', entity: 'chamber', entityId: chamberId,
  });
}

/** Ready to put straight in an <img src>. Null when there is no logo. */
export function chamberLogoDataUri(db: Db, chamberId: string): string | null {
  const row = db.prepare(
    'SELECT logo, logo_content_type AS contentType FROM chamber WHERE id = ? AND deleted_at IS NULL',
  ).get(chamberId) as { logo: Buffer | null; contentType: string | null } | undefined;
  if (row === undefined || row.logo === null || row.contentType === null) return null;
  return `data:${row.contentType};base64,${row.logo.toString('base64')}`;
}

/** Renaming a chamber. The doctor's own words, on his own cards. */
export function renameChamber(db: Db, chamberId: string, name: string, actor: Actor): void {
  const trimmed = name.trim();
  if (trimmed === '') {
    throw new ChamberLogoError(
      'A chamber needs a name.',
      'This is what the doctor taps to choose which room he is in, so it has to say something.',
    );
  }
  const clash = db.prepare(
    'SELECT id FROM chamber WHERE lower(name) = lower(?) AND id <> ? AND deleted_at IS NULL',
  ).get(trimmed, chamberId);
  if (clash !== undefined) {
    throw new ChamberLogoError(
      `There is already a chamber called "${trimmed}".`,
      'Two chambers with the same name on screen is how an evening gets worked against the wrong list.',
    );
  }
  const before = db.prepare('SELECT name FROM chamber WHERE id = ?').get(chamberId) as
    { name: string } | undefined;
  if (before === undefined) {
    throw new ChamberLogoError('That chamber is not here.', 'Go back and choose one from the list.');
  }
  db.prepare('UPDATE chamber SET name = ? WHERE id = ?').run(trimmed, chamberId);
  recordAudit(db, {
    actor, action: 'chamber_renamed', entity: 'chamber', entityId: chamberId,
    details: { from: before.name, to: trimmed },
  });
}
