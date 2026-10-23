/**
 * Posts a notice in the session's voice channel chat whenever the recording target
 * changes, so whoever runs the event can see what the recorder is doing.
 */
import type { Logger } from '@dsr/core';
import type { Client } from 'discord.js';
import type { SessionInfo, TargetChange } from '../session/session-manager.ts';
import { targetChanged } from './messages.ts';

export function createAnnouncer(getClient: () => Client | undefined, logger: Logger) {
  return (change: TargetChange, session: SessionInfo): void => {
    const content = targetChanged(change);
    if (!content) return;
    const channel = getClient()?.channels.cache.get(session.channelId);
    if (!channel?.isSendable()) {
      logger.warn({ channelId: session.channelId }, 'cannot post announcement in channel');
      return;
    }
    channel.send({ content, allowedMentions: { parse: [] } }).catch((error: unknown) => {
      // Usually a missing Send Messages permission in the voice channel.
      logger.warn({ err: error, channelId: session.channelId }, 'announcement failed');
    });
  };
}
