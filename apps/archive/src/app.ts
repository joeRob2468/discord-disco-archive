/**
 * Builds the HTTP app from its dependencies. Kept separate from `main.ts` so tests can
 * call `app.request()` against an in-memory database without opening a port.
 */
import type { Logger } from '@dsr/core';
import { Hono } from 'hono';
import { csrf } from 'hono/csrf';
import { HTTPException } from 'hono/http-exception';
import { secureHeaders } from 'hono/secure-headers';
import { createAuth, type AuthEnv } from './auth/auth.ts';
import { NotFoundError, type Catalog } from './catalog/catalog.ts';
import type { ArchiveConfig } from './config.ts';
import { adminRoutes } from './routes/admin.tsx';
import { browseRoutes } from './routes/browse.tsx';
import { mediaRoutes } from './routes/media.ts';
import { sessionRoutes } from './routes/session.tsx';
import { STYLESHEET } from './views/styles.ts';

export interface AppDeps {
  config: ArchiveConfig;
  catalog: Catalog;
  logger?: Logger;
}

/** Reachable without logging in, even when a viewer password is set. */
const PUBLIC_PATHS = new Set(['/healthz', '/login', '/logout', '/assets/style.css']);

export function createApp({ config, catalog, logger }: AppDeps): Hono<AuthEnv> {
  const app = new Hono<AuthEnv>();
  const auth = createAuth(config.auth);

  app.get('/healthz', (c) => c.json({ ok: true }));

  app.get('/assets/style.css', (c) => {
    c.header('Content-Type', 'text/css; charset=utf-8');
    c.header('Cache-Control', 'public, max-age=3600');
    return c.body(STYLESHEET);
  });

  app.use(secureHeaders({ crossOriginEmbedderPolicy: false }));
  // Form posts must come from our own origin.
  app.use(csrf({ origin: new URL(config.publicUrl).origin }));
  app.use(auth.middleware);

  app.use(async (c, next) => {
    if (!c.var.auth.canView && !PUBLIC_PATHS.has(c.req.path)) {
      const next_ = encodeURIComponent(c.req.path + (new URL(c.req.url).search || ''));
      return c.redirect(`/login?next=${next_}`, 303);
    }
    await next();
  });

  app.route('/', sessionRoutes(auth));
  app.route('/', browseRoutes(catalog));
  app.route('/', adminRoutes(catalog));
  app.route('/', mediaRoutes(catalog, config.recordingsDir));

  app.onError((error, c) => {
    if (error instanceof HTTPException) return error.getResponse();
    if (error instanceof NotFoundError) return c.text('Not found', 404);
    logger?.error({ err: error, path: c.req.path }, 'request failed');
    return c.text('Internal error', 500);
  });

  return app;
}
