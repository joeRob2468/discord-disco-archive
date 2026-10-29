/**
 * Read and edit access to the archive database. Routes talk to this class only; SQL
 * stays here. "Unlisted" means hidden by an edit, hidden by the recorder, or missing
 * from disk. Only admins see unlisted items.
 */
import { setFilesSchema, type SetFiles, type SetStatus } from '@dsr/core';
import { now, type Db } from '../db/database.ts';
import { writeAudit } from './audit.ts';
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
  /** Album cover file name (see `images.ts`), if uploaded. */
  image: string | undefined;
}

export interface SetSummary {
  id: string;
  /** Public ID for URLs (`/t/<uuid>`); see `ids.ts`. */
  uuid: string;
  sessionId: string;
  sessionTitle: string;
  sessionStartedAt: string;
  sessionDir: string;
  userId: string;
  /** Place in its album: the admin's order if set, else start time. */
  position: number;
  /** Whether an admin reordered this set. */
  reordered: boolean;
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
  /** Why processing failed, from the recorder. */
  error: string | undefined;
  files: SetFiles;
  /** Bytes per file that exists on disk, as of the last sync. */
  fileSizes: Partial<Record<keyof SetFiles, number>>;
  hidden: boolean;
  /** Visibility set in the archive; `undefined` follows the recorder. */
  hiddenOverride: boolean | undefined;
  unlisted: boolean;
  tags: string[];
  /** Times played (see `recordPlay`). */
  plays: number;
  /** Times downloaded (see `recordDownload`). */
  downloads: number;
  /** Uploaded image file names: this set's art, its album cover, its DJ's picture. */
  image: string | undefined;
  sessionImage: string | undefined;
  streamerImage: string | undefined;
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
  /** Total length of their sets. */
  totalSeconds: number;
  /** When their first and latest sets started. */
  firstPlayedAt: string | undefined;
  lastPlayedAt: string | undefined;
  /** Times their sets were downloaded. */
  downloads: number;
  /** Uploaded picture file name, if any. */
  image: string | undefined;
}

/** A session with totals over the sets the viewer can see. */
export interface SessionStats {
  session: SessionSummary;
  sets: number;
  djs: number;
  seconds: number;
  downloads: number;
}

/** Archive-wide totals for the admin overview. Sizes are bytes per `SetFiles` key. */
export interface Overview {
  sessions: number;
  sets: number;
  hiddenSets: number;
  djs: number;
  seconds: number;
  plays: number;
  downloads: number;
  storage: Partial<Record<keyof SetFiles, number>>;
}

export type SortDir = 'asc' | 'desc';

// Sort keys accepted from query strings, mapped to fixed SQL; never built from input.
export const SET_SORTS = {
  date: 'v.started_at',
  dj: 'v.name COLLATE NOCASE',
  title: 'COALESCE(v.title, v.name) COLLATE NOCASE',
  session: 'v.session_title COLLATE NOCASE',
  length: 'v.duration_seconds',
  plays: 'v.plays',
  downloads: 'v.downloads',
  size: '(SELECT COALESCE(sum(value), 0) FROM json_each(v.file_sizes))',
  status: 'v.status',
} as const;
export type SetSort = keyof typeof SET_SORTS;

export const SESSION_SORTS = {
  date: 'se.started_at',
  title: 'se.display_title COLLATE NOCASE',
  sets: 'agg.sets',
  djs: 'agg.djs',
  length: 'agg.seconds',
  downloads: 'agg.downloads',
} as const;
export type SessionSort = keyof typeof SESSION_SORTS;

export const STREAMER_SORTS = {
  name: 'name COLLATE NOCASE',
  sets: 'set_count',
  length: 'total_seconds',
  first: 'first_played_at',
  last: 'last_played_at',
  downloads: 'downloads',
} as const;
export type StreamerSort = keyof typeof STREAMER_SORTS;

export interface Sort<K extends string> {
  by: K;
  dir: SortDir;
}

export interface AuditEntry {
  at: string;
  /** `admin` for archive edits, `recorder` for changes seen in session.json. */
  actor: string;
  entity: string;
  entityId: string;
  /** The subject's current name, if it still exists. */
  label: string | undefined;
  exists: boolean;
  changes: Record<string, { from: unknown; to: unknown }>;
}

