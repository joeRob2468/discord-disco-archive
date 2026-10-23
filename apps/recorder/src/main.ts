/**
 * Recorder composition root.
 *
 * Milestone 3: the bot and session logic only. Target changes are logged; the browser
 * and capture get wired to them in milestone 4. Until then the container's default
 * command stays `smoke.ts` (browser only); run this with `pnpm --filter @dsr/recorder dev`.
 */
import { createLogger } from '@dsr/core';
import { startBot } from './bot/bot.ts';
import { loadConfig } from './config.ts';
import { SessionManager } from './session/session-manager.ts';

const logger = createLogger('recorder');
const config = loadConfig();

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
  },
});

const client = await startBot({ config: config.discord, sessions, logger });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    logger.info({ signal }, 'shutting down');
    void client.destroy().finally(() => process.exit(0));
  });
}
