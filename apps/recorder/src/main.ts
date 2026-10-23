/**
 * Recorder composition root.
 *
 * Milestone 3: the bot and session logic only. Target changes are logged and announced
 * in the channel; the browser and capture get wired to them in milestone 4. Until then the container's default
 * command stays `smoke.ts` (browser only); run this with `pnpm --filter @dsr/recorder dev`.
 */
import { createLogger } from '@dsr/core';
import type { Client } from 'discord.js';
import { createAnnouncer } from './bot/announcer.ts';
import { startBot } from './bot/bot.ts';
import { loadConfig } from './config.ts';
import { SessionManager } from './session/session-manager.ts';

const logger = createLogger('recorder');
const config = loadConfig();

// The announcer needs the client, which only exists after login.
const clientRef: { current?: Client } = {};
const announce = createAnnouncer(() => clientRef.current, logger);

const sessions = new SessionManager({
  onTargetChange: (change, session) => {
    logger.info(
      {
        channelId: session.channelId,
        from: change.from?.displayName,
        to: change.to?.displayName,
        reason: change.reason,
      },
      'recording target changed (capture arrives in milestone 4)',
    );
    if (config.discord.announceSets) announce(change, session);
  },
});

const client = await startBot({ config: config.discord, sessions, logger });
clientRef.current = client;

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    logger.info({ signal }, 'shutting down');
    void client.destroy().finally(() => process.exit(0));
  });
}
