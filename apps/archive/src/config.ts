/**
 * Archive configuration from the environment. See `.env.example`.
 */
import { envInteger, optional, parseEnv, withDefault } from '@dsr/core';
import { z } from 'zod';

const archiveSchema = z
  .object({
    /** Recordings volume, mounted read-only. */
    RECORDINGS_DIR: withDefault(z.string().min(1), './data/recordings'),
    /** App data: the SQLite database. */
    ARCHIVE_DATA_DIR: withDefault(z.string().min(1), './docker-data/archive'),
    ARCHIVE_PORT: withDefault(envInteger.min(1).max(65_535), '3000'),
    ARCHIVE_PUBLIC_URL: withDefault(z.url(), 'http://localhost:3000'),
    /** Shared viewer password. Unset = public. */
    ARCHIVE_PASSWORD: optional(z.string().min(8)),
    /** Admin password for hiding and editing. Unset = editing disabled. */
    ARCHIVE_ADMIN_PASSWORD: optional(z.string().min(12)),
    ARCHIVE_SESSION_SECRET: optional(z.string().min(32)),
    /** Fallback full rescan interval; file watching handles most changes. */
    ARCHIVE_SYNC_INTERVAL_SECONDS: withDefault(envInteger.min(10), '60'),
    /** Per-client cap on media bandwidth, in megabits per second; 0 = no cap. */
    ARCHIVE_DOWNLOAD_LIMIT_MBPS: withDefault(envInteger.min(0), '50'),
  })
  .refine(
    (env) =>
      (env.ARCHIVE_PASSWORD === undefined && env.ARCHIVE_ADMIN_PASSWORD === undefined) ||
      env.ARCHIVE_SESSION_SECRET !== undefined,
    {
      path: ['ARCHIVE_SESSION_SECRET'],
      message: 'Required (32+ characters) when ARCHIVE_PASSWORD or ARCHIVE_ADMIN_PASSWORD is set',
    },
  )
  .refine(
    (env) =>
      env.ARCHIVE_PASSWORD === undefined || env.ARCHIVE_PASSWORD !== env.ARCHIVE_ADMIN_PASSWORD,
    { path: ['ARCHIVE_ADMIN_PASSWORD'], message: 'Must differ from ARCHIVE_PASSWORD' },
  )
  .transform((env) => ({
    recordingsDir: env.RECORDINGS_DIR,
    dataDir: env.ARCHIVE_DATA_DIR,
    port: env.ARCHIVE_PORT,
    publicUrl: env.ARCHIVE_PUBLIC_URL,
    auth: {
      viewerPassword: env.ARCHIVE_PASSWORD,
      adminPassword: env.ARCHIVE_ADMIN_PASSWORD,
      sessionSecret: env.ARCHIVE_SESSION_SECRET,
      secureCookies: env.ARCHIVE_PUBLIC_URL.startsWith('https://'),
    },
    syncIntervalMs: env.ARCHIVE_SYNC_INTERVAL_SECONDS * 1000,
    downloadLimitBytesPerSecond: (env.ARCHIVE_DOWNLOAD_LIMIT_MBPS * 1_000_000) / 8,
  }));

export type ArchiveConfig = z.output<typeof archiveSchema>;
export type AuthConfig = ArchiveConfig['auth'];

export const loadConfig = (env = process.env): ArchiveConfig => parseEnv(archiveSchema, env);
