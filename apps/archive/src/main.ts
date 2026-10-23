import { serve } from '@hono/node-server';
import { createLogger } from '@dsr/core';
import { createApp } from './app.ts';
import { loadConfig } from './config.ts';

const logger = createLogger('archive');
const config = loadConfig();
const app = createApp({ config });

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  logger.info({ port: info.port, recordingsDir: config.recordingsDir }, 'archive listening');
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    logger.info({ signal }, 'shutting down');
    server.close(() => process.exit(0));
  });
}
