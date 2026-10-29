import { serve } from '@hono/node-server';
import { createLogger } from '@dsr/core';
import { createApp } from './app.ts';
import { avatarCopier } from './avatars.ts';
import { Catalog } from './catalog/catalog.ts';
import { watchCatalog } from './catalog/watch.ts';
import { loadConfig } from './config.ts';
import { openDatabase } from './db/database.ts';
import { imagesDir } from './images.ts';

const logger = createLogger('archive');

// Log crashes as JSON before exiting, so they show in `docker compose logs` like the rest.
process.on('uncaughtException', (error) => {
  logger.fatal({ err: error }, 'uncaught exception; exiting');
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: reason }, 'unhandled promise rejection; exiting');
  process.exit(1);
});
const config = loadConfig();

const db = openDatabase(config.dataDir);
const catalog = new Catalog(db);
const copyAvatars = avatarCopier(
  catalog,
  imagesDir(config.dataDir),
  logger.child({ module: 'avatars' }),
);
const watcher = watchCatalog(db, config.recordingsDir, config.syncIntervalMs, logger, copyAvatars);
await watcher.sync();

const app = createApp({ config, catalog, logger });

const server = serve(
  {
    fetch: app.fetch,
    port: config.port,
  },
  (info) => {
    logger.info(
      {
        port: info.port,
        recordingsDir: config.recordingsDir,
        dataDir: config.dataDir,
        viewerPassword: config.auth.viewerPassword !== undefined,
        adminEnabled: config.auth.adminPassword !== undefined,
      },
      'archive listening',
    );
  },
);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    logger.info({ signal }, 'shutting down');
    watcher.close();
    server.close(() => {
      db.close();
      process.exit(0);
    });
    // close() waits for open connections: idle keep-alives and, worse, a browser
    // streaming a set would hold shutdown (and `node --watch` restarts) open forever.
    if ('closeIdleConnections' in server) server.closeIdleConnections();
    setTimeout(() => {
      if ('closeAllConnections' in server) server.closeAllConnections();
    }, 5000).unref();
  });
}