export interface SearchParams {
  q?: string | undefined;
  tag?: string | undefined;
  userId?: string | undefined;
  sessionId?: string | undefined;
  /** Inclusive `YYYY-MM-DD` bounds on the session date. */
  from?: string | undefined;
  to?: string | undefined;
  status?: SetStatus | undefined;
  /** Admin filter on the set's own visibility. */
  hidden?: boolean | undefined;
  /** Default: relevance with `q`, otherwise newest first. */
  sort?: Sort<SetSort> | undefined;
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
  image: string | null;
}

interface SetRow {
  id: string;
  uuid: string;
  plays: number;
  downloads: number;
  image: string | null;
  session_image: string | null;
  streamer_image: string | null;
  session_id: string;
  session_title: string;
  session_started_at: string;
  session_dir: string;
  user_id: string;
  position: number;
  reordered: number;
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
  error: string | null;
  files: string;
  file_sizes: string;
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
  total_seconds: number;
  first_played_at: string | null;
  last_played_at: string | null;
  downloads: number;
  image: string | null;
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
    image: opt(row.image),
  };
}

function toSet(row: SetRow): SetSummary {
  const endedAt = opt(row.ended_at);
  return {
    id: row.id,
    uuid: row.uuid,
    plays: row.plays,
    downloads: row.downloads,
    image: opt(row.image),
    sessionImage: opt(row.session_image),
    streamerImage: opt(row.streamer_image),
    sessionId: row.session_id,
    sessionTitle: row.session_title,
    sessionStartedAt: row.session_started_at,
    sessionDir: row.session_dir,
    userId: row.user_id,
    position: row.position,
    reordered: row.reordered === 1,
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
    error: opt(row.error),
    files: setFilesSchema.parse(JSON.parse(row.files)),
    fileSizes: JSON.parse(row.file_sizes) as SetSummary['fileSizes'],
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
    totalSeconds: row.total_seconds,
    firstPlayedAt: opt(row.first_played_at),
    lastPlayedAt: opt(row.last_played_at),
    downloads: row.downloads,
    image: opt(row.image),
  };
}

