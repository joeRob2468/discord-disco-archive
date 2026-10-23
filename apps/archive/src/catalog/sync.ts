/**
 * Mirrors the recorder's `session.json` files into the database. Only `recorded_*` and
 * structural columns are written; archive edits are left alone. Sessions or sets that
 * disappear from disk are flagged `missing` rather than deleted, so their edits survive
 * a folder being moved back.
 */
import { readdir } from 'node:fs/promises';
import {
  readJsonFile,
  sessionPaths,
  sessionSchema,
  type Logger,
  type Session,
  type StreamSet,
} from '@dsr/core';
import { now, type Db } from '../db/database.ts';
import { reindexAll } from './search.ts';

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
  const upsertStreamer = db.prepare(`
    INSERT INTO streamers (user_id, recorded_name, avatar_url)
    VALUES (@userId, @name, @avatarUrl)
    ON CONFLICT (user_id) DO UPDATE SET
      recorded_name = excluded.recorded_name,
      avatar_url = COALESCE(excluded.avatar_url, streamers.avatar_url)`);

  const upsertSet = db.prepare(`
    INSERT INTO sets (id, session_id, user_id, position, recorded_name, started_at, ended_at,
                      partial, status, files, recorded_hidden, missing)
    VALUES (@id, @sessionId, @userId, @position, @name, @startedAt, @endedAt,
            @partial, @status, @files, @hidden, 0)
    ON CONFLICT (id) DO UPDATE SET
      session_id = excluded.session_id, user_id = excluded.user_id,
      position = excluded.position, recorded_name = excluded.recorded_name,
      started_at = excluded.started_at, ended_at = excluded.ended_at,
      partial = excluded.partial, status = excluded.status, files = excluded.files,
      recorded_hidden = excluded.recorded_hidden, missing = 0`);

  const sets: { set: StreamSet; sessionId: string; position: number }[] = loaded.flatMap(
    ({ session }) =>
      [...session.sets]
        .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
        .map((set, position) => ({ set, sessionId: session.id, position })),
  );
  sets.sort((a, b) => a.set.startedAt.localeCompare(b.set.startedAt));

  const syncedAt = now();
  db.transaction(() => {
    for (const { dir, session } of loaded) {
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
        avatarUrl: set.avatarUrl ?? null,
      });
      upsertSet.run({
        id: set.id,
        sessionId,
        userId: set.userId,
        position,
        name: set.displayName,
        startedAt: set.startedAt,
        endedAt: set.endedAt ?? null,
        partial: set.partial ? 1 : 0,
        status: set.status,
        files: JSON.stringify(set.files),
        hidden: set.hidden ? 1 : 0,
      });
    }

    const seenSessions = JSON.stringify(loaded.map(({ session }) => session.id));
    const seenSets = JSON.stringify(sets.map(({ set }) => set.id));
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
