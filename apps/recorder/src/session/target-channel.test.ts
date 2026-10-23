import { describe, expect, it } from 'vitest';
import { resolveTargetChannel } from './target-channel.ts';

const none = {
  optionChannelId: undefined,
  invokedInVoiceChannelId: undefined,
  callerVoiceChannelId: undefined,
};

describe('resolveTargetChannel', () => {
  it('prefers the explicit option', () => {
    expect(
      resolveTargetChannel({
        optionChannelId: '1',
        invokedInVoiceChannelId: '2',
        callerVoiceChannelId: '3',
      }),
    ).toEqual({ ok: true, channelId: '1', source: 'option' });
  });

  it('uses the voice channel whose chat the command was typed in', () => {
    expect(
      resolveTargetChannel({ ...none, invokedInVoiceChannelId: '2', callerVoiceChannelId: '3' }),
    ).toEqual({
      ok: true,
      channelId: '2',
      source: 'invoked-in',
    });
  });

  it("falls back to the caller's voice channel", () => {
    expect(resolveTargetChannel({ ...none, callerVoiceChannelId: '3' })).toMatchObject({
      channelId: '3',
      source: 'caller-voice',
    });
  });

  it('explains what to do otherwise', () => {
    expect(resolveTargetChannel(none)).toMatchObject({ ok: false });
  });
});
