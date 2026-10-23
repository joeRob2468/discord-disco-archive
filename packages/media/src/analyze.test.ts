import { describe, expect, it } from 'vitest';
import { parseDuration, parseSilences, trimRange } from './analyze.ts';

describe('parseSilences', () => {
  it('pairs starts with ends and closes a silence still open at the end', () => {
    const stderr = `
[silencedetect @ 0x1] silence_start: -0.0213
[silencedetect @ 0x1] silence_end: 4.5 | silence_duration: 4.52
[silencedetect @ 0x1] silence_start: 1790.2
`;
    expect(parseSilences(stderr, 1800)).toEqual([
      { start: 0, end: 4.5 },
      { start: 1790.2, end: 1800 },
    ]);
  });
});

describe('parseDuration', () => {
  it('reads the input duration, not the lagging progress time', () => {
    const stderr = [
      "Input #0, wav, from 'set.wav':",
      '  Duration: 01:02:03.50, bitrate: 3072 kb/s',
      'size=N/A time=01:02:00.60 bitrate=N/A speed= 95x',
    ].join('\n');
    expect(parseDuration(stderr)).toBe(3723.5);
  });

  it('fails without progress output', () => {
    expect(() => parseDuration('nothing')).toThrow(/No duration/);
  });
});

describe('trimRange', () => {
  it('trims leading and trailing silence, keeping the padding', () => {
    const silences = [
      { start: 0, end: 12 },
      { start: 600, end: 620 },
      { start: 3500, end: 3600 },
    ];
    expect(trimRange(silences, 3600, 0.5)).toEqual({ start: 11.5, end: 3500.5 });
  });

  it('keeps everything when the set starts and ends with sound', () => {
    expect(trimRange([{ start: 600, end: 620 }], 3600, 0.5)).toEqual({ start: 0, end: 3600 });
  });

  it('does not trim a set that is one long silence to nothing twice', () => {
    expect(trimRange([{ start: 0, end: 60 }], 60, 0.5)).toEqual({ start: 59.5, end: 60 });
  });
});
