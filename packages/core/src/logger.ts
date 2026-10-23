import { pino, type Logger } from 'pino';

export type { Logger };

/**
 * JSON logger on stdout. Level comes from `LOG_LEVEL` (default `info`).
 * For readable output in development, pipe through `pino-pretty`.
 */
export function createLogger(name: string): Logger {
  return pino({
    name,
    level: process.env['LOG_LEVEL'] ?? 'info',
  });
}
