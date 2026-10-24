import { describe, expect, it } from 'vitest';
import { concatAudioArgs } from './encode.ts';

describe('concatAudioArgs', () => {
  it('joins every input in order into one float32 WAV', () => {
    expect(concatAudioArgs(['a.wav', 'b.wav', 'c.wav'], 'out.wav')).toEqual([
      '-i',
      'a.wav',
      '-i',
      'b.wav',
      '-i',
      'c.wav',
      '-filter_complex',
      '[0:a][1:a][2:a]concat=n=3:v=0:a=1[a]',
      '-map',
      '[a]',
      '-c:a',
      'pcm_f32le',
      'out.wav',
    ]);
  });
});
