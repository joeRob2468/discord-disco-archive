/**
 * The discord.js client: registers `/record`, routes interactions to the handlers, and
 * feeds Go Live start/end events into the session manager.
 */
import type { Logger } from '@dsr/core';
import {
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { DiscordConfig } from '../config.ts';
import type { SessionManager } from '../session/session-manager.ts';
import { RECORD_COMMAND, registerCommands } from './commands.ts';
import type { SessionOnDisk } from '../capture/session-record.ts';
import { autocompleteSessions, handleRecordCommand } from './handlers.ts';
import { toStreamEvents } from './voice-events.ts';

export interface BotDeps {
  config: DiscordConfig;
  sessions: SessionManager;
  logger: Logger;
  /** Why the recorder can't record right now (e.g. logged out), checked by `/record start`. */
  preflight?: () => Promise<string | undefined>;
  /** `/record check`: start the browser ahead of an event; the reply to send. */
  check?: () => Promise<string>;
  /** The recorder account left a voice channel (disconnected, moved or kicked). */
  onRecorderLeftVoice?: (channelId: string) => void;
  /** `/record switch` to the current target: reopen its stream if it isn't being recorded. */
  retryTarget?: () => boolean;
  /** `/record split`: why it can't split now, or undefined once the split is queued. */
  split?: (names: { name?: string; previous?: string }) => string | undefined;
  /** A voice channel's sessions on disk, for `/record resume`. */
  findSessions?: (channelId: string) => Promise<SessionOnDisk[]>;
}

export async function startBot(deps: BotDeps): Promise<Client> {
  const {
    config,
    sessions,
    logger,
    preflight,
    check,
    onRecorderLeftVoice,
    retryTarget,
    split,
    findSessions,
  } = deps;
  // Neither intent is privileged: Guilds (channels, roles) and GuildVoiceStates (Go Live).
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
  });

  client.once(Events.ClientReady, (ready) => {
    logger.info({ user: ready.user.tag }, 'bot connected');
    const guild = ready.guilds.cache.get(config.guildId);
    if (!guild) {
      logger.error({ guildId: config.guildId }, 'bot is not in DISCORD_GUILD_ID; invite it first');
      return;
    }
    registerCommands(guild, config.commandDefaultPermission).then(
      () => {
        logger.info({ guild: guild.name }, '/record registered');
      },
      (error: unknown) => {
        logger.error({ err: error }, 'failed to register /record');
      },
    );
  });

  client.on(Events.VoiceStateUpdate, (oldState, newState) => {
    if (newState.guild.id !== config.guildId) return;
    // The recorder account is never a DJ, even if someone tests by streaming from it. Its
    // own moves matter, though: leaving the session's channel unasked means a drop.
    if (newState.id === config.recorderUserId) {
      if (oldState.channelId && oldState.channelId !== newState.channelId) {
        logger.info(
          { from: oldState.channelId, to: newState.channelId ?? null },
          'recorder account left a voice channel',
        );
        onRecorderLeftVoice?.(oldState.channelId);
      }
      return;
    }
    for (const event of toStreamEvents(oldState, newState)) {
      logger.info(event, event.type === 'start' ? 'stream started' : 'stream ended');
      if (event.type === 'start')
        sessions.streamStarted(event.channelId, event.userId, event.displayName);
      else sessions.streamEnded(event.channelId, event.userId);
    }
  });

  client.on(Events.InteractionCreate, (interaction) => {
    if (!interaction.inCachedGuild() || interaction.guildId !== config.guildId) return;
    if (interaction.isAutocomplete() && interaction.commandName === RECORD_COMMAND) {
      // Only `/record resume`'s session list autocompletes.
      autocompleteSessions(interaction, { config, sessions, logger, findSessions }).catch(
        (error: unknown) => {
          logger.warn({ err: error }, 'autocomplete failed');
        },
      );
      return;
    }
    if (!interaction.isChatInputCommand() || interaction.commandName !== RECORD_COMMAND) return;
    void onRecordCommand(interaction);
  });

  async function onRecordCommand(
    interaction: ChatInputCommandInteraction<'cached'>,
  ): Promise<void> {
    try {
      await handleRecordCommand(interaction, {
        config,
        sessions,
        logger,
        preflight,
        check,
        retryTarget,
        split,
        findSessions,
      });
    } catch (error) {
      logger.error({ err: error }, 'command failed');
      const content = 'Something went wrong; check the recorder logs.';
      if (interaction.replied || interaction.deferred) {
        await interaction
          .followUp({ content, flags: MessageFlags.Ephemeral })
          .catch(() => undefined);
      } else {
        await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => undefined);
      }
    }
  }

  client.on(Events.Error, (error) => {
    logger.error({ err: error }, 'discord client error');
  });
  // Gateway connection changes: a bot that's quietly offline misses /record and Go Live events.
  client.on(Events.ShardDisconnect, (event, shardId) => {
    logger.warn({ shardId, code: event.code }, 'discord gateway disconnected');
  });
  client.on(Events.ShardReconnecting, (shardId) => {
    logger.warn({ shardId }, 'discord gateway reconnecting');
  });
  client.on(Events.ShardResume, (shardId, replayedEvents) => {
    logger.info({ shardId, replayedEvents }, 'discord gateway resumed');
  });
  client.on(Events.ShardError, (error, shardId) => {
    logger.error({ err: error, shardId }, 'discord gateway error');
  });
  client.on(Events.Warn, (message) => {
    logger.warn({ message }, 'discord client warning');
  });

  await client.login(config.botToken);
  return client;
}
