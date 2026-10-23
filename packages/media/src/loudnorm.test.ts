import { describe, expect, it } from 'vitest';
import { normalizeFilter, parseMeasurement, SilentInputError } from './loudnorm.ts';

const targets = { integrated: -14, truePeak: -1, range: 11 };

const stderr = `
size=N/A time=00:01:00.00 bitrate=N/A speed= 120x
[Parsed_loudnorm_0 @ 0x55d0c8a0b200]
{
	"input_i" : "-21.37",
	"input_tp" : "-3.02",
	"input_lra" : "6.40",
	"input_thresh" : "-31.55",
	"output_i" : "-14.02",
	"output_tp" : "-1.00",
	"output_lra" : "5.90",
	"output_thresh" : "-24.18",
	"normalization_type" : "dynamic",
	"target_offset" : "0.02"
}
`;

describe('parseMeasurement', () => {
  it('reads the input measurements and target offset', () => {
    expect(parseMeasurement(stderr)).toEqual({
      integrated: -21.37,
      truePeak: -3.02,
      range: 6.4,
      threshold: -31.55,
      offset: 0.02,
    });
  });

  it('rejects silent input', () => {
    const silent = stderr.replace('"-21.37"', '"-inf"').replace('"-31.55"', '"-inf"');
    expect(() => parseMeasurement(silent)).toThrow(SilentInputError);
  });

  it('fails when there is no JSON block', () => {
    expect(() => parseMeasurement('no stats here')).toThrow(/No loudnorm JSON/);
  });
});

describe('normalizeFilter', () => {
  it('passes the measurements back in linear mode', () => {
    expect(normalizeFilter(targets, parseMeasurement(stderr))).toBe(
      'loudnorm=I=-14.00:TP=-1.00:LRA=11.00:measured_I=-21.37:measured_TP=-3.02' +
        ':measured_LRA=6.40:measured_thresh=-31.55:linear=true:print_format=summary',
    );
  });

  it('never passes the offset, which overshoots in the dynamic fallback', () => {
    expect(normalizeFilter(targets, parseMeasurement(stderr))).not.toContain('offset=');
  });
});
