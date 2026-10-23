/**
 * Read and edit access to the archive database. Routes talk to this class only; SQL
 * stays here. "Unlisted" means hidden by an edit, hidden by the recorder, or missing
 * from disk. Only admins see unlisted items.
 */
import { setFilesSchema, type SetFiles, type SetStatus } from '@dsr/core';
import { now, type Db } from '../db/database.ts';
import { reindexSets, toMatchQuery } from './search.ts';

export const PAGE_SIZE = 24;

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pages: number;
}

export interface SessionSummary {
  id: string;
  dir: string;
  title: string;
  /** Title from the recorder (`/record start title:`), if any. */
  recordedTitle: string | undefined;
  /** Title set in the archive, if any. */
  editedTitle: string | undefined;
  description: string | undefined;
  channelName: string;
  startedByName: string;
  startedAt: string;
  endedAt: string | undefined;
  hidden: boolean;
  missing: boolean;
  unlisted: boolean;
  visibleSets: number;
  totalSets: number;
}

export interface SetSummary {
  id: string;
  sessionId: string;
  sessionTitle: string;
  sessionStartedAt: string;
  sessionDir: string;
  userId: string;
  position: number;
  /** Effective name: set edit, then streamer edit, then the recorded display name. */
  name: string;
  recordedName: string;
  /** Name set on this set specifically, if any. */
  editedName: string | undefined;
  title: string | undefined;
  description: string | undefined;
  avatarUrl: string | undefined;
  startedAt: string;
  endedAt: string | undefined;
  durationSeconds: number | undefined;
  partial: boolean;
  status: SetStatus;
  files: SetFiles;
  hidden: boolean;
  /** Visibility set in the archive; `undefined` follows the recorder. */
  hiddenOverride: boolean | undefined;
  unlisted: boolean;
  tags: string[];
}

export interface StreamerSummary {
  userId: string;
  name: string;
  recordedName: string;
  editedName: string | undefined;
  avatarUrl: string | undefined;
  bio: string | undefined;
  links: string[];
  setCount: number;
  lastPlayedAt: string | undefined;
}

export interface TagCount {
  tag: string;
  count: number;
}

export interface AuditEntry {
  at: string;
  actor: string;
  entity: string;
  entityId: string;
  changes: Record<string, { from: unknown; to: unknown }>;
}

export interface SearchParams {
  q?: string | undefined;
  tag?: string | undefined;
  userId?: string | undefined;
  /** Inclusive `YYYY-MM-DD` bounds on the session date. */
  from?: string | undefined;
  to?: string | undefined;
  page?: number | undefined;
}

export interface SessionPatch {
  title?: string | null;
  description?: string | null;
  hidden?: boolean;
}

export interface SetPatch {
  title?: string | null;
  displayName?: string | null;
  description?: string | null;
  /** `null` reverts to the recorder's value. */
  hidden?: boolean | null;
  tags?: string[];
}

export interface StreamerPatch {
  displayName?: string | null;
  bio?: string | null;
  links?: string[];
}

export class NotFoundError extends Error {
  constructor(entity: string, id: string) {
    super(`${entity} ${id} not found`);
    this.name = 'NotFoundError';
  }
}

// --- Row shapes (as returned by SQLite) and mapping -------------------------------------

interface SessionRow {
  id: string;
  dir: string;
  display_title: string;
  recorded_title: string | null;
  title: string | null;
  description: string | null;
  channel_name: string;
  started_by_name: string;
  started_at: string;
  ended_at: string | null;
  hidden: number;
  missing: number;
  unlisted: number;
  visible_sets: number;
  total_sets: number;
}

interface SetRow {
  id: string;
  session_id: string;
  session_title: string;
  session_started_at: string;
  session_dir: string;
  user_id: string;
  position: number;
  name: string;
  recorded_name: string;
  edited_name: string | null;
  title: string | null;
  description: string | null;
  avatar_url: string | null;
  started_at: string;
  ended_at: string | null;
  partial: number;
  status: SetStatus;
  files: string;
  hidden: number;
  hidden_override: number | null;
  unlisted: number;
  tags: string | null;
}

interface StreamerRow {
  user_id: string;
  name: string;
  recorded_name: string;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  links: string;
  set_count: number;
  last_played_at: string | null;
}

const opt = <T>(value: T | null): T | undefined => value ?? undefined;

