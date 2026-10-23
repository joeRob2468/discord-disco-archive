/**
 * HTTP routes. Kept separate from `main.ts` so tests can exercise the app without
 * opening a port.
 */
import { Hono } from 'hono';
import type { ArchiveConfig } from './config.ts';

export interface AppDeps {
  config: ArchiveConfig;
}

export function createApp(_deps: AppDeps): Hono {
  const app = new Hono();

  app.get('/healthz', (c) => c.json({ ok: true }));

  return app;
}
