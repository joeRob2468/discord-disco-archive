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
import { handleRecordCommand } from './handlers.ts';
import { toStreamEvents } from './voice-events.ts';

export interface BotDeps {
  config: DiscordConfig;
  sessions: SessionManager;
  logger: Logger;
}

export async function startBot({ config, sessions, logger }: BotDeps): Promise<Client> {
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
    for (const event of toStreamEvents(oldState, newState)) {
      logger.info(event, event.type === 'start' ? 'stream started' : 'stream ended');
      if (event.type === 'start')
        sessions.streamStarted(event.channelId, event.userId, event.displayName);
      else sessions.streamEnded(event.channelId, event.userId);
    }
  });

  client.on(Events.InteractionCreate, (interaction) => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== RECORD_COMMAND) return;
    if (!interaction.inCachedGuild() || interaction.guildId !== config.guildId) return;
    void onRecordCommand(interaction);
  });

  async function onRecordCommand(
    interaction: ChatInputCommandInteraction<'cached'>,
  ): Promise<void> {
    try {
      await handleRecordCommand(interaction, { config, sessions, logger });
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

  await client.login(config.botToken);
  return client;
}