function toSession(row: SessionRow): SessionSummary {
  return {
    id: row.id,
    dir: row.dir,
    title: row.display_title,
    recordedTitle: opt(row.recorded_title),
    editedTitle: opt(row.title),
    description: opt(row.description),
    channelName: row.channel_name,
    startedByName: row.started_by_name,
    startedAt: row.started_at,
    endedAt: opt(row.ended_at),
    hidden: row.hidden === 1,
    missing: row.missing === 1,
    unlisted: row.unlisted === 1,
    visibleSets: row.visible_sets,
    totalSets: row.total_sets,
  };
}

function toSet(row: SetRow): SetSummary {
  const endedAt = opt(row.ended_at);
  return {
    id: row.id,
    sessionId: row.session_id,
    sessionTitle: row.session_title,
    sessionStartedAt: row.session_started_at,
    sessionDir: row.session_dir,
    userId: row.user_id,
    position: row.position,
    name: row.name,
    recordedName: row.recorded_name,
    editedName: opt(row.edited_name),
    title: opt(row.title),
    description: opt(row.description),
    avatarUrl: opt(row.avatar_url),
    startedAt: row.started_at,
    endedAt,
    durationSeconds:
      endedAt === undefined
        ? undefined
        : Math.round((Date.parse(endedAt) - Date.parse(row.started_at)) / 1000),
    partial: row.partial === 1,
    status: row.status,
    files: setFilesSchema.parse(JSON.parse(row.files)),
    hidden: row.hidden === 1,
    hiddenOverride: row.hidden_override === null ? undefined : row.hidden_override === 1,
    unlisted: row.unlisted === 1,
    tags: row.tags ? row.tags.split(',').sort() : [],
  };
}

function toStreamer(row: StreamerRow): StreamerSummary {
  return {
    userId: row.user_id,
    name: row.name,
    recordedName: row.recorded_name,
    editedName: opt(row.display_name),
    avatarUrl: opt(row.avatar_url),
    bio: opt(row.bio),
    links: JSON.parse(row.links) as string[],
    setCount: row.set_count,
    lastPlayedAt: opt(row.last_played_at),
  };
}

