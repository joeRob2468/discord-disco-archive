import { describe, expect, it } from 'vitest';
import { parseVolumeDetect } from './level.ts';

describe('parseVolumeDetect', () => {
  it('reads the mean and max volume', () => {
    const stderr = `
[Parsed_volumedetect_0 @ 0x5581c2d4e8c0] n_samples: 480000
[Parsed_volumedetect_0 @ 0x5581c2d4e8c0] mean_volume: -27.4 dB
[Parsed_volumedetect_0 @ 0x5581c2d4e8c0] max_volume: -9.1 dB
[Parsed_volumedetect_0 @ 0x5581c2d4e8c0] histogram_9db: 12
`;
    expect(parseVolumeDetect(stderr)).toEqual({ mean: -27.4, max: -9.1 });
  });

  it('reports digital silence as -Infinity', () => {
    const stderr = 'mean_volume: -91.0 dB\nmax_volume: -inf dB\n';
    expect(parseVolumeDetect(stderr)).toEqual({ mean: -91, max: -Infinity });
  });

  it('fails when there are no results', () => {
    expect(() => parseVolumeDetect('no stats here')).toThrow(/No volumedetect results/);
  });
});
