/**
 * Two-pass EBU R128 loudness normalisation.
 *
 * Pass 1 measures the whole set with ffmpeg's `loudnorm` filter.
 * https://ffmpeg.org/ffmpeg-filters.html#loudnorm
 *
 * Pass 2 is not loudnorm: it applies one fixed gain to reach the integrated target, then
 * an oversampled limiter holds true peaks under the ceiling. loudnorm's own pass 2 only
 * stays linear when the set's loudness range fits `LRA` and the gain leaves the peaks
 * alone; otherwise it compresses the whole set and misses the target by up to 2 LU
 * (docs/research.md, milestone 5). Here every set gets the same gain treatment, and
 * only the peaks above the ceiling are touched.
 */

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
  /** Pass 1's `target_offset`. Informational: pass 2 deliberately doesn't use it. */
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

/** Limiting at 4x 48 kHz catches the peaks between samples (true peak, BS.1770). */
const OVERSAMPLED_RATE = 192_000;
/** Headroom below the true-peak target for resampling back to 48 kHz and lossy encodes. */
const CEILING_MARGIN_DB = 0.3;

/** Pass 2: one gain to the integrated target, then a true-peak limiter at the ceiling. */
export function levelFilter(targets: LoudnessTargets, measured: LoudnessMeasurement): string {
  const gainDb = targets.integrated - measured.integrated;
  const ceiling = 10 ** ((targets.truePeak - CEILING_MARGIN_DB) / 20);
  return [
    `volume=${format(gainDb)}dB`,
    `aresample=${String(OVERSAMPLED_RATE)}`,
    // level=false: no auto make-up gain. latency=true: compensate the lookahead delay.
    `alimiter=limit=${ceiling.toFixed(4)}:attack=1:release=100:level=false:latency=true`,
  ].join(',');
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
