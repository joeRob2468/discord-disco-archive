/**
 * `/record` subcommand handlers. They translate Discord interactions into
 * SessionManager calls and reply; all decisions live in the session manager.
 */
import type { Logger } from '@dsr/core';
import {
  MessageFlags,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  type InteractionReplyOptions,
  type VoiceBasedChannel,
} from 'discord.js';
import type { SessionOnDisk } from '../capture/session-record.ts';
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
  /** Reopen the current target's stream if it isn't being recorded; false if it is. */
  retryTarget?: (() => boolean) | undefined;
  /** `/record split`: why it can't split now, or undefined once the split is queued. */
  split?: ((names: { name?: string; previous?: string }) => string | undefined) | undefined;
  /** A voice channel's sessions on disk, newest first, for `/record resume`. */
  findSessions?: ((channelId: string) => Promise<SessionOnDisk[]>) | undefined;
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
    case 'resume':
      return resume(interaction, deps);
    case 'stop':
      return stop(interaction, deps);
    case 'status':
      return status(interaction, deps);
    case 'switch':
      return switchTarget(interaction, deps);
    case 'split':
      return split(interaction, deps);
    case 'title':
      return title(interaction, deps);
    default:
      await replyPrivately(interaction, `Unknown subcommand \`${subcommand}\`.`);
  }
}

/**
 * The voice channel `/record start` or `/record resume` is for, once the recorder can
 * record there, with who is live in it. Refuses (and returns undefined) otherwise.
 */
async function recordableChannel(
  interaction: Interaction,
  { config, logger, preflight }: HandlerDeps,
): Promise<
  { channel: VoiceBasedChannel; liveNow: { userId: string; displayName: string }[] } | undefined
> {
  const invokedIn = interaction.channel;
  const target = resolveTargetChannel({
    optionChannelId: interaction.options.getChannel('channel')?.id,
    invokedInVoiceChannelId: invokedIn?.isVoiceBased() ? invokedIn.id : undefined,
    callerVoiceChannelId: interaction.member.voice.channelId ?? undefined,
  });
  if (!target.ok) {
    await refuse(interaction, logger, target.reason);
    return undefined;
  }

  const channel = interaction.guild.channels.cache.get(target.channelId);
  if (!channel?.isVoiceBased()) {
    await refuse(interaction, logger, "I can't see that voice channel.");
    return undefined;
  }

  const problems = await checkRecorderAccess(interaction.guild, channel, config.recorderUserId);
  if (problems.length > 0) {
    await refuse(interaction, logger, problems.join('\n'));
    return undefined;
  }

  // Catch a logged-out recorder now, not halfway through joining voice.
  const blocked = await preflight?.();
  if (blocked) {
    await refuse(interaction, logger, blocked);
    return undefined;
  }

  const liveNow = channel.members
    .filter((member) => member.voice.streaming === true && member.id !== config.recorderUserId)
    .map((member) => ({ userId: member.id, displayName: member.displayName }));
  return { channel, liveNow };
}

async function start(interaction: Interaction, deps: HandlerDeps): Promise<void> {
  const { sessions, logger } = deps;
  const recordable = await recordableChannel(interaction, deps);
  if (!recordable) return;
  const { channel, liveNow } = recordable;

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

/** `/record resume`: carry on an earlier session of the channel, adding new sets to it. */
async function resume(interaction: Interaction, deps: HandlerDeps): Promise<void> {
  const { sessions, logger, findSessions } = deps;
  if (sessions.active) {
    return refuse(
      interaction,
      logger,
      `Already recording in <#${sessions.active.channelId}>. Run \`/record stop\` first.`,
    );
  }
  const recordable = await recordableChannel(interaction, deps);
  if (!recordable) return;
  const { channel, liveNow } = recordable;

  const chosen = interaction.options.getString('session');
  const found = (await findSessions?.(channel.id)) ?? [];
  const previous = chosen === null ? found[0] : found.find((session) => session.dir === chosen);
  if (!previous) {
    return refuse(
      interaction,
      logger,
      chosen === null
        ? `There's no earlier session in <#${channel.id}> to resume. Use \`/record start\`.`
        : `That session isn't one of <#${channel.id}>'s. Pick one from the list.`,
    );
  }

  const result = sessions.start(
    {
      guildId: interaction.guildId,
      channelId: channel.id,
      channelName: channel.name,
      title: previous.title,
      startedAt: previous.startedAt,
      startedBy: { userId: interaction.user.id, displayName: interaction.member.displayName },
      resumeDir: previous.dir,
    },
    liveNow,
  );
  if (!result.ok) return refuse(interaction, logger, result.reason);
  await reply(
    interaction,
    messages.sessionResumed(result.session, previous.sets, sessions.status()?.target),
  );
}

const SHORT_DATE = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });

/** `/record resume`'s `session` choices: the channel's latest sessions, newest first. */
export async function autocompleteSessions(
  interaction: AutocompleteInteraction<'cached'>,
  { findSessions }: HandlerDeps,
): Promise<void> {
  const invokedIn = interaction.channel;
  const channelId = invokedIn?.isVoiceBased()
    ? invokedIn.id
    : (interaction.member.voice.channelId ?? undefined);
  const typed = interaction.options.getFocused().toLowerCase();
  const found = channelId ? ((await findSessions?.(channelId)) ?? []) : [];
  const choices = found
    .map((session) => {
      const label = `${session.title ?? session.channelName} · ${SHORT_DATE.format(session.startedAt)} · ${String(session.sets)} ${session.sets === 1 ? 'set' : 'sets'}`;
      return { name: label.slice(0, 100), value: session.dir.slice(0, 100) };
    })
    .filter((choice) => choice.name.toLowerCase().includes(typed))
    .slice(0, 25);
  await interaction.respond(choices);
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
  { sessions, logger, retryTarget }: HandlerDeps,
): Promise<void> {
  const user = interaction.options.getUser('user', true);
  const result = sessions.switchTo(user.id, interaction.user.id);
  if (!result.ok) return refuse(interaction, logger, result.reason);
  if (!result.change) {
    // Already the target: retry their stream if opening it failed.
    if (retryTarget?.()) return replyPrivately(interaction, `Retrying <@${user.id}>'s stream.`);
    return replyPrivately(interaction, `Already recording <@${user.id}>.`);
  }
  // The switch itself is announced in the channel by the announcer.
  await replyPrivately(interaction, `Switching to <@${user.id}>.`);
}

async function split(
  interaction: Interaction,
  { split: splitSet, logger }: HandlerDeps,
): Promise<void> {
  const text = (option: string): string | undefined => {
    const value = interaction.options.getString(option)?.trim();
    return value === '' ? undefined : value;
  };
  const refusal =
    splitSet?.({ name: text('name'), previous: text('previous') }) ?? 'Not available.';
  if (refusal) return refuse(interaction, logger, refusal);
  // The split itself is announced in the channel by the controller.
  await replyPrivately(interaction, 'Splitting the set here.');
}

async function title(interaction: Interaction, { sessions, logger }: HandlerDeps): Promise<void> {
  const text = interaction.options.getString('text', true).trim();
  const session = sessions.setTitle(text);
  if (!session) return refuse(interaction, logger, 'No recording session is active.');
  logger.info({ title: text, userId: interaction.user.id }, 'session title changed');
  await reply(interaction, messages.titleChanged(text));
}
