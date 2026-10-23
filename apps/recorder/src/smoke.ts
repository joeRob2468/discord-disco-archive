/**
 * Milestone 1 smoke test: start the browser with the persistent profile and open
 * Discord, then stay running so you can log in and test audio over noVNC.
 * Stops cleanly on SIGINT/SIGTERM.
 */
import { createLogger } from '@dsr/core';
import { DISCORD_APP_URL, launchBrowser } from './browser/launch.ts';
import { loadBrowserConfig } from './config.ts';

const logger = createLogger('recorder:smoke');
const config = loadBrowserConfig();

logger.info({ channel: config.channel, profileDir: config.profileDir }, 'launching browser');
const context = await launchBrowser(config);
const page = context.pages()[0] ?? (await context.newPage());
await page.goto(DISCORD_APP_URL);
logger.info({ url: page.url() }, 'Discord opened; log in over noVNC if prompted');

const shutdown = async (signal: string): Promise<void> => {
  logger.info({ signal }, 'closing browser');
  await context.close();
  process.exit(0);
};

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => void shutdown(signal));
}
