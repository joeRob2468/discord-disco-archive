/**
 * Pass 1 for a finished set: one ffmpeg run measures loudness (for loudnorm's second
 * pass) and finds leading and trailing silence, so setup time and dead air at the ends
 * can be trimmed (docs/design.md, "Partial sets"). Silence inside the
 * set is left alone; it may be a quiet passage.
 */
import { runFfmpeg, type RunOptions } from './ffmpeg.ts';
import {
  measureFilter,
  parseMeasurement,
  type LoudnessMeasurement,
  type LoudnessTargets,
} from './loudnorm.ts';

export interface SilenceOptions {
  /** Audio below this counts as silence, dBFS. */
  thresholdDb: number;
  /** Shortest silence worth trimming, seconds. */
  minSeconds: number;
  /** Silence to keep before the first and after the last sound, seconds. */
  padSeconds: number;
}

/** Part of the input to keep, in seconds from its start. */
export interface TrimRange {
  start: number;
  end: number;
}

export interface SetAnalysis {
  loudness: LoudnessMeasurement;
  /** Input duration, seconds. */
  duration: number;
  trim: TrimRange;
}

interface Silence {
  start: number;
  end: number;
}

/** Silences from `silencedetect` output; one still open at the end runs to `duration`. */
export function parseSilences(stderr: string, duration: number): Silence[] {
  const silences: Silence[] = [];
  let open: number | undefined;
  for (const match of stderr.matchAll(/silence_(start|end): (-?[\d.]+)/g)) {
    const at = Math.max(0, Number(match[2]));
    if (match[1] === 'start') open = at;
    else if (open !== undefined) {
      silences.push({ start: open, end: at });
      open = undefined;
    }
  }
  if (open !== undefined) silences.push({ start: open, end: duration });
  return silences;
}

/**
 * Input duration from ffmpeg's input summary (`Duration: HH:MM:SS.ss`). Not the last
 * progress `time=`: loudnorm's 3 s lookahead makes that lag behind the input.
 */
export function parseDuration(stderr: string): number {
  const match = /Duration: (\d+):(\d+):([\d.]+)/.exec(stderr);
  if (!match) throw new Error('No duration found in ffmpeg output');
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

/** Keep everything between the first and last sound, plus `padSeconds` either side. */
export function trimRange(
  silences: readonly Silence[],
  duration: number,
  padSeconds: number,
): TrimRange {
  // silencedetect timestamps are block-aligned; allow a little slack at the edges.
  const EDGE = 0.1;
  const first = silences[0];
  const last = silences.at(-1);
  const start = first && first.start <= EDGE ? Math.max(0, first.end - padSeconds) : 0;
  const end =
    last && last.end >= duration - EDGE && last.start > start
      ? Math.min(duration, last.start + padSeconds)
      : duration;
  return { start, end };
}

export async function analyzeSet(
  input: string,
  targets: LoudnessTargets,
  silence: SilenceOptions,
  options?: RunOptions,
): Promise<SetAnalysis> {
  const detect = `silencedetect=noise=${String(silence.thresholdDb)}dB:d=${String(silence.minSeconds)}`;
  const stderr = await runFfmpeg(
    ['-i', input, '-vn', '-af', `${detect},${measureFilter(targets)}`, '-f', 'null', '-'],
    options,
  );
  const loudness = parseMeasurement(stderr);
  const duration = parseDuration(stderr);
  return {
    loudness,
    duration,
    trim: trimRange(parseSilences(stderr, duration), duration, silence.padSeconds),
  };
}
