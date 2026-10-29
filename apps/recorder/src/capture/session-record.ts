/**
 * The session folder and its `session.json` (the recorder → archive contract, see
 * `@dsr/core`'s session schema). Creates the folder when a session starts, adds a set
 * per capture (or per upload imported from the archive), records post-processing results,
 * keeps `setlist.csv` in step, and renames the folder at the end if the title changed.
 *
 * The controller and the post-processor both update it, so every write runs one at a
 * time behind an internal lock. Other processes write it too (the archive deletes sets,
 * the retention sweep drops files, an import adds a set), so each write starts from the
 * file on disk rather than this object's copy, which may be minutes old.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  RAW_DIR,
  readJsonFile,
  SCHEMA_VERSION,
  SESSION_FILE,
  sessionSchema,
  sessionDirName,
  sessionPaths,
  setBaseName,
  writeJsonFileAtomic,
  type Session,
  type SetFiles,
  type StreamSet,
} from '@dsr/core';
import type { SessionInfo } from '../session/session-manager.ts';

const exists = (p: string): Promise<boolean> =>
  stat(p).then(
    () => true,
    () => false,
  );

/** `name`, or `name-2`, `name-3`… if a folder by that name already exists. */
async function freeDirName(recordingsDir: string, name: string): Promise<string> {
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? name : `${name}-${String(n)}`;
    if (!(await exists(path.join(recordingsDir, candidate)))) return candidate;
  }
}

const label = (info: SessionInfo): string => info.title ?? info.channelName;

const csvField = (value: string): string =>
  /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;

/** `setlist.csv`: one row per set, for people browsing the folder without the archive. */
export function setlistCsv(sets: readonly StreamSet[]): string {
  const header = ['start', 'end', 'user_id', 'display_name', 'partial', 'status', 'files'];
  const rows = sets.map((set) => [
    set.startedAt,
    set.endedAt ?? '',
    set.userId,
    set.displayName,
    String(set.partial),
    set.status,
    Object.values(set.files).join(' '),
  ]);
  return [header, ...rows].map((row) => row.map(csvField).join(',')).join('\n') + '\n';
}

/** A session folder, as `/record resume` offers it. */
export interface SessionOnDisk {
  /** Folder name, relative to the recordings root. */
  dir: string;
  guildId: string;
  title: string | undefined;
  channelName: string;
  startedAt: Date;
  ended: boolean;
  sets: number;
}

/** The sessions recorded in `channelId`, newest first. Unreadable folders are skipped. */
export async function findSessions(
  recordingsDir: string,
  channelId: string,
): Promise<SessionOnDisk[]> {
  const entries = await readdir(recordingsDir, { withFileTypes: true }).catch(() => []);
  const found: SessionOnDisk[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name.startsWith('_')) continue;
    const session = await readJsonFile(
      sessionPaths(recordingsDir, entry.name).sessionFile,
      sessionSchema,
    ).catch(() => undefined);
    if (session?.channelId !== channelId) continue;
    found.push({
      dir: entry.name,
      guildId: session.guildId,
      title: session.title,
      channelName: session.channelName,
      startedAt: new Date(session.startedAt),
      ended: session.endedAt !== undefined,
      sets: session.sets.length,
    });
  }
  return found.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
}

export class SessionRecord {
  readonly #recordingsDir: string;
  /** The folder name before any `-2` suffix, to tell whether the title changed. */
  #baseName: string;
  #dirName: string;
  #session: Session;
  #lock: Promise<unknown> = Promise.resolve();

  private constructor(recordingsDir: string, baseName: string, dirName: string, session: Session) {
    this.#recordingsDir = recordingsDir;
    this.#baseName = baseName;
    this.#dirName = dirName;
    this.#session = session;
  }

  static async create(recordingsDir: string, info: SessionInfo): Promise<SessionRecord> {
    const baseName = sessionDirName(info.startedAt, label(info));
    const dirName = await freeDirName(recordingsDir, baseName);
    const record = new SessionRecord(recordingsDir, baseName, dirName, {
      schemaVersion: SCHEMA_VERSION,
      id: randomUUID(),
      ...(info.title && { title: info.title }),
      guildId: info.guildId,
      channelId: info.channelId,
      channelName: info.channelName,
      startedAt: info.startedAt.toISOString(),
      startedBy: info.startedBy,
      sets: [],
    });
    await mkdir(record.paths.rawDir, { recursive: true });
    await record.#save();
    return record;
  }

