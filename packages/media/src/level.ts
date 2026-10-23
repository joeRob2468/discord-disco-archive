/**
 * Quick level checks on a live PulseAudio source with ffmpeg's `volumedetect` filter,
 * to confirm audio is actually flowing before and during a capture.
 * https://ffmpeg.org/ffmpeg-filters.html#volumedetect
 */
import { runFfmpeg, type RunOptions } from './ffmpeg.ts';

export interface VolumeLevel {
  /** Mean volume, dBFS; `-Infinity` for digital silence. */
  mean: number;
  /** Peak volume, dBFS; `-Infinity` for digital silence. */
  max: number;
}

const parseDb = (value: string): number => (value === '-inf' ? -Infinity : Number(value));

/** Extract `mean_volume` and `max_volume` from ffmpeg's stderr. */
export function parseVolumeDetect(stderr: string): VolumeLevel {
  const mean = /mean_volume:\s*(-inf|-?[\d.]+) dB/.exec(stderr)?.[1];
  const max = /max_volume:\s*(-inf|-?[\d.]+) dB/.exec(stderr)?.[1];
  if (mean === undefined || max === undefined) {
    throw new Error('No volumedetect results found in ffmpeg output');
  }
  return { mean: parseDb(mean), max: parseDb(max) };
}

/** Listen to a PulseAudio source for `seconds` and report its level. */
export async function measurePulseLevel(
  source: string,
  seconds: number,
  options: RunOptions = {},
): Promise<VolumeLevel> {
  // prettier-ignore
  const stderr = await runFfmpeg([
    '-f', 'pulse', '-i', source,
    '-t', String(seconds),
    '-af', 'volumedetect',
    '-f', 'null', '-',
  ], options);
  return parseVolumeDetect(stderr);
}
