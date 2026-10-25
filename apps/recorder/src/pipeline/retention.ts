/**
 * Disk cleanup for finished sessions (docs/design.md, "Processing"): once a set is leveled,
 * its raw capture is deleted `RAW_RETENTION_HOURS` after the master was written, and
 * exports no longer in `EXPORT_FORMATS` are removed. The FLAC master and the remaining
 * exports are kept. Only `ready` sets with a master on disk are touched, so a failed or
 * unprocessed set keeps its raw capture, its only copy.
 *
 * Sessions without `endedAt` are skipped: the controller holds their session.json in
 * memory and would write the files back.
 */
import { readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { SESSION_FILE, type Logger, type SetFiles } from '@dsr/core';
import { SessionRecord } from '../capture/session-record.ts';

/** The exports the recorder makes. */
const EXPORTS = ['mp3', 'm4a'] as const satisfies readonly (keyof SetFiles)[];

export interface RetentionConfig {
  /** Hours after leveling to keep the raw capture; `undefined` keeps it forever. */
  rawRetentionHours: number | undefined;
  exportFormats: readonly (typeof EXPORTS)[number][];
}

export interface SweepResult {
  files: number;
  bytes: number;
}

const sizeOf = (file: string): Promise<number | undefined> =>
  stat(file).then(
    (info) => info.size,
    () => undefined,
  );

/** Leveling time: when the master was written (re-processing rewrites it). */
const masterTime = (file: string): Promise<number | undefined> =>
  stat(file).then(
    (info) => info.mtimeMs,
    () => undefined,
  );

export async function sweepRecordings(
  recordingsDir: string,
  config: RetentionConfig,
  logger: Logger,
  now: number = Date.now(),
): Promise<SweepResult> {
  const result: SweepResult = { files: 0, bytes: 0 };
  let entries;
  try {
    entries = await readdir(recordingsDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return result;
    throw error;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name.startsWith('_')) continue;
    if ((await sizeOf(path.join(recordingsDir, entry.name, SESSION_FILE))) === undefined) continue;
    let record: SessionRecord;
    try {
      record = await SessionRecord.open(recordingsDir, entry.name);
    } catch (error) {
      logger.warn({ err: error, dir: entry.name }, 'retention: skipping unreadable session');
      continue;
    }
    if (record.session.endedAt === undefined) continue;

    for (const set of record.session.sets) {
      if (set.status !== 'ready' || set.files.master === undefined) continue;
      const leveledAt = await masterTime(path.join(record.paths.dir, set.files.master));
      if (leveledAt === undefined) continue;

      const drop: (keyof SetFiles)[] = EXPORTS.filter(
        (format) => set.files[format] !== undefined && !config.exportFormats.includes(format),
      );
      const hours = config.rawRetentionHours;
      if (
        hours !== undefined &&
        set.files.rawAudio !== undefined &&
        now - leveledAt >= hours * 3_600_000
      ) {
        drop.push('rawAudio');
      }
      if (drop.length === 0) continue;

      // session.json first: if a delete then fails, the file is only unreferenced.
      const files = await record.dropFiles(set.id, drop);
      for (const file of files) {
        result.bytes += (await sizeOf(file)) ?? 0;
        await rm(file, { force: true });
        result.files += 1;
      }
      logger.info({ dir: entry.name, setId: set.id, dropped: drop }, 'retention: removed files');
    }
  }
  return result;
}
