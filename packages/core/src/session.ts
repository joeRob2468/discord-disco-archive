/**
 * On-disk data model shared by the recorder (writer) and the archive (reader).
 *
 * `session.json` lives in each session folder and is the source of truth for that
 * session. `state.json` lives in the recordings root and points at the active session,
 * so the recorder can resume after a restart.
 */
import { z } from 'zod';

export const SCHEMA_VERSION = 1;

/** Discord snowflake ID (user, guild, channel). */
export const snowflakeSchema = z.string().regex(/^\d{17,20}$/, 'Expected a Discord snowflake ID');

const timestampSchema = z.iso.datetime({ offset: true });

/** File paths relative to the session folder. Each is set once that file exists. */
export const setFilesSchema = z.object({
  /** Float32 WAV capture straight from PulseAudio. */
  rawAudio: z.string().optional(),
  /** MKV capture (H.264 + float32 audio) when video recording is on. */
  rawVideo: z.string().optional(),
  /** Loudness-normalised FLAC master. */
  master: z.string().optional(),
  mp3: z.string().optional(),
  /** AAC audio for in-browser playback. */
  m4a: z.string().optional(),
  /** H.264 + leveled AAC with faststart, for in-browser playback. */
  mp4: z.string().optional(),
});

export const setStatusSchema = z.enum(['recording', 'processing', 'ready', 'failed']);

/** One DJ's continuous Go Live stream within a session. */
export const streamSetSchema = z.object({
  id: z.string().min(1),
  userId: snowflakeSchema,
  /** Server display name when the stream started. */
  displayName: z.string().min(1),
  avatarUrl: z.url().optional(),
  startedAt: timestampSchema,
  endedAt: timestampSchema.optional(),
  /** True when the recording missed the start or end of the stream. */
  partial: z.boolean(),
  /** Hidden sets are kept on disk but not listed by the archive. */
  hidden: z.boolean().default(false),
  status: setStatusSchema,
  /** Set when `status` is `failed`. */
  error: z.string().optional(),
  files: setFilesSchema,
});

export const sessionSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: z.string().min(1),
  title: z.string().min(1).optional(),
  guildId: snowflakeSchema,
  channelId: snowflakeSchema,
  channelName: z.string().min(1),
  startedAt: timestampSchema,
  endedAt: timestampSchema.optional(),
  startedBy: z.object({
    userId: snowflakeSchema,
    displayName: z.string().min(1),
  }),
  sets: z.array(streamSetSchema),
});

export const recorderStateSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  activeSession: z
    .object({
      sessionId: z.string().min(1),
      /** Session folder name, relative to the recordings root. */
      dir: z.string().min(1),
    })
    .nullable(),
});

export type SetFiles = z.infer<typeof setFilesSchema>;
export type SetStatus = z.infer<typeof setStatusSchema>;
export type StreamSet = z.infer<typeof streamSetSchema>;
export type Session = z.infer<typeof sessionSchema>;
export type RecorderState = z.infer<typeof recorderStateSchema>;
