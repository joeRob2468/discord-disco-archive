/**
 * Encodes run after a set finishes. The FLAC master is the leveled source of truth;
 * every other format is derived from it.
 */
import type { TrimRange } from './analyze.ts';
import { runFfmpeg, type RunOptions } from './ffmpeg.ts';
import { levelFilter, type LoudnessMeasurement, type LoudnessTargets } from './loudnorm.ts';

export interface Tags {
  title?: string;
  artist?: string;
  album?: string;
  /** `YYYY-MM-DD` */
  date?: string;
}

const SAMPLE_RATE = '48000';

function metadataArgs(tags: Tags): string[] {
  return Object.entries(tags).flatMap(([key, value]) =>
    value === undefined ? [] : ['-metadata', `${key}=${value}`],
  );
}

export interface MasterOptions extends RunOptions {
  /** Keep only this part of the input (seconds), e.g. from `analyzeSet`. */
  trim?: TrimRange;
}

/** Pass 2: level the raw capture (gain + true-peak limiter) into a 24-bit FLAC master. */
export function encodeMaster(
  input: string,
  output: string,
  targets: LoudnessTargets,
  measured: LoudnessMeasurement,
  tags: Tags,
  { trim, ...options }: MasterOptions = {},
): Promise<string> {
  // As input options, -ss/-to seek exactly in PCM input.
  const trimArgs = trim ? ['-ss', trim.start.toFixed(3), '-to', trim.end.toFixed(3)] : [];
  return runFfmpeg(
    // prettier-ignore
    [
      ...trimArgs,
      '-i', input,
      '-vn',
      '-af', levelFilter(targets, measured),
      // The limiter runs oversampled; bring it back to the capture rate.
      '-ar', SAMPLE_RATE,
      '-c:a', 'flac', '-sample_fmt', 's32', '-compression_level', '8',
      ...metadataArgs(tags),
      output,
    ],
    options,
  );
}

/** MP3 320 kbps for downloads. */
export function encodeMp3(
  master: string,
  output: string,
  tags: Tags,
  options?: RunOptions,
): Promise<string> {
  return runFfmpeg(
    // prettier-ignore
    [
      '-i', master,
      '-c:a', 'libmp3lame', '-b:a', '320k', '-id3v2_version', '3',
      ...metadataArgs(tags),
      output,
    ],
    options,
  );
}

/** AAC in MP4 for in-browser playback; faststart so playback begins before download ends. */
export function encodeM4a(
  master: string,
  output: string,
  tags: Tags,
  options?: RunOptions,
): Promise<string> {
  return runFfmpeg(
    // prettier-ignore
    [
      '-i', master,
      '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart',
      ...metadataArgs(tags),
      output,
    ],
    options,
  );
}

/**
 * Join raw capture segments (same format) back to back into one float32 WAV, for a set
 * whose stream dropped and came back within the restart grace.
 */
export function concatAudioArgs(inputs: readonly string[], output: string): string[] {
  const streams = inputs.map((_, i) => `[${String(i)}:a]`).join('');
  // prettier-ignore
  return [
    ...inputs.flatMap((input) => ['-i', input]),
    '-filter_complex', `${streams}concat=n=${String(inputs.length)}:v=0:a=1[a]`,
    '-map', '[a]',
    '-c:a', 'pcm_f32le',
    output,
  ];
}

export function concatAudio(
  inputs: readonly string[],
  output: string,
  options?: RunOptions,
): Promise<string> {
  return runFfmpeg(concatAudioArgs(inputs, output), options);
}
