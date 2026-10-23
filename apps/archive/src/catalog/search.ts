/**
 * Full-text search over sets (FTS5). The index is small, so it's rebuilt wholesale after
 * a sync and per affected set after an edit.
 */
import type { Db } from '../db/database.ts';

/** Reduce free text to an FTS5 query: every word must match, as a prefix. */
export function toMatchQuery(input: string): string | undefined {
  const words = input.match(/[\p{L}\p{N}]+/gu);
  if (!words) return undefined;
  return words.map((word) => `"${word}"*`).join(' ');
}

const INSERT_FROM_VIEW = `
  INSERT INTO set_search (set_id, names, titles, description, tags)
  SELECT v.id,
         v.name || ' ' || v.recorded_name,
         COALESCE(v.title, '') || ' ' || v.session_title,
         COALESCE(v.description, ''),
         COALESCE(v.tags, '')
  FROM set_view v`;

export function reindexAll(db: Db): void {
  db.exec(`DELETE FROM set_search; ${INSERT_FROM_VIEW};`);
}

export function reindexSets(db: Db, setIds: readonly string[]): void {
  if (setIds.length === 0) return;
  const ids = JSON.stringify(setIds);
  db.transaction(() => {
    db.prepare(`DELETE FROM set_search WHERE set_id IN (SELECT value FROM json_each(?))`).run(ids);
    db.prepare(`${INSERT_FROM_VIEW} WHERE v.id IN (SELECT value FROM json_each(?))`).run(ids);
  })();
}
