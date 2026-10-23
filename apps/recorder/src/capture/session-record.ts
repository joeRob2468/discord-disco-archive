/**
 * The session folder and its `session.json` (the recorder → archive contract, see
 * `@dsr/core`'s session schema). Creates the folder when a session starts, adds a set
 * per capture, and renames the folder at the end if the title changed.
 *
 * Calls must not overlap; the recording controller runs them one at a time.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  RAW_DIR,
  SCHEMA_VERSION,
  sessionDirName,
  sessionPaths,
  setBaseName,
  writeJsonFileAtomic,
  type Session,
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

export class SessionRecord {
  readonly #recordingsDir: string;
  /** The folder name before any `-2` suffix, to tell whether the title changed. */
  #baseName: string;
  #dirName: string;
  #session: Session;

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

  get paths() {
    return sessionPaths(this.#recordingsDir, this.#dirName);
  }

  get session(): Session {
    return this.#session;
  }

  /** Add a set in `recording` state. Returns its ID and the absolute WAV path to write. */
  async startSet(
    target: { userId: string; displayName: string },
    startedAt: Date,
    partial: boolean,
  ): Promise<{ setId: string; rawAudioPath: string }> {
    const setId = setBaseName(startedAt, target.displayName, target.userId);
    const rawAudio = path.posix.join(RAW_DIR, `${setId}.wav`);
    const set: StreamSet = {
      id: setId,
      userId: target.userId,
      displayName: target.displayName,
      startedAt: startedAt.toISOString(),
      partial,
      hidden: false,
      status: 'recording',
      files: { rawAudio },
    };
    this.#session = { ...this.#session, sets: [...this.#session.sets, set] };
    await this.#save();
    return { setId, rawAudioPath: path.join(this.paths.dir, rawAudio) };
  }

  /**
   * Close a set. Without `error` it waits for post-processing (milestone 5), so its
   * status is `processing`.
   */
  async endSet(
    setId: string,
    endedAt: Date,
    { partial, error }: { partial: boolean; error?: string },
  ): Promise<void> {
    this.#session = {
      ...this.#session,
      sets: this.#session.sets.map((set) =>
        set.id === setId
          ? {
              ...set,
              endedAt: endedAt.toISOString(),
              partial: set.partial || partial,
              status: error === undefined ? 'processing' : 'failed',
              ...(error !== undefined && { error }),
            }
          : set,
      ),
    };
    await this.#save();
  }

  /** Record the end time and final title, renaming the folder to match the title. */
  async finish(info: SessionInfo, endedAt: Date): Promise<void> {
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
  }

  #save(): Promise<void> {
    return writeJsonFileAtomic(this.paths.sessionFile, this.#session);
  }
}
