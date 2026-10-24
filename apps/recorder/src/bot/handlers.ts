/**
 * `/record` subcommand handlers. They translate Discord interactions into
 * SessionManager calls and reply; all decisions live in the session manager.
 */
import type { Logger } from '@dsr/core';
import {
  MessageFlags,
  type ChatInputCommandInteraction,
  type InteractionReplyOptions,
} from 'discord.js';
import type { DiscordConfig } from '../config.ts';
import type { SessionManager } from '../session/session-manager.ts';
import { resolveTargetChannel } from '../session/target-channel.ts';
import * as messages from './messages.ts';
import { checkRecorderAccess } from './recorder-access.ts';

export interface HandlerDeps {
  sessions: SessionManager;
  config: DiscordConfig;
  logger: Logger;
  preflight?: (() => Promise<string | undefined>) | undefined;
}

type Interaction = ChatInputCommandInteraction<'cached'>;

const NO_PINGS = { allowedMentions: { parse: [] } } satisfies InteractionReplyOptions;

async function reply(interaction: Interaction, content: string): Promise<void> {
  await interaction.reply({ content, ...NO_PINGS });
}

async function replyPrivately(interaction: Interaction, content: string): Promise<void> {
  await interaction.reply({ content, flags: MessageFlags.Ephemeral, ...NO_PINGS });
}

/** Turn a command down, privately, and log why. */
async function refuse(interaction: Interaction, logger: Logger, reason: string): Promise<void> {
  logger.info(
    {
      subcommand: interaction.options.getSubcommand(false),
      userId: interaction.user.id,
      reason,
    },
    'command refused',
  );
  await replyPrivately(interaction, reason);
}

export async function handleRecordCommand(
  interaction: Interaction,
  deps: HandlerDeps,
): Promise<void> {
  const { allowedRoleIds } = deps.config;
  if (allowedRoleIds.length > 0 && !interaction.member.roles.cache.hasAny(...allowedRoleIds)) {
    await refuse(
      interaction,
      deps.logger,
      "You don't have a role that's allowed to use `/record`.",
    );
    return;
  }

  const subcommand = interaction.options.getSubcommand();
  deps.logger.info({ subcommand, userId: interaction.user.id }, 'command');
  switch (subcommand) {
    case 'start':
      return start(interaction, deps);
    case 'stop':
      return stop(interaction, deps);
    case 'status':
      return status(interaction, deps);
    case 'switch':
      return switchTarget(interaction, deps);
    case 'title':
      return title(interaction, deps);
    default:
      await replyPrivately(interaction, `Unknown subcommand \`${subcommand}\`.`);
  }
}

async function start(
  interaction: Interaction,
  { sessions, config, logger, preflight }: HandlerDeps,
): Promise<void> {
  const invokedIn = interaction.channel;
  const target = resolveTargetChannel({
    optionChannelId: interaction.options.getChannel('channel')?.id,
    invokedInVoiceChannelId: invokedIn?.isVoiceBased() ? invokedIn.id : undefined,
    callerVoiceChannelId: interaction.member.voice.channelId ?? undefined,
  });
  if (!target.ok) return refuse(interaction, logger, target.reason);

  const channel = interaction.guild.channels.cache.get(target.channelId);
  if (!channel?.isVoiceBased()) {
    return refuse(interaction, logger, "I can't see that voice channel.");
  }

  const problems = await checkRecorderAccess(interaction.guild, channel, config.recorderUserId);
  if (problems.length > 0) return refuse(interaction, logger, problems.join('\n'));

  // Catch a logged-out recorder now, not halfway through joining voice.
  const blocked = await preflight?.();
  if (blocked) return refuse(interaction, logger, blocked);

  const liveNow = channel.members
    .filter((member) => member.voice.streaming === true && member.id !== config.recorderUserId)
    .map((member) => ({ userId: member.id, displayName: member.displayName }));

  const result = sessions.start(
    {
      guildId: interaction.guildId,
      channelId: channel.id,
      channelName: channel.name,
      title: interaction.options.getString('title') ?? undefined,
      startedBy: { userId: interaction.user.id, displayName: interaction.member.displayName },
    },
    liveNow,
  );
  if (!result.ok) return refuse(interaction, logger, result.reason);
  if (result.alreadyRunning) {
    return replyPrivately(
      interaction,
      'Already recording this channel. `/record status` for details.',
    );
  }
  await reply(interaction, messages.sessionStarted(result.session, sessions.status()?.target));
}

async function stop(interaction: Interaction, { sessions, logger }: HandlerDeps): Promise<void> {
  const session = sessions.stop();
  if (!session) return refuse(interaction, logger, 'No recording session is active.');
  await reply(interaction, messages.sessionStopped(session, new Date()));
}

async function status(interaction: Interaction, { sessions }: HandlerDeps): Promise<void> {
  const current = sessions.status();
  await replyPrivately(
    interaction,
    current ? messages.status(current, new Date()) : 'No recording session is active.',
  );
}

async function switchTarget(
  interaction: Interaction,
  { sessions, logger }: HandlerDeps,
): Promise<void> {
  const user = interaction.options.getUser('user', true);
  const result = sessions.switchTo(user.id, interaction.user.id);
  if (!result.ok) return refuse(interaction, logger, result.reason);
  if (!result.change) {
    return replyPrivately(interaction, `Already recording <@${user.id}>.`);
  }
  // The switch itself is announced in the channel by the announcer.
  await replyPrivately(interaction, `Switching to <@${user.id}>.`);
}

async function title(interaction: Interaction, { sessions, logger }: HandlerDeps): Promise<void> {
  const text = interaction.options.getString('text', true).trim();
  const session = sessions.setTitle(text);
  if (!session) return refuse(interaction, logger, 'No recording session is active.');
  logger.info({ title: text, userId: interaction.user.id }, 'session title changed');
  await reply(interaction, messages.titleChanged(text));
}