  /** Open an existing session folder, e.g. to re-run post-processing. */
  static async open(recordingsDir: string, dirName: string): Promise<SessionRecord> {
    const session = await readJsonFile(
      sessionPaths(recordingsDir, dirName).sessionFile,
      sessionSchema,
    );
    if (!session) throw new Error(`No ${SESSION_FILE} in ${path.join(recordingsDir, dirName)}`);
    return new SessionRecord(recordingsDir, dirName, dirName, session);
  }

  /**
   * Reopen a session folder to record into it again (`/record resume`): its end time is
   * cleared until it finishes again.
   */
  static async reopen(recordingsDir: string, dirName: string): Promise<SessionRecord> {
    const record = await SessionRecord.open(recordingsDir, dirName);
    const { session } = record;
    // Its name without any `-2` suffix, so finishing only renames it if the title changes.
    record.#baseName = sessionDirName(
      new Date(session.startedAt),
      session.title ?? session.channelName,
    );
    await record.#exclusive(async () => {
      await record.#reload();
      const { endedAt: _endedAt, ...reopened } = record.#session;
      record.#session = reopened;
      await record.#save();
    });
    return record;
  }

  get paths() {
    return sessionPaths(this.#recordingsDir, this.#dirName);
  }

  get session(): Session {
    return this.#session;
  }

  set(setId: string): StreamSet | undefined {
    return this.#session.sets.find((set) => set.id === setId);
  }

  /** Add a set in `recording` state. Returns its ID and the absolute WAV path to write. */
  async startSet(
    target: { userId: string; displayName: string },
    startedAt: Date,
    partial: boolean,
    nameGiven = false,
  ): Promise<{ setId: string; rawAudioPath: string }> {
    return this.#exclusive(async () => {
      await this.#reload();
      const setId = setBaseName(startedAt, target.displayName, target.userId);
      const rawAudio = path.posix.join(RAW_DIR, `${setId}.wav`);
      const set: StreamSet = {
        id: setId,
        userId: target.userId,
        displayName: target.displayName,
        ...(nameGiven && { nameGiven }),
        startedAt: startedAt.toISOString(),
        partial,
        cut: { start: partial, end: false },
        hidden: false,
        status: 'recording',
        files: { rawAudio },
      };
      this.#session = { ...this.#session, sets: [...this.#session.sets, set] };
      await this.#save();
      return { setId, rawAudioPath: path.join(this.paths.dir, rawAudio) };
    });
  }

  /**
   * Add a set for an uploaded file, ready for post-processing. `ext` is the file's
   * extension (`.mp3`); its raw audio path is returned for the caller to move it to.
   */
  async addImportedSet(
    dj: { userId: string; displayName: string },
    startedAt: Date,
    ext: string,
  ): Promise<{ setId: string; rawAudioPath: string }> {
    return this.#exclusive(async () => {
      await this.#reload();
      const base = setBaseName(startedAt, dj.displayName, dj.userId);
      let setId = base;
      for (let n = 2; this.set(setId); n++) setId = `${base}-${String(n)}`;
      const rawAudio = path.posix.join(RAW_DIR, `${setId}${ext}`);
      const set: StreamSet = {
        id: setId,
        userId: dj.userId,
        displayName: dj.displayName,
        nameGiven: true,
        startedAt: startedAt.toISOString(),
        // Its end is known once post-processing has measured it.
        partial: false,
        hidden: false,
        status: 'processing',
        files: { rawAudio },
      };
      this.#session = { ...this.#session, sets: [...this.#session.sets, set] };
      await this.#save();
      return { setId, rawAudioPath: path.join(this.paths.dir, rawAudio) };
    });
  }

  /** Give a set its own name (`/record split` names the set that ended). */
  renameSet(setId: string, displayName: string): Promise<void> {
    return this.#updateSet(setId, (set) => ({ ...set, displayName, nameGiven: true }));
  }

  /** Record the DJ's avatar URL on a set, for the archive to copy. */
  setAvatar(setId: string, avatarUrl: string): Promise<void> {
    return this.#updateSet(setId, (set) => ({ ...set, avatarUrl }));
  }

  /** Close a set. Without `error` it goes on to post-processing, so its status is `processing`. */
  endSet(
    setId: string,
    endedAt: Date,
    { partial, error }: { partial: boolean; error?: string },
  ): Promise<void> {
    return this.#updateSet(setId, (set) => ({
      ...set,
      endedAt: endedAt.toISOString(),
      partial: set.partial || partial,
      ...(set.cut && { cut: { ...set.cut, end: set.cut.end || partial } }),
      status: error === undefined ? 'processing' : 'failed',
      ...(error !== undefined && { error }),
    }));
  }

  /**
   * Post-processing finished: add its files and mark the set playable, with `partial`
   * settled from the audio if given. `durationSeconds` gives an imported set its end.
   */
  completeSet(
    setId: string,
    files: SetFiles,
    partial?: boolean,
    durationSeconds?: number,
  ): Promise<void> {
    return this.#updateSet(setId, (set) => {
      const endedAt =
        set.endedAt ??
        (durationSeconds === undefined
          ? undefined
          : new Date(Date.parse(set.startedAt) + durationSeconds * 1000).toISOString());
      const next: StreamSet = {
        ...set,
        status: 'ready',
        files: { ...set.files, ...files },
        ...(partial !== undefined && { partial }),
        ...(endedAt !== undefined && { endedAt }),
      };
      // A reprocessed set may have failed before.
      delete next.error;
      return next;
    });
  }

  /**
   * Forget some of a set's files (see `pipeline/retention.ts`). Returns their absolute
   * paths for the caller to delete, once session.json no longer lists them.
   */
  async dropFiles(setId: string, keys: readonly (keyof SetFiles)[]): Promise<string[]> {
    const set = this.set(setId);
    const dropped = keys.flatMap((key) => {
      const file = set?.files[key];
      return file === undefined ? [] : [path.join(this.paths.dir, file)];
    });
    if (dropped.length === 0) return [];
    await this.#updateSet(setId, (current) => {
      const files = Object.fromEntries(
        Object.entries(current.files).filter(([key]) => !keys.includes(key as keyof SetFiles)),
      );
      return { ...current, files };
    });
    return dropped;
  }

  /** Post-processing failed; the raw capture stays, so it can be re-run. */
  failSet(setId: string, error: string): Promise<void> {
    return this.#updateSet(setId, (set) => ({ ...set, status: 'failed', error }));
  }

  /**
   * Record the end time and final title, renaming the folder to match the title. Call it
   * once post-processing is done, so no encode is writing into the folder.
   */
  finish(info: SessionInfo, endedAt: Date): Promise<void> {
    return this.#exclusive(async () => {
      await this.#reload();
      this.#session = {
        ...this.#session,
        ...(info.title && { title: info.title }),
        endedAt: endedAt.toISOString(),
      };
      const wanted = sessionDirName(info.startedAt, label(info));
      if (wanted !== this.#baseName) {
        const dirName = await freeDirName(this.#recordingsDir, wanted);
        await rename(this.paths.dir, path.join(this.#recordingsDir, dirName));
        this.#baseName = wanted;
        this.#dirName = dirName;
      }
      await this.#save();
    });
  }

  #updateSet(setId: string, update: (set: StreamSet) => StreamSet): Promise<void> {
    return this.#exclusive(async () => {
      await this.#reload();
      this.#session = {
        ...this.#session,
        sets: this.#session.sets.map((set) => (set.id === setId ? update(set) : set)),
      };
      await this.#save();
    });
  }

  /** Run `step` after every earlier write has finished, whether or not it failed. */
  #exclusive<T>(step: () => Promise<T>): Promise<T> {
    const result = this.#lock.then(step, step);
    this.#lock = result.catch(() => undefined);
    return result;
  }

  /** Pick up changes other processes made to session.json; keep this copy if it's gone. */
  async #reload(): Promise<void> {
    const onDisk = await readJsonFile(this.paths.sessionFile, sessionSchema);
    if (onDisk) this.#session = onDisk;
  }

  async #save(): Promise<void> {
    await writeJsonFileAtomic(this.paths.sessionFile, this.#session);
    await writeFile(this.paths.setlistFile, setlistCsv(this.#session.sets));
  }
}
