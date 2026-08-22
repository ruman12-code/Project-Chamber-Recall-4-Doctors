// ===================================================================
// Usage events.
// ===================================================================
// These feed the pilot report, which is the screen that decides whether
// this project continues past twelve weeks.
//
// Two rules:
//   1. Never record clinical content here. Timings and actions only.
//   2. Always record actor_id. The pilot report must be able to break
//      every number out per assistant, because an average across two
//      assistants hides exactly the behaviour worth seeing.
import type { Db } from './open';
import { nowIso } from './clock';
import { newId } from './ids';

export interface UsageEventInput {
  eventType: string;
  actorId?: string | null;
  visitId?: string | null;
  durationMs?: number | null;
  /** Overrides the clock. Only the seed script should pass this. */
  timestamp?: string;
}

export function recordUsage(db: Db, event: UsageEventInput): void {
  db.prepare(
    `INSERT INTO usage_event (id, event_type, actor_id, visit_id, timestamp, duration_ms)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    newId(),
    event.eventType,
    event.actorId ?? null,
    event.visitId ?? null,
    event.timestamp ?? nowIso(),
    event.durationMs ?? null,
  );
}
