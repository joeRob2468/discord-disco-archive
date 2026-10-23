/**
 * Posts notices in the session's voice channel chat: whenever the recording target
 * changes, so whoever runs the event can see what the recorder is doing, and when the
 * recorder runs into trouble.
 */
import type { Logger } from '@dsr/core';
import type { Client } from 'discord.js';
import type { SessionInfo, TargetChange } from '../session/session-manager.ts';
import { targetChanged } from './messages.ts';

export type PostToChannel = (channelId: string, content: string) => void;

/** Fire-and-forget channel message; failures are logged, never thrown. */
export function createChannelPoster(
  getClient: () => Client | undefined,
  logger: Logger,
): PostToChannel {
  return (channelId, content) => {
    const channel = getClient()?.channels.cache.get(channelId);
    if (!channel?.isSendable()) {
      logger.warn({ channelId }, 'cannot post in channel');
      return;
    }
    channel.send({ content, allowedMentions: { parse: [] } }).catch((error: unknown) => {
      // Usually a missing Send Messages permission in the voice channel.
      logger.warn({ err: error, channelId }, 'channel post failed');
    });
  };
}

export function createAnnouncer(post: PostToChannel) {
  return (change: TargetChange, session: SessionInfo): void => {
    const content = targetChanged(change);
    if (content) post(session.channelId, content);
  };
}
