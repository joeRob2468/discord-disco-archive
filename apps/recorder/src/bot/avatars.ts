/**
 * DJs' avatar URLs for `session.json`, which the archive copies (it keeps each DJ's first
 * one). Their server avatar if they set one, else their account avatar; none for Discord's
 * default avatar, so the archive keeps its own. REST only, so the backfill script can use
 * it without a gateway connection.
 */
import type { Logger } from '@dsr/core';
import {
  DiscordAPIError,
  REST,
  RESTJSONErrorCodes,
  Routes,
  type APIGuildMember,
  type APIUser,
} from 'discord.js';
import type { SessionRecord } from '../capture/session-record.ts';

const IMAGE = { size: 256, extension: 'png' } as const;

export type AvatarLookup = (userId: string) => Promise<string | undefined>;

export function createAvatarLookup(token: string, guildId: string): AvatarLookup {
  const rest = new REST().setToken(token);
  // Per process: the archive only uses a DJ's first avatar, so there's no need to ask again.
  const known = new Map<string, string | undefined>();
  return async (userId) => {
    if (known.has(userId)) return known.get(userId);
    let url: string | undefined;
    try {
      const member = (await rest.get(Routes.guildMember(guildId, userId))) as APIGuildMember;
      const userAvatar = member.user.avatar;
      url = member.avatar
        ? rest.cdn.guildMemberAvatar(guildId, userId, member.avatar, IMAGE)
        : userAvatar
          ? rest.cdn.avatar(userId, userAvatar, IMAGE)
          : undefined;
    } catch (error) {
      if (!(error instanceof DiscordAPIError && error.code === RESTJSONErrorCodes.UnknownMember)) {
        throw error;
      }
      // No longer in the server: their account avatar.
      const user = (await rest.get(Routes.user(userId))) as APIUser;
      url = user.avatar ? rest.cdn.avatar(userId, user.avatar, IMAGE) : undefined;
    }
    known.set(userId, url);
    return url;
  };
}

/** Give a set its DJ's avatar URL, unless it has one. Failures are logged, not thrown. */
export async function fillAvatar(
  record: SessionRecord,
  setId: string,
  lookup: AvatarLookup,
  logger: Logger,
): Promise<boolean> {
  const set = record.set(setId);
  if (!set || set.avatarUrl !== undefined) return false;
  try {
    const url = await lookup(set.userId);
    if (url === undefined) return false;
    await record.setAvatar(setId, url);
    return true;
  } catch (error) {
    logger.warn({ err: error, setId, userId: set.userId }, "could not look up the DJ's avatar");
    return false;
  }
}
