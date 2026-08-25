// ===================================================================
// Which panels the doctor has pinned to the home screen.
// ===================================================================
// One setting for the installation rather than one per person. There
// is one doctor and one laptop, and a per-person version would mean a
// schema change to answer a question nobody has asked.
//
// Reading is open to anybody signed in, because the screen has to draw
// itself. Writing is the doctor's, because it is his screen.
import { ChamberRecallError } from '../../shared/errors';
import { recordAudit, type Actor } from '../db/audit';
import { getMeta, setMeta, type Db } from '../db/open';
import { DEFAULT_HOME_PANELS, isHomePanelId, type HomePanelId } from '../../shared/home';

export class HomePanelError extends ChamberRecallError {}

const KEY = 'home_panels';

/**
 * What is pinned. A stored value that has gone bad - hand-edited, or
 * written by an older version that knew different panels - falls back
 * to the default rather than leaving the doctor with a blank screen.
 * Unknown ids are dropped one by one for the same reason.
 */
export function homePanels(db: Db): HomePanelId[] {
  const raw = getMeta(db, KEY);
  if (raw === null) return [...DEFAULT_HOME_PANELS];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [...DEFAULT_HOME_PANELS];
  }
  if (!Array.isArray(parsed)) return [...DEFAULT_HOME_PANELS];
  // An empty list is a real choice: a doctor who wants nothing but the
  // list gets nothing but the list. Only a broken value falls back.
  return parsed.filter((v): v is HomePanelId => typeof v === 'string' && isHomePanelId(v));
}

export function setHomePanels(db: Db, panels: string[], actor: Actor): HomePanelId[] {
  if (actor.role !== 'doctor' && actor.role !== 'system') {
    throw new HomePanelError(
      'Only the doctor changes what is on this screen.',
      'It is his screen. Sign out and let him sign in.',
    );
  }
  const kept = panels.filter(isHomePanelId);
  setMeta(db, KEY, JSON.stringify(kept));
  recordAudit(db, { actor, action: 'home_panels_set', entity: 'app_meta', entityId: KEY, details: { panels: kept } });
  return kept;
}
