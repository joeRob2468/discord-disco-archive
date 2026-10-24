/**
 * The activity log (`audit_log`): one row per change, holding only the fields that
 * differ. Admin edits are written by the `Catalog`, recorder-side changes (new sets,
 * processing results, titles, cleanups) by the sync, so the admin feed shows both.
 */
import { now, type Db } from '../db/database.ts';

export type AuditChanges = Record<string, { from: unknown; to: unknown }>;

/** Record what changed between `before` and `after` (the keys of `after`); nothing if equal. */
export function writeAudit(
  db: Db,
  actor: string,
  entity: string,
  entityId: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): void {
  const changes: AuditChanges = {};
  for (const [key, to] of Object.entries(after)) {
    const from = before[key];
    if (JSON.stringify(from) !== JSON.stringify(to)) changes[key] = { from, to };
  }
  if (Object.keys(changes).length === 0) return;
  db.prepare(
    `INSERT INTO audit_log (at, actor, entity, entity_id, changes) VALUES (?, ?, ?, ?, ?)`,
  ).run(now(), actor, entity, entityId, JSON.stringify(changes));
}
