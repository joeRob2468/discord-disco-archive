/**
 * Live audio capture from a PulseAudio source: one ffmpeg process writes the float32
 * WAV and runs `silencedetect` on the same audio, so the recorder can hand over when a
 * stream goes quiet (docs/design.md, "Whose stream to record").
 * https://ffmpeg.org/ffmpeg-filters.html#silencedetect
 */
import { spawnFfmpeg, type FfmpegProcess, type SpawnOptions } from './ffmpeg.ts';

export interface AudioCaptureOptions {
  /** PulseAudio source, e.g. `recorder.monitor`. */
  source: string;
  /** Output `.wav` path. */
  output: string;
  /** Audio below `thresholdDb` for `seconds` counts as silence. */
  silence: { thresholdDb: number; seconds: number };
}

export function audioCaptureArgs({ source, output, silence }: AudioCaptureOptions): string[] {
  // prettier-ignore
  return [
    '-nostats',
    // Ask pulse for float samples (its default is s16), matching the float32 sink.
    '-thread_queue_size', '1024', '-c:a', 'pcm_f32le', '-f', 'pulse', '-i', source,
    // RF64 once past 4 GB (about 2.9 h of float stereo), plain WAV below that.
    '-map', '0:a', '-c:a', 'pcm_f32le', '-rf64', 'auto', output,
    '-map', '0:a', '-af', `silencedetect=noise=${String(silence.thresholdDb)}dB:d=${String(silence.seconds)}`,
    '-f', 'null', '-',
  ];
}

/** `at` is seconds since the capture started. */
export type SilenceEvent = { type: 'start'; at: number } | { type: 'end'; at: number };

/**
 * Parse a `silencedetect` log line. `silence_start` is logged once the silence has
 * lasted the full duration, so it means "has been silent for `seconds`".
 */
export function parseSilenceLine(line: string): SilenceEvent | undefined {
  const match = /silence_(start|end): (-?[\d.]+)/.exec(line);
  if (!match?.[1] || !match[2]) return undefined;
  return { type: match[1] === 'start' ? 'start' : 'end', at: Number(match[2]) };
}

export function captureAudio(
  options: AudioCaptureOptions,
  onSilence: (event: SilenceEvent) => void,
  spawnOptions: Omit<SpawnOptions, 'onLine'> = {},
): FfmpegProcess {
  return spawnFfmpeg(audioCaptureArgs(options), {
    ...spawnOptions,
    onLine: (line) => {
      const event = parseSilenceLine(line);
      if (event) onSilence(event);
    },
  });
}
