/**
 * Which voice channel `/record start` targets. See docs/design.md, "Commands":
 * 1. the `channel` option; 2. the voice channel whose chat the command was typed in;
 * 3. the voice channel the caller is connected to.
 */

export interface TargetChannelInput {
  /** The `channel` option, if given (already restricted to voice types by Discord). */
  optionChannelId: string | undefined;
  /** The channel the command was used in, if it's voice-based. */
  invokedInVoiceChannelId: string | undefined;
  /** The caller's current voice channel, if connected. */
  callerVoiceChannelId: string | undefined;
}

export type TargetChannelResult =
  | { ok: true; channelId: string; source: 'option' | 'invoked-in' | 'caller-voice' }
  | { ok: false; reason: string };

export function resolveTargetChannel(input: TargetChannelInput): TargetChannelResult {
  if (input.optionChannelId)
    return { ok: true, channelId: input.optionChannelId, source: 'option' };
  if (input.invokedInVoiceChannelId) {
    return { ok: true, channelId: input.invokedInVoiceChannelId, source: 'invoked-in' };
  }
  if (input.callerVoiceChannelId) {
    return { ok: true, channelId: input.callerVoiceChannelId, source: 'caller-voice' };
  }
  return {
    ok: false,
    reason:
      "Run this in a voice channel's chat, join the voice channel first, or pass the `channel` option.",
  };
}
