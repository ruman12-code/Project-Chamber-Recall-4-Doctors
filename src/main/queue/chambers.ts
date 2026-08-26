// ===================================================================
// The chambers, as the doctor sees them when he sits down.
// ===================================================================
// He holds two on the same evening. The first thing he does when he
// opens the laptop is not choose a menu item -- it is answer "which
// room am I in", and everything after that follows from it: whose list
// he sees, and which tablet is his desk.
//
// So that question is the first screen, and each chamber carries enough
// on it to tell him what he is walking into before he taps.
import { sessionDate } from '../db/clock';
import type { Db } from '../db/open';
import { chamberLogoDataUri } from './chamberLogo';

export interface ChamberCard {
  id: string;
  name: string;
  waiting: number;
  withDoctor: number;
  seen: number;
  /** Screening warnings not yet acknowledged. The reason to pick this
   *  chamber first if both have people in them. */
  flagged: number;
  /** Here to show a test the doctor asked for last time. */
  reportsOnly: number;
  /** How long the person who has waited longest has been waiting. */
  longestWaitMinutes: number | null;
  /** A tablet is paired to this chamber and has been heard from. */
  tabletPaired: boolean;
  /** The chamber's own logo, ready for an <img src>. Null if none. */
  logo: string | null;
}

export function chamberCards(db: Db, visitDate: string = sessionDate()): ChamberCard[] {
  const chambers = db.prepare(
    'SELECT id, name FROM chamber WHERE deleted_at IS NULL ORDER BY created_at',
  ).all() as Array<{ id: string; name: string }>;

  return chambers.map((chamber) => {
    const counts = db.prepare(
      `SELECT
         sum(CASE WHEN status = 'waiting' THEN 1 ELSE 0 END) AS waiting,
         sum(CASE WHEN status = 'in_chamber' THEN 1 ELSE 0 END) AS withDoctor,
         sum(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS seen,
         sum(CASE WHEN visit_kind = 'reports_only' AND status IN ('waiting','in_chamber')
                  THEN 1 ELSE 0 END) AS reportsOnly,
         min(CASE WHEN status = 'waiting' THEN arrived_at ELSE NULL END) AS earliestWaiting
       FROM visit
       WHERE chamber_id = ? AND visit_date = ? AND deleted_at IS NULL`,
    ).get(chamber.id, visitDate) as {
      waiting: number | null; withDoctor: number | null; seen: number | null;
      reportsOnly: number | null; earliestWaiting: string | null;
    };

    const flagged = (db.prepare(
      `SELECT count(DISTINCT v.id) AS n
         FROM visit v
         JOIN intake i ON i.visit_id = v.id
         JOIN red_flag_event e ON e.intake_id = i.id
        WHERE v.chamber_id = ? AND v.visit_date = ? AND v.deleted_at IS NULL
          AND v.status IN ('waiting', 'in_chamber')
          AND e.acknowledged_at IS NULL`,
    ).get(chamber.id, visitDate) as { n: number }).n;

    const tablet = db.prepare(
      `SELECT count(*) AS n FROM tablet_device
        WHERE chamber_id = ? AND revoked_at IS NULL AND last_seen_at IS NOT NULL`,
    ).get(chamber.id) as { n: number };

    return {
      id: chamber.id,
      name: chamber.name,
      waiting: counts.waiting ?? 0,
      withDoctor: counts.withDoctor ?? 0,
      seen: counts.seen ?? 0,
      flagged,
      reportsOnly: counts.reportsOnly ?? 0,
      longestWaitMinutes: counts.earliestWaiting === null ? null
        : Math.max(0, Math.round((Date.now() - Date.parse(counts.earliestWaiting)) / 60000)),
      tabletPaired: tablet.n > 0,
      logo: chamberLogoDataUri(db, chamber.id),
    };
  });
}
