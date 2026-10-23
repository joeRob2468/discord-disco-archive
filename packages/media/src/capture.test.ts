import { describe, expect, it } from 'vitest';
import { audioCaptureArgs, parseSilenceLine } from './capture.ts';

describe('audioCaptureArgs', () => {
  it('captures float audio and detects silence in one process', () => {
    const args = audioCaptureArgs({
      source: 'recorder.monitor',
      output: '/recordings/s/raw/set.wav',
      silence: { thresholdDb: -60, seconds: 45 },
    });
    const joined = args.join(' ');
    expect(joined).toContain('-c:a pcm_f32le -f pulse -i recorder.monitor');
    expect(joined).toContain('-c:a pcm_f32le -rf64 auto /recordings/s/raw/set.wav');
    expect(joined).toContain('silencedetect=noise=-60dB:d=45');
  });
});

describe('parseSilenceLine', () => {
  it('reads silence start and end', () => {
    expect(parseSilenceLine('[silencedetect @ 0x55c79624f540] silence_start: 0.586979')).toEqual({
      type: 'start',
      at: 0.586979,
    });
    expect(
      parseSilenceLine('[silencedetect @ 0x55c7] silence_end: 3 | silence_duration: 2.41302'),
    ).toEqual({ type: 'end', at: 3 });
  });

  it('ignores other lines', () => {
    expect(parseSilenceLine('Stream #0:0: Audio: pcm_f32le, 48000 Hz, stereo')).toBeUndefined();
  });
});
