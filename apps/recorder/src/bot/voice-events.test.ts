import { describe, expect, it } from 'vitest';
import { toStreamEvents, type VoiceStateLike } from './voice-events.ts';

const state = (channelId: string | null, streaming: boolean | null): VoiceStateLike => ({
  id: 'u1',
  channelId,
  streaming,
  member: { displayName: 'DJ' },
});

describe('toStreamEvents', () => {
  it('detects going live', () => {
    expect(toStreamEvents(state('c1', false), state('c1', true))).toEqual([
      { type: 'start', channelId: 'c1', userId: 'u1', displayName: 'DJ' },
    ]);
  });

  it('detects stopping', () => {
    expect(toStreamEvents(state('c1', true), state('c1', false))).toEqual([
      { type: 'end', channelId: 'c1', userId: 'u1' },
    ]);
  });

  it('treats leaving voice while live as stopping', () => {
    expect(toStreamEvents(state('c1', true), state(null, null))).toEqual([
      { type: 'end', channelId: 'c1', userId: 'u1' },
    ]);
  });

  it('treats moving channels while live as stop + start', () => {
    expect(toStreamEvents(state('c1', true), state('c2', true)).map((e) => e.type)).toEqual([
      'end',
      'start',
    ]);
  });

  it('ignores mute/deafen changes and null streaming flags', () => {
    expect(toStreamEvents(state('c1', true), state('c1', true))).toEqual([]);
    expect(toStreamEvents(state('c1', null), state('c1', false))).toEqual([]);
  });
});
