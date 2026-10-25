/**
 * Mirrors the recorder's `session.json` files into the database. Only `recorded_*` and
 * structural columns are written; archive edits are left alone. Sessions or sets that
 * disappear from disk are flagged `missing` rather than deleted, so their edits survive
 * a folder being moved back.
 *
 * What changed since the last sync (new sessions and sets, titles from `/record title`,
 * processing results, files removed by the recorder's cleanup) goes into the activity
 * log as the recorder's doing, so the admin feed shows those next to archive edits.
 */
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  readJsonFile,
  sessionPaths,
  sessionSchema,
  type Logger,
  type Session,
  type SetFiles,
  type StreamSet,
} from '@dsr/core';
import { now, type Db } from '../db/database.ts';
import { writeAudit } from './audit.ts';
import { reindexAll } from './search.ts';
import { setUuid } from './ids.ts';

/** Actor for changes the recorder made (seen in session.json) in the activity log. */
const RECORDER = 'recorder';

export interface SyncResult {
  sessions: number;
  sets: number;
  invalid: { dir: string; error: string }[];
}

interface LoadedSession {
  dir: string;
  session: Session;
}

async function loadSessions(
  recordingsDir: string,
): Promise<{ loaded: LoadedSession[]; invalid: SyncResult['invalid'] }> {
  let entries;
  try {
    entries = await readdir(recordingsDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { loaded: [], invalid: [] };
    throw error;
  }

  const loaded: LoadedSession[] = [];
  const invalid: SyncResult['invalid'] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    try {
      const session = await readJsonFile(
        sessionPaths(recordingsDir, entry.name).sessionFile,
        sessionSchema,
      );
      if (session) loaded.push({ dir: entry.name, session });
    } catch (error) {
      invalid.push({ dir: entry.name, error: (error as Error).message });
    }
  }
  return { loaded, invalid };
}

/** Byte sizes of a set's files that exist, for the admin panel's storage use. */
async function fileSizes(sessionDir: string, files: SetFiles): Promise<Record<string, number>> {
  const sizes: Record<string, number> = {};
  for (const [key, relative] of Object.entries(files)) {
    // Paths come from session.json; don't follow one out of its session folder.
    const file = path.resolve(sessionDir, relative);
    if (!file.startsWith(sessionDir + path.sep)) continue;
    try {
      sizes[key] = (await stat(file)).size;
    } catch {
      // Not written yet (still recording or encoding) or already deleted: no size.
    }
  }
  return sizes;
}