function toPage<T>(items: T[], total: number, page: number): Page<T> {
  return { items, total, page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

// --- Input normalisation ----------------------------------------------------------------

/** Trim; blank becomes `null` ("use the recorded value"). */
const cleanText = (value: string | null | undefined, max: number): string | null => {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed.slice(0, max);
};

/** Lowercase, `a-z0-9 -` only, deduplicated, at most 20. */
export function normalizeTags(tags: readonly string[]): string[] {
  const cleaned = tags
    .map((tag) =>
      tag
        .toLowerCase()
        .replace(/[^\p{L}\p{N} -]+/gu, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 32),
    )
    .filter((tag) => tag !== '');
  return [...new Set(cleaned)].sort().slice(0, 20);
}

export function normalizeLinks(links: readonly string[]): string[] {
  return links
    .map((link) => link.trim())
    .filter((link) => URL.canParse(link) && /^https?:/.test(link))
    .slice(0, 10);
}

const STREAMER_SELECT = `
  SELECT st.user_id, st.recorded_name, st.display_name, st.avatar_url, st.bio, st.links,
         COALESCE(st.display_name, st.recorded_name) AS name,
         count(v.id) AS set_count,
         max(v.session_started_at) AS last_played_at
  FROM streamers st
  LEFT JOIN set_view v ON v.user_id = st.user_id AND (@all OR NOT v.unlisted)`;

export class Catalog {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  // --- Reads ----------------------------------------------------------------------------

  listSessions(page: number, includeUnlisted: boolean): Page<SessionSummary> {
    const all = includeUnlisted ? 1 : 0;
    const total = this.#db
      .prepare(`SELECT count(*) AS n FROM session_view WHERE @all OR NOT unlisted`)
      .pluck()
      .get({ all }) as number;
    const rows = this.#db
      .prepare(
        `SELECT * FROM session_view WHERE @all OR NOT unlisted
         ORDER BY started_at DESC LIMIT @limit OFFSET @offset`,
      )
      .all({ all, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }) as SessionRow[];
    return toPage(rows.map(toSession), total, page);
  }

  getSession(id: string, includeUnlisted: boolean): SessionSummary | undefined {
    const row = this.#db
      .prepare(`SELECT * FROM session_view WHERE id = @id AND (@all OR NOT unlisted)`)
      .get({ id, all: includeUnlisted ? 1 : 0 }) as SessionRow | undefined;
    return row && toSession(row);
  }

  listSessionSets(sessionId: string, includeUnlisted: boolean): SetSummary[] {
    const rows = this.#db
      .prepare(
        `SELECT * FROM set_view WHERE session_id = @sessionId AND (@all OR NOT unlisted)
         ORDER BY position`,
      )
      .all({ sessionId, all: includeUnlisted ? 1 : 0 }) as SetRow[];
    return rows.map(toSet);
  }

  getSet(id: string, includeUnlisted: boolean): SetSummary | undefined {
    const row = this.#db
      .prepare(`SELECT * FROM set_view WHERE id = @id AND (@all OR NOT unlisted)`)
      .get({ id, all: includeUnlisted ? 1 : 0 }) as SetRow | undefined;
    return row && toSet(row);
  }

  recentSets(limit: number, includeUnlisted: boolean): SetSummary[] {
    const rows = this.#db
      .prepare(
        `SELECT * FROM set_view WHERE @all OR NOT unlisted
         ORDER BY started_at DESC LIMIT @limit`,
      )
      .all({ limit, all: includeUnlisted ? 1 : 0 }) as SetRow[];
    return rows.map(toSet);
  }

  /** Streamers with at least one visible set, most recently active first. */
  listStreamers(includeUnlisted: boolean): StreamerSummary[] {
    const rows = this.#db
      .prepare(
        `${STREAMER_SELECT}
         GROUP BY st.user_id HAVING @all OR set_count > 0
         ORDER BY last_played_at DESC`,
      )
      .all({ all: includeUnlisted ? 1 : 0 }) as StreamerRow[];
    return rows.map(toStreamer);
  }

  getStreamer(userId: string, includeUnlisted: boolean): StreamerSummary | undefined {
    const row = this.#db
      .prepare(
        `${STREAMER_SELECT}
         WHERE st.user_id = @userId GROUP BY st.user_id HAVING @all OR set_count > 0`,
      )
      .get({ userId, all: includeUnlisted ? 1 : 0 }) as StreamerRow | undefined;
    return row && toStreamer(row);
  }

  listTags(includeUnlisted: boolean): TagCount[] {
    return this.#db
      .prepare(
        `SELECT t.tag, count(*) AS count FROM set_tags t
         JOIN set_view v ON v.id = t.set_id
         WHERE @all OR NOT v.unlisted
         GROUP BY t.tag ORDER BY count DESC, t.tag`,
      )
      .all({ all: includeUnlisted ? 1 : 0 }) as TagCount[];
  }

  /**
   * Sets matching every given filter. With `q`, results are ranked by relevance;
   * otherwise newest first.
   */
  search(params: SearchParams, includeUnlisted: boolean): Page<SetSummary> {
    const page = params.page ?? 1;
    const match = params.q === undefined ? undefined : toMatchQuery(params.q);
    const conditions = ['(@all OR NOT v.unlisted)'];
    if (match)
      conditions.push('v.id IN (SELECT set_id FROM set_search WHERE set_search MATCH @match)');
    if (params.tag) conditions.push('v.id IN (SELECT set_id FROM set_tags WHERE tag = @tag)');
    if (params.userId) conditions.push('v.user_id = @userId');
    if (params.from) conditions.push('date(v.session_started_at) >= @from');
    if (params.to) conditions.push('date(v.session_started_at) <= @to');
    const where = conditions.join(' AND ');

    const values = {
      all: includeUnlisted ? 1 : 0,
      match: match ?? null,
      tag: params.tag ?? null,
      userId: params.userId ?? null,
      from: params.from ?? null,
      to: params.to ?? null,
    };

    const total = this.#db
      .prepare(`SELECT count(*) FROM set_view v WHERE ${where}`)
      .pluck()
      .get(values) as number;

    const order = match
      ? `(SELECT bm25(set_search) FROM set_search WHERE set_search MATCH @match AND set_id = v.id)`
      : 'v.started_at DESC';
    const rows = this.#db
      .prepare(
        `SELECT v.* FROM set_view v WHERE ${where} ORDER BY ${order} LIMIT @limit OFFSET @offset`,
      )
      .all({ ...values, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }) as SetRow[];

    return toPage(rows.map(toSet), total, page);
  }

  recentAudit(limit: number): AuditEntry[] {
    const rows = this.#db
      .prepare(
        `SELECT at, actor, entity, entity_id, changes FROM audit_log ORDER BY id DESC LIMIT ?`,
      )
      .all(limit) as {
      at: string;
      actor: string;
      entity: string;
      entity_id: string;
      changes: string;
    }[];
    return rows.map((row) => ({
      at: row.at,
      actor: row.actor,
      entity: row.entity,
      entityId: row.entity_id,
      changes: JSON.parse(row.changes) as AuditEntry['changes'],
    }));
  }

  // --- Edits (admin only; routes enforce that) -------------------------------------------

  updateSession(id: string, patch: SessionPatch, actor: string): void {
    const current = this.#db
      .prepare(`SELECT title, description, hidden FROM sessions WHERE id = ?`)
      .get(id) as { title: string | null; description: string | null; hidden: number } | undefined;
    if (!current) throw new NotFoundError('session', id);

    const next = {
      title: patch.title === undefined ? current.title : cleanText(patch.title, 120),
      description:
        patch.description === undefined ? current.description : cleanText(patch.description, 5000),
      hidden: patch.hidden === undefined ? current.hidden : patch.hidden ? 1 : 0,
    };

    this.#db.transaction(() => {
      this.#db
        .prepare(
          `UPDATE sessions SET title = @title, description = @description, hidden = @hidden,
           updated_at = @at WHERE id = @id`,
        )
        .run({ ...next, at: now(), id });
      this.#audit(actor, 'session', id, current, next);
      reindexSets(this.#db, this.#setIds(`session_id = ?`, id));
    })();
  }

  updateSet(id: string, patch: SetPatch, actor: string): void {
    const current = this.#db
      .prepare(`SELECT title, display_name, description, hidden FROM sets WHERE id = ?`)
      .get(id) as
      | {
          title: string | null;
          display_name: string | null;
          description: string | null;
          hidden: number | null;
        }
      | undefined;
    if (!current) throw new NotFoundError('set', id);
    const currentTags = this.#db
      .prepare(`SELECT tag FROM set_tags WHERE set_id = ? ORDER BY tag`)
      .pluck()
      .all(id) as string[];

    const next = {
      title: patch.title === undefined ? current.title : cleanText(patch.title, 120),
      display_name:
        patch.displayName === undefined ? current.display_name : cleanText(patch.displayName, 80),
      description:
        patch.description === undefined ? current.description : cleanText(patch.description, 5000),
      hidden:
        patch.hidden === undefined
          ? current.hidden
          : patch.hidden === null
            ? null
            : patch.hidden
              ? 1
              : 0,
    };
    const nextTags = patch.tags === undefined ? currentTags : normalizeTags(patch.tags);

    this.#db.transaction(() => {
      this.#db
        .prepare(
          `UPDATE sets SET title = @title, display_name = @display_name,
           description = @description, hidden = @hidden, updated_at = @at WHERE id = @id`,
        )
        .run({ ...next, at: now(), id });
      this.#db.prepare(`DELETE FROM set_tags WHERE set_id = ?`).run(id);
      const insertTag = this.#db.prepare(`INSERT INTO set_tags (set_id, tag) VALUES (?, ?)`);
      for (const tag of nextTags) insertTag.run(id, tag);

      this.#audit(actor, 'set', id, { ...current, tags: currentTags }, { ...next, tags: nextTags });
      reindexSets(this.#db, [id]);
    })();
  }

  updateStreamer(userId: string, patch: StreamerPatch, actor: string): void {
    const current = this.#db
      .prepare(`SELECT display_name, bio, links FROM streamers WHERE user_id = ?`)
      .get(userId) as
      { display_name: string | null; bio: string | null; links: string } | undefined;
    if (!current) throw new NotFoundError('streamer', userId);

    const next = {
      display_name:
        patch.displayName === undefined ? current.display_name : cleanText(patch.displayName, 80),
      bio: patch.bio === undefined ? current.bio : cleanText(patch.bio, 2000),
      links:
        patch.links === undefined ? current.links : JSON.stringify(normalizeLinks(patch.links)),
    };

    this.#db.transaction(() => {
      this.#db
        .prepare(
          `UPDATE streamers SET display_name = @display_name, bio = @bio, links = @links,
           updated_at = @at WHERE user_id = @userId`,
        )
        .run({ ...next, at: now(), userId });
      this.#audit(actor, 'streamer', userId, current, next);
      reindexSets(this.#db, this.#setIds(`user_id = ?`, userId));
    })();
  }

  // --- Helpers ----------------------------------------------------------------------------

  #setIds(where: string, value: string): string[] {
    return this.#db.prepare(`SELECT id FROM sets WHERE ${where}`).pluck().all(value) as string[];
  }

  #audit(
    actor: string,
    entity: string,
    entityId: string,
    before: Record<string, unknown>,
    after: Record<string, unknown>,
  ): void {
    const changes: AuditEntry['changes'] = {};
    for (const [key, to] of Object.entries(after)) {
      const from = before[key];
      if (JSON.stringify(from) !== JSON.stringify(to)) changes[key] = { from, to };
    }
    if (Object.keys(changes).length === 0) return;
    this.#db
      .prepare(
        `INSERT INTO audit_log (at, actor, entity, entity_id, changes) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(now(), actor, entity, entityId, JSON.stringify(changes));
  }
}
