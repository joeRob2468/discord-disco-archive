/**
 * Builds the HTTP app from its dependencies. Kept separate from `main.ts` so tests can
 * call `app.request()` against an in-memory database without opening a port.
 */
import { readFile } from 'node:fs/promises';
import type { Logger } from '@dsr/core';
import { Hono, type Context } from 'hono';
import { csrf } from 'hono/csrf';
import { HTTPException } from 'hono/http-exception';
import { secureHeaders } from 'hono/secure-headers';
import { ASSETS, publicFile } from './assets.ts';
import { createAuth, type AuthEnv } from './auth/auth.ts';
import { BandwidthLimiter } from './bandwidth.ts';
import { NotFoundError, type Catalog } from './catalog/catalog.ts';
import type { ArchiveConfig } from './config.ts';
import { imagesDir } from './images.ts';
import { adminRoutes } from './routes/admin.tsx';
import { browseRoutes } from './routes/browse.tsx';
import { mediaRoutes } from './routes/media.ts';
import { sessionRoutes } from './routes/session.tsx';

export interface AppDeps {
  config: ArchiveConfig;
  catalog: Catalog;
  logger?: Logger;
}

/**
 * Reachable without logging in, even when a viewer password is set, along with everything
 * under /assets/ (the login page's styles and font; link previews and icons, which chat
 * apps fetch without logging in).
 */
const PUBLIC_PATHS = new Set(['/healthz', '/login', '/logout', '/favicon.svg']);
const isPublic = (path: string): boolean => PUBLIC_PATHS.has(path) || path.startsWith('/assets/');

export function createApp({ config, catalog, logger }: AppDeps): Hono<AuthEnv> {
  const app = new Hono<AuthEnv>();
  const auth = createAuth(config.auth);

  app.get('/healthz', (c) => c.json({ ok: true }));

  const serveFile = async (c: Context, file: string, type: string) => {
    c.header('Content-Type', type);
    // Versioned links (`assetUrl`, or `?v=` by hand) change with the file: cache them for good.
    c.header(
      'Cache-Control',
      c.req.query('v') ? 'public, max-age=31536000, immutable' : 'public, max-age=300',
    );
    try {
      return c.body(await readFile(file));
    } catch {
      // dist/ is empty until `build:css` and `build:js` have run (or `dev`); the font is
      // copied in by hand (public/fonts).
      return c.notFound();
    }
  };
  for (const [route, file, type] of ASSETS) app.get(route, (c) => serveFile(c, file, type));
  app.get('/assets/*', (c) => {
    const found = publicFile(c.req.path.slice('/assets/'.length));
    return found ? serveFile(c, found.file, found.type) : c.notFound();
  });

  app.use(secureHeaders({ crossOriginEmbedderPolicy: false }));
  // Form posts must come from our own origin.
  app.use(csrf({ origin: new URL(config.publicUrl).origin }));
  app.use(auth.middleware);

  app.use(async (c, next) => {
    if (!c.var.auth.canView && !isPublic(c.req.path)) {
      const next_ = encodeURIComponent(c.req.path + (new URL(c.req.url).search || ''));
      return c.redirect(`/login?next=${next_}`, 303);
    }
    await next();
  });

  app.route('/', sessionRoutes(auth, config.publicUrl, logger?.child({ module: 'auth' })));
  app.route('/', browseRoutes(catalog, config.publicUrl));
  app.route(
    '/',
    adminRoutes(
      catalog,
      imagesDir(config.dataDir),
      config.recordingsDir,
      logger?.child({ module: 'admin' }),
    ),
  );
  const limiter =
    config.downloadLimitBytesPerSecond > 0
      ? new BandwidthLimiter(config.downloadLimitBytesPerSecond)
      : undefined;
  app.route('/', mediaRoutes(catalog, config.recordingsDir, imagesDir(config.dataDir), limiter));

  app.onError((error, c) => {
    if (error instanceof HTTPException) return error.getResponse();
    if (error instanceof NotFoundError) return c.text('Not found', 404);
    logger?.error({ err: error, path: c.req.path }, 'request failed');
    return c.text('Internal error', 500);
  });

  return app;
}
