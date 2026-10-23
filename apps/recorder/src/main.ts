/**
 * Recorder composition root: the bot, the session manager, the browser running the
 * Discord web client as the recorder account, and the recording controller, all in one
 * process (docs/plan.md, "Components"). It needs Xvfb and PulseAudio, so it runs in the
 * container.
 */
import { createLogger } from '@dsr/core';
import type { Client } from 'discord.js';
import { createAnnouncer, createChannelPoster } from './bot/announcer.ts';
import { startBot } from './bot/bot.ts';
import { isLoggedOut } from './browser/discord-web.ts';
import { DISCORD_APP_URL, launchBrowser } from './browser/launch.ts';
import { RecordingController } from './capture/controller.ts';
import { loadConfig } from './config.ts';
import { processSet } from './pipeline/process-set.ts';
import { Processor } from './pipeline/processor.ts';
import { SessionManager } from './session/session-manager.ts';

const logger = createLogger('recorder');
const config = loadConfig();

const context = await launchBrowser(config.browser);
const page = context.pages()[0] ?? (await context.newPage());
await page.goto(DISCORD_APP_URL);
// The app redirects to the last channel when logged in, or to the login page.
await page.waitForURL(/\/(channels|login)/, { timeout: 60_000 }).catch((error: unknown) => {
  logger.warn({ err: error }, 'Discord did not finish loading');
});
if (await isLoggedOut(page)) {
  logger.error('the recorder account is logged out; log in over noVNC before recording');
} else {
  logger.info('Discord web client ready');
}

// Channel posts need the bot client, which only exists after login.
const clientRef: { current?: Client } = {};
const post = createChannelPoster(() => clientRef.current, logger);
const announce = createAnnouncer(post);

const sessions = new SessionManager({
  onSessionStart: (session) => {
    controller.sessionStarted(session);
  },
  onTargetChange: (change, session) => {
    logger.info(
      {
        channelId: session.channelId,
        from: change.from?.displayName,
        to: change.to?.displayName,
        reason: change.reason,
      },
      'recording target changed',
    );
    controller.targetChanged(change, session);
    if (config.discord.announceSets) announce(change, session);
  },
  onSessionEnd: (session) => {
    controller.sessionEnded(session);
  },
});

const processor = new Processor(logger.child({ module: 'processor' }));

const controller = new RecordingController({
  page,
  sessions,
  config: {
    recordingsDir: config.session.recordingsDir,
    pulseSource: config.capture.pulseSource,
    streamVolume: config.browser.streamVolume,
    handoverSilenceSeconds: config.session.handoverSilenceSeconds,
  },
  notify: post,
  postProcess: (record, setId) =>
    processor.enqueue(setId, (signal) =>
      processSet(record, setId, config.processing, {
        signal,
        logger: logger.child({ module: 'pipeline' }),
      }),
    ),
  logger: logger.child({ module: 'controller' }),
});

const client = await startBot({ config: config.discord, sessions, logger });
clientRef.current = client;

const shutdown = async (signal: string): Promise<void> => {
  logger.info({ signal }, 'shutting down');
  const active = sessions.active;
  if (active) {
    post(active.channelId, '⏹️ Recording stopped: the recorder is shutting down.');
    // Finalises the current set (marked partial) and leaves voice, through the controller.
    sessions.stop();
  }
  // Encodes can take minutes, so abort them; their sets stay "processing" for reprocess.ts.
  processor.shutdown();
  await controller.idle();
  await client.destroy();
  await context.close();
  logger.info('stopped');
  process.exit(0);
};

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => void shutdown(signal));
}
