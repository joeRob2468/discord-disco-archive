/**
 * Pre-flight check before a session: can the recorder account actually join the
 * channel? Uses one REST member fetch (no privileged intent needed).
 */
import { PermissionFlagsBits, type Guild, type VoiceBasedChannel } from 'discord.js';

const REQUIRED = [
  ['View Channel', PermissionFlagsBits.ViewChannel],
  ['Connect', PermissionFlagsBits.Connect],
] as const;

/** Returns a list of problems; empty means OK. */
export async function checkRecorderAccess(
  guild: Guild,
  channel: VoiceBasedChannel,
  recorderUserId: string,
): Promise<string[]> {
  const member = await guild.members.fetch(recorderUserId).catch(() => undefined);
  if (!member)
    return [`The recorder account (<@${recorderUserId}>) isn't a member of this server.`];

  const permissions = channel.permissionsFor(member);
  const missing = REQUIRED.filter(([, flag]) => !permissions.has(flag)).map(([name]) => name);
  return missing.length === 0
    ? []
    : [`The recorder account is missing ${missing.join(' + ')} in <#${channel.id}>.`];
}
