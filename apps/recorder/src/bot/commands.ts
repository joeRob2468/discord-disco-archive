/**
 * The `/record` slash command. Registered as a guild command, which updates instantly
 * (global commands can take time to propagate).
 */
import {
  ChannelType,
  InteractionContextType,
  SlashCommandBuilder,
  type Guild,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';

export const RECORD_COMMAND = 'record';

export function buildRecordCommand(
  defaultPermission: bigint | null,
): RESTPostAPIChatInputApplicationCommandsJSONBody {
  return new SlashCommandBuilder()
    .setName(RECORD_COMMAND)
    .setDescription('Record Go Live DJ sets in a voice channel')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(defaultPermission)
    .addSubcommand((sub) =>
      sub
        .setName('start')
        .setDescription("Start recording this voice channel's streams")
        .addChannelOption((option) =>
          option
            .setName('channel')
            .setDescription('Voice channel to record (default: this one, or the one you are in)')
            .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice),
        )
        .addStringOption((option) =>
          option
            .setName('title')
            .setDescription('Session title, e.g. "Halloween Disco"')
            .setMaxLength(100),
        ),
    )
    .addSubcommand((sub) => sub.setName('stop').setDescription('Stop recording'))
    .addSubcommand((sub) =>
      sub.setName('status').setDescription("Show who's live and who is being recorded"),
    )
    .addSubcommand((sub) =>
      sub
        .setName('switch')
        .setDescription("Record a specific streamer's stream now")
        .addUserOption((option) =>
          option
            .setName('user')
            .setDescription('Someone who is live in the channel')
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('title')
        .setDescription("Set the session's title")
        .addStringOption((option) =>
          option.setName('text').setDescription('New title').setRequired(true).setMaxLength(100),
        ),
    )
    .toJSON();
}

/** Replace this application's guild commands with `/record`. */
export async function registerCommands(
  guild: Guild,
  defaultPermission: bigint | null,
): Promise<void> {
  await guild.commands.set([buildRecordCommand(defaultPermission)]);
}
