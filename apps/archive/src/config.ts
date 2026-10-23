/**
 * Archive configuration from the environment. See `.env.example`.
 */
import { envInteger, parseEnv, withDefault } from '@dsr/core';
import { z } from 'zod';

const archiveSchema = z
  .object({
    RECORDINGS_DIR: withDefault(z.string().min(1), './recordings'),
    ARCHIVE_PORT: withDefault(envInteger.min(1).max(65_535), '3000'),
    ARCHIVE_PUBLIC_URL: withDefault(z.url(), 'http://localhost:3000'),
  })
  .transform((env) => ({
    recordingsDir: env.RECORDINGS_DIR,
    port: env.ARCHIVE_PORT,
    publicUrl: env.ARCHIVE_PUBLIC_URL,
  }));

export type ArchiveConfig = z.output<typeof archiveSchema>;

export const loadConfig = (env = process.env): ArchiveConfig => parseEnv(archiveSchema, env);
