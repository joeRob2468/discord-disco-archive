/**
 * Recorder configuration from the environment (`.env`, see `.env.example` and
 * docs/plan.md, "Configuration"). Split into sections so each module, and scripts
 * like `smoke.ts`, only require the settings they use.
 */
import {
  envBoolean,
  envInteger,
  envList,
  envNumber,
  optional,
  parseEnv,
  snowflakeSchema,
  withDefault,
} from '@dsr/core';
import { PermissionFlagsBits } from 'discord.js';
import { z } from 'zod';

const videoSizeSchema = z
  .string()
  .regex(/^\d+x\d+$/, 'Expected WIDTHxHEIGHT, e.g. 1920x1080')
  .transform((value) => {
    const [width, height] = value.split('x').map(Number) as [number, number];
    return { width, height };
  });

const permissionNameSchema = z
  .string()
  .refine((name): name is keyof typeof PermissionFlagsBits => name in PermissionFlagsBits, {
    message: 'Expected a discord.js PermissionFlagsBits name, e.g. ManageEvents',
  });

const discordSchema = z
  .object({
    DISCORD_BOT_TOKEN: z.string().min(1),
    DISCORD_GUILD_ID: snowflakeSchema,
    RECORDER_USER_ID: snowflakeSchema,
    COMMAND_DEFAULT_PERMISSION: withDefault(permissionNameSchema, 'ManageEvents'),
    ALLOWED_ROLE_IDS: withDefault(envList.pipe(z.array(snowflakeSchema)), ''),
    ANNOUNCE_SETS: withDefault(envBoolean, 'true'),
  })
  .transform((env) => ({
    botToken: env.DISCORD_BOT_TOKEN,
    guildId: env.DISCORD_GUILD_ID,
    recorderUserId: env.RECORDER_USER_ID,
    commandDefaultPermission: PermissionFlagsBits[env.COMMAND_DEFAULT_PERMISSION],
    allowedRoleIds: env.ALLOWED_ROLE_IDS,
    announceSets: env.ANNOUNCE_SETS,
  }));

const browserSchema = z
  .object({
    PROFILE_DIR: withDefault(z.string().min(1), './docker-data/recorder/profile'),
    BROWSER_CHANNEL: withDefault(z.enum(['chrome', 'chromium']), 'chrome'),
    VIDEO_SIZE: withDefault(videoSizeSchema, '1920x1080'),
  })
  .transform((env) => ({
    profileDir: env.PROFILE_DIR,
    channel: env.BROWSER_CHANNEL,
    windowSize: env.VIDEO_SIZE,
  }));

const captureSchema = z
  .object({
    /** PulseAudio source to record; the entrypoint creates the `recorder` null sink. */
    PULSE_SOURCE: withDefault(z.string().min(1), 'recorder.monitor'),
    /** X display the browser runs on; set by the container entrypoint. */
    DISPLAY: withDefault(z.string().min(1), ':99'),
    RECORD_VIDEO: withDefault(envBoolean, 'false'),
    VIDEO_FPS: withDefault(envInteger.min(1).max(120), '30'),
    VIDEO_SIZE: withDefault(videoSizeSchema, '1920x1080'),
  })
  .transform((env) => ({
    pulseSource: env.PULSE_SOURCE,
    display: env.DISPLAY,
    recordVideo: env.RECORD_VIDEO,
    videoFps: env.VIDEO_FPS,
    videoSize: env.VIDEO_SIZE,
  }));

const processingSchema = z
  .object({
    TARGET_LUFS: withDefault(envNumber.min(-70).max(-5), '-14'),
    TARGET_TP: withDefault(envNumber.min(-9).max(0), '-1'),
    TARGET_LRA: withDefault(envNumber.min(1).max(50), '11'),
    EXPORT_FORMATS: withDefault(envList.pipe(z.array(z.enum(['mp3', 'm4a']))), 'mp3,m4a'),
    RAW_RETENTION_DAYS: optional(envInteger.min(0)),
  })
  .transform((env) => ({
    targets: { integrated: env.TARGET_LUFS, truePeak: env.TARGET_TP, range: env.TARGET_LRA },
    exportFormats: env.EXPORT_FORMATS,
    rawRetentionDays: env.RAW_RETENTION_DAYS,
  }));

const sessionSchema = z
  .object({
    RECORDINGS_DIR: withDefault(z.string().min(1), './data/recordings'),
    RESTART_GRACE_SECONDS: withDefault(envInteger.min(0), '60'),
  })
  .transform((env) => ({
    recordingsDir: env.RECORDINGS_DIR,
    restartGraceMs: env.RESTART_GRACE_SECONDS * 1000,
  }));

export type DiscordConfig = z.output<typeof discordSchema>;
export type BrowserConfig = z.output<typeof browserSchema>;
export type CaptureConfig = z.output<typeof captureSchema>;
export type ProcessingConfig = z.output<typeof processingSchema>;
export type SessionConfig = z.output<typeof sessionSchema>;

export interface RecorderConfig {
  discord: DiscordConfig;
  browser: BrowserConfig;
  capture: CaptureConfig;
  processing: ProcessingConfig;
  session: SessionConfig;
}

export const loadBrowserConfig = (env = process.env): BrowserConfig => parseEnv(browserSchema, env);

export function loadConfig(env = process.env): RecorderConfig {
  return {
    discord: parseEnv(discordSchema, env),
    browser: parseEnv(browserSchema, env),
    capture: parseEnv(captureSchema, env),
    processing: parseEnv(processingSchema, env),
    session: parseEnv(sessionSchema, env),
  };
}
