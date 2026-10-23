/**
 * Post-processing for one finished set (docs/plan.md, "Leveling"): measure loudness and
 * the silence at both ends, write the trimmed, leveled FLAC master, then the exports.
 * The raw capture is never touched, so this can be re-run with other targets.
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { LEVELED_DIR, localDate, type Logger, type SetFiles } from '@dsr/core';
import {
  analyzeSet,
  encodeM4a,
  encodeMaster,
  encodeMp3,
  SilentInputError,
  type LoudnessTargets,
  type SilenceOptions,
  type Tags,
} from '@dsr/media';
import type { SessionRecord } from '../capture/session-record.ts';

/** Trim only real dead air: two seconds below -60 dB, keeping half a second of it. */
const END_SILENCE: SilenceOptions = { thresholdDb: -60, minSeconds: 2, padSeconds: 0.5 };

export interface ProcessingConfig {
  targets: LoudnessTargets;
  exportFormats: readonly ('mp3' | 'm4a')[];
}

const ENCODERS = { mp3: encodeMp3, m4a: encodeM4a } as const;

/**
 * Level and export one set, then mark it `ready`, or `failed` with the reason. If
 * `signal` aborts, it stops and leaves the set `processing` for a later run.
 */
export async function processSet(
  record: SessionRecord,
  setId: string,
  config: ProcessingConfig,
  { signal, logger }: { signal?: AbortSignal; logger: Logger },
): Promise<void> {
  const set = record.set(setId);
  if (!set?.files.rawAudio) throw new Error(`Set ${setId} has no raw audio`);
  const session = record.session;
  const dir = record.paths.dir;
  const raw = path.join(dir, set.files.rawAudio);
  const relative = (ext: string): string => path.posix.join(LEVELED_DIR, `${setId}.${ext}`);
  const absolute = (file: string): string => path.join(dir, file);

  const album = session.title ?? session.channelName;
  const tags: Tags = {
    title: `${set.displayName} – ${album}`,
    artist: set.displayName,
    album,
    date: localDate(new Date(set.startedAt)),
  };
  const options = signal ? { signal } : {};
  const started = Date.now();

  try {
    await mkdir(record.paths.leveledDir, { recursive: true });
    const analysis = await analyzeSet(raw, config.targets, END_SILENCE, options);
    logger.info(
      {
        setId,
        integrated: analysis.loudness.integrated,
        truePeak: analysis.loudness.truePeak,
        duration: analysis.duration,
        trim: analysis.trim,
      },
      'set analysed',
    );

    const files: SetFiles = { master: relative('flac') };
    await encodeMaster(raw, absolute(files.master ?? ''), config.targets, analysis.loudness, tags, {
      ...options,
      trim: analysis.trim,
    });
    for (const format of config.exportFormats) {
      const file = relative(format);
      await ENCODERS[format](absolute(files.master ?? ''), absolute(file), tags, options);
      files[format] = file;
    }

    await record.completeSet(setId, files);
    logger.info({ setId, files, seconds: (Date.now() - started) / 1000 }, 'set processed');
  } catch (error) {
    if (signal?.aborted) {
      logger.warn({ setId }, 'processing interrupted; the set stays "processing"');
      return;
    }
    const reason =
      error instanceof SilentInputError
        ? 'No audio: the whole set was silent.'
        : error instanceof Error
          ? error.message
          : String(error);
    logger.error({ err: error, setId }, 'processing failed');
    await record.failSet(setId, reason);
  }
}
