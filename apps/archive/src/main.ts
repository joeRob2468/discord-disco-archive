import { serve } from '@hono/node-server';
import { createLogger } from '@dsr/core';
import { createApp } from './app.ts';
import { Catalog } from './catalog/catalog.ts';
import { watchCatalog } from './catalog/watch.ts';
import { loadConfig } from './config.ts';
import { openDatabase } from './db/database.ts';

const logger = createLogger('archive');
const config = loadConfig();

const db = openDatabase(config.dataDir);
const watcher = watchCatalog(db, config.recordingsDir, config.syncIntervalMs, logger);
await watcher.sync();

const app = createApp({ config, catalog: new Catalog(db), logger });

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
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
});

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