export async function syncCatalog(
  db: Db,
  recordingsDir: string,
  logger?: Logger,
): Promise<SyncResult> {
  const { loaded, invalid } = await loadSessions(recordingsDir);
  for (const problem of invalid) logger?.warn(problem, 'skipping invalid session folder');

  const upsertSession = db.prepare(`
    INSERT INTO sessions (id, dir, guild_id, channel_id, channel_name, started_by_name,
                          started_at, ended_at, recorded_title, missing, synced_at)
    VALUES (@id, @dir, @guildId, @channelId, @channelName, @startedByName,
            @startedAt, @endedAt, @recordedTitle, 0, @syncedAt)
    ON CONFLICT (id) DO UPDATE SET
      dir = excluded.dir, guild_id = excluded.guild_id, channel_id = excluded.channel_id,
      channel_name = excluded.channel_name, started_by_name = excluded.started_by_name,
      started_at = excluded.started_at, ended_at = excluded.ended_at,
      recorded_title = excluded.recorded_title, missing = 0, synced_at = excluded.synced_at`);

  // Sets are processed oldest first, so the streamer row ends up with their latest name.
  // A name given to a set (a split, an upload) is that set's, not the DJ's: it only names a
  // DJ who has no other.
  const upsertStreamer = db.prepare(`
    INSERT INTO streamers (user_id, recorded_name, avatar_url)
    VALUES (@userId, @name, @avatarUrl)
    ON CONFLICT (user_id) DO UPDATE SET
      recorded_name = CASE WHEN @nameGiven THEN streamers.recorded_name
                           ELSE excluded.recorded_name END,
      avatar_url = COALESCE(excluded.avatar_url, streamers.avatar_url)`);

  const upsertSet = db.prepare(`
    INSERT INTO sets (id, uuid, session_id, user_id, position, recorded_name,
                      recorded_name_given, started_at, ended_at, partial, status,
                      recorded_error, files, file_sizes, recorded_hidden, missing)
    VALUES (@id, @uuid, @sessionId, @userId, @position, @name, @nameGiven, @startedAt,
            @endedAt, @partial, @status, @error, @files, @fileSizes, @hidden, 0)
    ON CONFLICT (id) DO UPDATE SET
      uuid = excluded.uuid, session_id = excluded.session_id, user_id = excluded.user_id,
      position = excluded.position, recorded_name = excluded.recorded_name,
      recorded_name_given = excluded.recorded_name_given,
      started_at = excluded.started_at, ended_at = excluded.ended_at,
      partial = excluded.partial, status = excluded.status,
      recorded_error = excluded.recorded_error, files = excluded.files,
      file_sizes = excluded.file_sizes, recorded_hidden = excluded.recorded_hidden, missing = 0`);

  const sets: { set: StreamSet; sessionId: string; dir: string; position: number }[] =
    loaded.flatMap(({ dir, session }) =>
      [...session.sets]
        .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
        .map((set, position) => ({ set, sessionId: session.id, dir, position })),
    );
  sets.sort((a, b) => a.set.startedAt.localeCompare(b.set.startedAt));

  const root = path.resolve(recordingsDir);
  const sizes = new Map<string, Record<string, number>>();
  for (const { set, dir } of sets) {
    sizes.set(set.id, await fileSizes(path.join(root, dir), set.files));
  }

  const previousSessions = new Map(
    (
      db.prepare(`SELECT id, recorded_title, ended_at, missing FROM sessions`).all() as {
        id: string;
        recorded_title: string | null;
        ended_at: string | null;
        missing: number;
      }[]
    ).map((row) => [row.id, row]),
  );
  const previousSets = new Map(
    (
      db.prepare(`SELECT id, status, recorded_error, files, missing FROM sets`).all() as {
        id: string;
        status: string;
        recorded_error: string | null;
        files: string;
        missing: number;
      }[]
    ).map((row) => [row.id, row]),
  );
  const fileKinds = (files: object): string[] => Object.keys(files).sort();

  const syncedAt = now();
  db.transaction(() => {
    for (const { dir, session } of loaded) {
      const before = previousSessions.get(session.id);
      writeAudit(
        db,
        RECORDER,
        'session',
        session.id,
        before
          ? {
              recorded: true,
              title: before.recorded_title,
              ended: before.ended_at !== null,
              missing: before.missing === 1,
            }
          : { recorded: false },
        {
          recorded: true,
          ...(before && {
            title: session.title ?? null,
            ended: session.endedAt !== undefined,
            missing: false,
          }),
        },
      );
      upsertSession.run({
        id: session.id,
        dir,
        guildId: session.guildId,
        channelId: session.channelId,
        channelName: session.channelName,
        startedByName: session.startedBy.displayName,
        startedAt: session.startedAt,
        endedAt: session.endedAt ?? null,
        recordedTitle: session.title ?? null,
        syncedAt,
      });
    }

    for (const { set, sessionId, position } of sets) {
      upsertStreamer.run({
        userId: set.userId,
        name: set.displayName,
        nameGiven: set.nameGiven ? 1 : 0,
        avatarUrl: set.avatarUrl ?? null,
      });
      const before = previousSets.get(set.id);
      writeAudit(
        db,
        RECORDER,
        'set',
        set.id,
        before
          ? {
              status: before.status,
              error: before.recorded_error,
              files: fileKinds(JSON.parse(before.files) as object),
              missing: before.missing === 1,
            }
          : { recorded: null },
        before
          ? {
              status: set.status,
              error: set.error ?? null,
              files: fileKinds(set.files),
              missing: false,
            }
          : { recorded: `${set.displayName}, ${set.status}` },
      );
      upsertSet.run({
        id: set.id,
        uuid: setUuid(sessionId, set.id),
        sessionId,
        userId: set.userId,
        position,
        name: set.displayName,
        nameGiven: set.nameGiven ? 1 : 0,
        startedAt: set.startedAt,
        endedAt: set.endedAt ?? null,
        partial: set.partial ? 1 : 0,
        status: set.status,
        error: set.error ?? null,
        files: JSON.stringify(set.files),
        fileSizes: JSON.stringify(sizes.get(set.id) ?? {}),
        hidden: set.hidden ? 1 : 0,
      });
    }

    const seenSessions = JSON.stringify(loaded.map(({ session }) => session.id));
    const seenSets = JSON.stringify(sets.map(({ set }) => set.id));
    const seenSessionIds = new Set(loaded.map(({ session }) => session.id));
    const seenSetIds = new Set(sets.map(({ set }) => set.id));
    for (const [id, row] of previousSessions) {
      if (row.missing === 0 && !seenSessionIds.has(id)) {
        writeAudit(db, RECORDER, 'session', id, { missing: false }, { missing: true });
      }
    }
    for (const [id, row] of previousSets) {
      if (row.missing === 0 && !seenSetIds.has(id)) {
        writeAudit(db, RECORDER, 'set', id, { missing: false }, { missing: true });
      }
    }
    db.prepare(
      `UPDATE sessions SET missing = 1 WHERE id NOT IN (SELECT value FROM json_each(?))`,
    ).run(seenSessions);
    db.prepare(`UPDATE sets SET missing = 1 WHERE id NOT IN (SELECT value FROM json_each(?))`).run(
      seenSets,
    );

    reindexAll(db);
  })();

  return { sessions: loaded.length, sets: sets.length, invalid };
}
