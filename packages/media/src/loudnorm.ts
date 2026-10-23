/**
 * Two-pass EBU R128 loudness normalisation with ffmpeg's `loudnorm` filter.
 * https://ffmpeg.org/ffmpeg-filters.html#loudnorm
 *
 * Pass 1 measures the whole set. Pass 2 feeds those measurements back with
 * `linear=true`, so the set gets one constant gain change (dynamics untouched)
 * unless the true-peak ceiling forces loudnorm into dynamic mode.
 */
import { runFfmpeg, type RunOptions } from './ffmpeg.ts';

export interface LoudnessTargets {
  /** Integrated loudness, LUFS (-70 to -5). */
  integrated: number;
  /** Maximum true peak, dBTP (-9 to 0). */
  truePeak: number;
  /** Loudness range, LU (1 to 50). */
  range: number;
}

export interface LoudnessMeasurement {
  integrated: number;
  truePeak: number;
  range: number;
  threshold: number;
  /** Gain loudnorm suggests for pass 2 (`target_offset`). */
  offset: number;
}

export class SilentInputError extends Error {
  constructor() {
    super('Input is silent; loudness cannot be measured');
    this.name = 'SilentInputError';
  }
}

const format = (n: number): string => n.toFixed(2);

function targetOptions(targets: LoudnessTargets): string {
  return `I=${format(targets.integrated)}:TP=${format(targets.truePeak)}:LRA=${format(targets.range)}`;
}

/** Filter for pass 1. */
export function measureFilter(targets: LoudnessTargets): string {
  return `loudnorm=${targetOptions(targets)}:print_format=json`;
}

/** Filter for pass 2. */
export function normalizeFilter(targets: LoudnessTargets, measured: LoudnessMeasurement): string {
  return [
    `loudnorm=${targetOptions(targets)}`,
    `measured_I=${format(measured.integrated)}`,
    `measured_TP=${format(measured.truePeak)}`,
    `measured_LRA=${format(measured.range)}`,
    `measured_thresh=${format(measured.threshold)}`,
    `offset=${format(measured.offset)}`,
    'linear=true',
    'print_format=summary',
  ].join(':');
}

/** Extract pass-1 results from ffmpeg's stderr (loudnorm prints a JSON block last). */
export function parseMeasurement(stderr: string): LoudnessMeasurement {
  const start = stderr.lastIndexOf('{');
  const end = stderr.lastIndexOf('}');
  if (start === -1 || end < start) {
    throw new Error('No loudnorm JSON found in ffmpeg output');
  }

  const raw = JSON.parse(stderr.slice(start, end + 1)) as Record<string, string | undefined>;
  const read = (key: string): number => {
    const value = raw[key];
    if (value === undefined) throw new Error(`loudnorm output is missing "${key}"`);
    return Number(value);
  };

  const measurement: LoudnessMeasurement = {
    integrated: read('input_i'),
    truePeak: read('input_tp'),
    range: read('input_lra'),
    threshold: read('input_thresh'),
    offset: read('target_offset'),
  };

  // Silence measures as -inf; loudnorm can't do anything sensible with it.
  if (!Number.isFinite(measurement.integrated) || !Number.isFinite(measurement.threshold)) {
    throw new SilentInputError();
  }
  return measurement;
}

/** Pass 1: measure `input` against `targets`. */
export async function measureLoudness(
  input: string,
  targets: LoudnessTargets,
  options?: RunOptions,
): Promise<LoudnessMeasurement> {
  const stderr = await runFfmpeg(
    ['-i', input, '-vn', '-af', measureFilter(targets), '-f', 'null', '-'],
    options,
  );
  return parseMeasurement(stderr);
}
