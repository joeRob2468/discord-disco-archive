import type { Context } from 'hono';

/**
 * The client's address as Traefik reports it. On the server the archive is only reached
 * through Traefik, which replaces any `X-Forwarded-For` a client sends. Undefined when
 * there's no proxy (local dev).
 */
export const clientIp = (c: Context): string | undefined =>
  c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? c.req.header('x-real-ip');
