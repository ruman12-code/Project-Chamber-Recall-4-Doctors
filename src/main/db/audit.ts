// ===================================================================
// The audit log.
// ===================================================================
// Append-only, enforced by triggers in schema.sql. This file is the
// only way anything gets written into it.
//
// The rule for callers: write the audit row inside the SAME transaction
// as the change it describes. Then a change and its audit entry either
// both happen or neither does, and the log can never drift out of step
// with the records it is supposed to explain.
import type { Db } from './open';
import { nowIso } from './clock';
import type { Role } from '../../shared/roles';

export interface Actor {
  id: string | null;
  role: Role | 'system';
}

export interface AuditEntry {
  actor: Actor;
  /** Verb, past tense, lower_snake_case. e.g. 'patient_created' */
  action: string;
  /** Table name the action concerns. e.g. 'patient' */
  entity: string;
  entityId?: string | null;
  /**
   * Anything needed to understand this entry months later without the
   * surrounding code. Must never contain a password, a passphrase, or
   * the recovery key.
   */
  details?: Record<string, unknown> | null;
}

export function recordAudit(db: Db, entry: AuditEntry): void {
  db.prepare(
    `INSERT INTO audit_log (actor_role, actor_id, action, entity, entity_id, details_json, timestamp)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    entry.actor.role,
    entry.actor.id,
    entry.action,
    entry.entity,
    entry.entityId ?? null,
    entry.details === undefined || entry.details === null ? null : JSON.stringify(entry.details),
    nowIso(),
  );
}

export interface AuditRow {
  id: number;
  actor_role: string;
  actor_id: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  details_json: string | null;
  timestamp: string;
}

export function recentAudit(db: Db, limit = 50): AuditRow[] {
  return db
    .prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?')
    .all(limit) as AuditRow[];
}
