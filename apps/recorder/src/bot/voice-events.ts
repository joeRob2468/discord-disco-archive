/**
 * Turns a `voiceStateUpdate` (old state, new state) into Go Live start/end events.
 * Moving channels while live counts as ending in one and starting in the other.
 */

/** The fields we need from discord.js's `VoiceState`. */
export interface VoiceStateLike {
  id: string;
  channelId: string | null;
  streaming: boolean | null;
  member: { displayName: string } | null;
}

export type StreamEvent =
  | { type: 'start'; channelId: string; userId: string; displayName: string }
  | { type: 'end'; channelId: string; userId: string };

export function toStreamEvents(oldState: VoiceStateLike, newState: VoiceStateLike): StreamEvent[] {
  const events: StreamEvent[] = [];
  // `streaming` is optional in the API; treat null as false.
  const wasLiveIn = oldState.streaming === true ? oldState.channelId : null;
  const isLiveIn = newState.streaming === true ? newState.channelId : null;
  if (wasLiveIn === isLiveIn) return events;

  if (wasLiveIn) events.push({ type: 'end', channelId: wasLiveIn, userId: oldState.id });
  if (isLiveIn) {
    events.push({
      type: 'start',
      channelId: isLiveIn,
      userId: newState.id,
      displayName: newState.member?.displayName ?? newState.id,
    });
  }
  return events;
}