const orderBy = (column: string, dir: SortDir): string =>
  `${column} ${dir === 'asc' ? 'ASC' : 'DESC'}`;

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
  SELECT st.user_id, st.recorded_name, st.display_name, st.avatar_url, st.bio, st.links, st.image,
         COALESCE(st.display_name, st.recorded_name) AS name,
         count(v.id) AS set_count,
         COALESCE(sum(v.duration_seconds), 0) AS total_seconds,
         min(v.started_at) AS first_played_at,
         max(v.started_at) AS last_played_at,
         COALESCE(sum(v.downloads), 0) AS downloads
  FROM streamers st
  LEFT JOIN set_view v ON v.user_id = st.user_id AND (@all OR NOT v.unlisted)`;

export type ImageEntity = 'streamer' | 'session' | 'set';

// Fixed table and key names per entity; never built from request input.
const IMAGE_TABLES = {
  streamer: { table: 'streamers', key: 'user_id' },
  session: { table: 'sessions', key: 'id' },
  set: { table: 'sets', key: 'id' },
} as const satisfies Record<ImageEntity, { table: string; key: string }>;

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
         ORDER BY position, started_at`,
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

  getSetByUuid(uuid: string, includeUnlisted: boolean): SetSummary | undefined {
    const row = this.#db
      .prepare(`SELECT * FROM set_view WHERE uuid = @uuid AND (@all OR NOT unlisted)`)
      .get({ uuid, all: includeUnlisted ? 1 : 0 }) as SetRow | undefined;
    return row && toSet(row);
  }

  /** Count a play of a visible set. Returns false if there's no such set. */
  recordPlay(uuid: string): boolean {
    const result = this.#db
      .prepare(
        `INSERT INTO plays (set_id, at)
         SELECT id, @at FROM set_view WHERE uuid = @uuid AND NOT unlisted`,
      )
      .run({ uuid, at: now() });
    return result.changes > 0;
  }

  /**
   * Count a download of a visible set (by its recorder ID, as media URLs use). Returns
   * false if there's no such set.
   */
  recordDownload(id: string): boolean {
    const result = this.#db
      .prepare(
        `INSERT INTO downloads (set_id, at)
         SELECT id, @at FROM set_view WHERE id = @id AND NOT unlisted`,
      )
      .run({ id, at: now() });
    return result.changes > 0;
  }

  /**
   * Most-played sets over the last `days` days; sets never played in that window rank by
   * all-time plays, then newest first, so the list is never empty while sets exist.
   */
  popularSets(limit: number, days: number, includeUnlisted: boolean): SetSummary[] {
    const rows = this.#db
      .prepare(
        `SELECT v.* FROM set_view v
         WHERE (@all OR NOT v.unlisted)
         ORDER BY (SELECT count(*) FROM plays p
                   WHERE p.set_id = v.id
                     -- plays.at is ISO 8601 (now()), so compare in the same format.
                     AND p.at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', @window)) DESC,
                  v.plays DESC, v.started_at DESC
         LIMIT @limit`,
      )
      .all({ limit, window: `-${String(days)} days`, all: includeUnlisted ? 1 : 0 }) as SetRow[];
    return rows.map(toSet);
  }

  /**
   * Sessions with at least one set the viewer can see, with totals over those sets.
   * Newest first by default.
   */
  listSessionStats(
    includeUnlisted: boolean,
    sort: Sort<SessionSort> = { by: 'date', dir: 'desc' },
  ): SessionStats[] {
    const rows = this.#db
      .prepare(
        `SELECT se.*, agg.sets, agg.djs, agg.seconds, agg.downloads
         FROM session_view se
         JOIN (SELECT v.session_id, count(*) AS sets, count(DISTINCT v.user_id) AS djs,
                      COALESCE(sum(v.duration_seconds), 0) AS seconds,
                      sum(v.downloads) AS downloads
               FROM set_view v WHERE @all OR NOT v.unlisted GROUP BY v.session_id) agg
           ON agg.session_id = se.id
         WHERE @all OR NOT se.unlisted
         ORDER BY ${orderBy(SESSION_SORTS[sort.by], sort.dir)}, se.started_at DESC`,
      )
      .all({ all: includeUnlisted ? 1 : 0 }) as (SessionRow & {
      sets: number;
      djs: number;
      seconds: number;
      downloads: number;
    })[];
    return rows.map((row) => ({
      session: toSession(row),
      sets: row.sets,
      djs: row.djs,
      seconds: row.seconds,
      downloads: row.downloads,
    }));
  }

  /** Totals over everything on disk, hidden or not (admin only). */
  overview(): Overview {
    const counts = this.#db
      .prepare(
        `SELECT count(DISTINCT session_id) AS sessions, count(*) AS sets,
                COALESCE(sum(unlisted), 0) AS hidden_sets, count(DISTINCT user_id) AS djs,
                COALESCE(sum(duration_seconds), 0) AS seconds, COALESCE(sum(plays), 0) AS plays,
                COALESCE(sum(downloads), 0) AS downloads
         FROM set_view WHERE NOT missing`,
      )
      .get() as {
      sessions: number;
      sets: number;
      hidden_sets: number;
      djs: number;
      seconds: number;
      plays: number;
      downloads: number;
    };
    const storage = this.#db
      .prepare(
        `SELECT f.key, sum(f.value) AS bytes
         FROM set_view v, json_each(v.file_sizes) f WHERE NOT v.missing GROUP BY f.key`,
      )
      .all() as { key: keyof SetFiles; bytes: number }[];
    return {
      sessions: counts.sessions,
      sets: counts.sets,
      hiddenSets: counts.hidden_sets,
      djs: counts.djs,
      seconds: counts.seconds,
      plays: counts.plays,
      downloads: counts.downloads,
      storage: Object.fromEntries(storage.map((row) => [row.key, row.bytes])),
    };
  }

  /** Sets still recording, waiting for processing, or failed, newest first (admin only). */
  unfinishedSets(): SetSummary[] {
    const rows = this.#db
      .prepare(
        `SELECT * FROM set_view WHERE status != 'ready' AND NOT missing ORDER BY started_at DESC`,
      )
      .all() as SetRow[];
    return rows.map(toSet);
  }

  /** Streamers with at least one visible set; by default most recently active first. */
  listStreamers(
    includeUnlisted: boolean,
    sort: Sort<StreamerSort> = { by: 'last', dir: 'desc' },
  ): StreamerSummary[] {
    const rows = this.#db
      .prepare(
        `${STREAMER_SELECT}
         GROUP BY st.user_id HAVING @all OR set_count > 0
         ORDER BY ${orderBy(STREAMER_SORTS[sort.by], sort.dir)}, last_played_at DESC`,
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
    if (params.sessionId) conditions.push('v.session_id = @sessionId');
    if (params.from) conditions.push('date(v.session_started_at) >= @from');
    if (params.to) conditions.push('date(v.session_started_at) <= @to');
    if (params.status) conditions.push('v.status = @status');
    if (params.hidden !== undefined) conditions.push('v.hidden = @hidden');
    const where = conditions.join(' AND ');

    const values = {
      all: includeUnlisted ? 1 : 0,
      match: match ?? null,
      tag: params.tag ?? null,
      userId: params.userId ?? null,
      sessionId: params.sessionId ?? null,
      from: params.from ?? null,
      to: params.to ?? null,
      status: params.status ?? null,
      hidden: params.hidden === undefined ? null : params.hidden ? 1 : 0,
    };

    const total = this.#db
      .prepare(`SELECT count(*) FROM set_view v WHERE ${where}`)
      .pluck()
      .get(values) as number;

    const order = params.sort
      ? `${orderBy(SET_SORTS[params.sort.by], params.sort.dir)}, v.started_at DESC`
      : match
        ? `(SELECT bm25(set_search) FROM set_search WHERE set_search MATCH @match AND set_id = v.id)`
        : 'v.started_at DESC';
    const rows = this.#db
      .prepare(
        `SELECT v.* FROM set_view v WHERE ${where} ORDER BY ${order} LIMIT @limit OFFSET @offset`,
      )
      .all({ ...values, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }) as SetRow[];

    return toPage(rows.map(toSet), total, page);
  }

  /** Newest first; `actor` limits it to admin edits or the recorder's changes. */
  recentAudit(limit: number, actor?: string): AuditEntry[] {
    const rows = this.#db
      .prepare(
        `SELECT a.at, a.actor, a.entity, a.entity_id, a.changes,
                CASE a.entity
                  WHEN 'set' THEN (SELECT COALESCE(v.title, v.name) || ' · ' || v.session_title
                                   FROM set_view v WHERE v.id = a.entity_id)
                  WHEN 'session' THEN (SELECT display_title FROM session_view WHERE id = a.entity_id)
                  WHEN 'streamer' THEN (SELECT COALESCE(display_name, recorded_name)
                                        FROM streamers WHERE user_id = a.entity_id)
                END AS label
         FROM audit_log a
         WHERE @actor IS NULL OR a.actor = @actor
         ORDER BY a.id DESC LIMIT @limit`,
      )
      .all({ limit, actor: actor ?? null }) as {
      at: string;
      actor: string;
      entity: string;
      entity_id: string;
      changes: string;
      label: string | null;
    }[];
    return rows.map((row) => ({
      at: row.at,
      actor: row.actor,
      entity: row.entity,
      entityId: row.entity_id,
      label: opt(row.label),
      exists: row.label !== null,
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

  /**
   * Forget a set whose files were deleted (plays, downloads and tags go with it). Returns the image
   * files that nothing uses any more, for the caller to delete.
   */
  deleteSet(id: string, actor: string): string[] {
    const row = this.#db
      .prepare(`SELECT name, session_title, image FROM set_view WHERE id = ?`)
      .get(id) as { name: string; session_title: string; image: string | null } | undefined;
    if (!row) throw new NotFoundError('set', id);
    this.#db.transaction(() => {
      this.#db.prepare(`DELETE FROM sets WHERE id = ?`).run(id);
      reindexSets(this.#db, [id]);
      this.#audit(
        actor,
        'set',
        id,
        { deleted: `${row.name} (${row.session_title})` },
        { deleted: true },
      );
    })();
    return this.#unusedImages([row.image]);
  }

  /** Forget a session whose folder was deleted, with all its sets. Returns unused images. */
  deleteSession(id: string, actor: string): string[] {
    const session = this.#db
      .prepare(`SELECT display_title, image FROM session_view WHERE id = ?`)
      .get(id) as { display_title: string; image: string | null } | undefined;
    if (!session) throw new NotFoundError('session', id);
    const sets = this.#setIds(`session_id = ?`, id);
    const setImages = this.#db
      .prepare(`SELECT image FROM sets WHERE session_id = ? AND image IS NOT NULL`)
      .pluck()
      .all(id) as string[];
    this.#db.transaction(() => {
      this.#db.prepare(`DELETE FROM sessions WHERE id = ?`).run(id);
      reindexSets(this.#db, sets);
      this.#audit(actor, 'session', id, { deleted: session.display_title }, { deleted: true });
    })();
    return this.#unusedImages([session.image, ...setImages]);
  }

  /**
   * Move a set one place earlier (`-1`) or later (`1`) in its album. Every set in the
   * session gets an explicit place, so the order no longer follows start times.
   */
  moveSet(sessionId: string, setId: string, delta: -1 | 1, actor: string): void {
    const ids = this.#albumOrder(sessionId);
    const from = ids.indexOf(setId);
    if (from < 0) throw new NotFoundError('set', setId);
    const to = from + delta;
    if (to < 0 || to >= ids.length) return;
    const next = [...ids];
    [next[from], next[to]] = [ids[to] ?? setId, setId];
    this.#db.transaction(() => {
      const update = this.#db.prepare(`UPDATE sets SET album_position = ? WHERE id = ?`);
      next.forEach((id, position) => update.run(position, id));
      this.#audit(actor, 'session', sessionId, { order: ids }, { order: next });
    })();
  }

  /** Back to the recorder's order (by start time). */
  resetSetOrder(sessionId: string, actor: string): void {
    const ids = this.#albumOrder(sessionId);
    if (ids.length === 0) throw new NotFoundError('session', sessionId);
    this.#db.transaction(() => {
      this.#db.prepare(`UPDATE sets SET album_position = NULL WHERE session_id = ?`).run(sessionId);
      this.#audit(
        actor,
        'session',
        sessionId,
        { order: ids },
        { order: this.#albumOrder(sessionId) },
      );
    })();
  }

  /**
   * Set or clear the uploaded image of a DJ, session or set. Returns the previous file
   * name, so the caller can delete the file once nothing uses it.
   */
  setImage(
    entity: ImageEntity,
    id: string,
    image: string | undefined,
    actor: string,
  ): string | undefined {
    const { table, key } = IMAGE_TABLES[entity];
    const current = this.#db.prepare(`SELECT image FROM ${table} WHERE ${key} = ?`).get(id) as
      { image: string | null } | undefined;
    if (!current) throw new NotFoundError(entity, id);
    this.#db.transaction(() => {
      this.#db
        .prepare(`UPDATE ${table} SET image = ?, updated_at = ? WHERE ${key} = ?`)
        .run(image ?? null, now(), id);
      this.#audit(actor, entity, id, { image: current.image }, { image: image ?? null });
    })();
    return opt(current.image);
  }

  /** Whether any DJ, session or set still uses this image file. */
  imageInUse(image: string): boolean {
    return (
      this.#db
        .prepare(
          `SELECT EXISTS (SELECT 1 FROM streamers WHERE image = @image)
               OR EXISTS (SELECT 1 FROM sessions WHERE image = @image)
               OR EXISTS (SELECT 1 FROM sets WHERE image = @image)`,
        )
        .pluck()
        .get({ image }) === 1
    );
  }

  // --- Helpers ----------------------------------------------------------------------------

  #unusedImages(images: (string | null)[]): string[] {
    return [...new Set(images)].filter(
      (image): image is string => image !== null && !this.imageInUse(image),
    );
  }

  /** Every set of a session (hidden ones too), in album order. */
  #albumOrder(sessionId: string): string[] {
    return this.#db
      .prepare(`SELECT id FROM set_view WHERE session_id = ? ORDER BY position, started_at`)
      .pluck()
      .all(sessionId) as string[];
  }

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
    writeAudit(this.#db, actor, entity, entityId, before, after);
  }
}
