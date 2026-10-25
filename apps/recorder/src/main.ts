/**
 * Recorder composition root: the bot, the session manager, the browser running the
 * Discord web client as the recorder account, and the recording controller, all in one
 * process (docs/design.md, "Approach"). It needs Xvfb and PulseAudio, so it runs in the
 * container.
 */
import { once } from 'node:events';
import path from 'node:path';
import { createLogger, readJsonFile, sessionPaths, sessionSchema } from '@dsr/core';
import { Events, type Client } from 'discord.js';
import { createAnnouncer, createChannelPoster } from './bot/announcer.ts';
import { startBot } from './bot/bot.ts';
import * as messages from './bot/messages.ts';
import { checkBrowser, FIX_HINT, HEALTH_PROBLEMS, HealthMonitor } from './browser/health.ts';
import { DISCORD_APP_URL, launchBrowser } from './browser/launch.ts';
import { RecordingController } from './capture/controller.ts';
import { readActiveSession, writeActiveSession } from './capture/recorder-state.ts';
import { findSessions } from './capture/session-record.ts';
import { loadConfig } from './config.ts';
import { findImports, importSet } from './pipeline/imports.ts';
import { processSet } from './pipeline/process-set.ts';
import { Processor } from './pipeline/processor.ts';
import { sweepRecordings } from './pipeline/retention.ts';
import { SessionManager } from './session/session-manager.ts';

const logger = createLogger('recorder');

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

const context = await launchBrowser(config.browser);
const page = context.pages()[0] ?? (await context.newPage());
await page.goto(DISCORD_APP_URL);
// The app redirects to the last channel when logged in, or to the login page.
await page.waitForURL(/\/(channels|login)/, { timeout: 60_000 }).catch((error: unknown) => {
  logger.warn({ err: error }, 'Discord did not finish loading');
});

// Channel posts need the bot client, which only exists after login.
const clientRef: { current?: Client } = {};
const post = createChannelPoster(() => clientRef.current, logger);
const announce = createAnnouncer(post);

const sessions = new SessionManager({
  restartGraceMs: config.session.restartGraceMs,
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
    silenceAlertSeconds: config.session.silenceAlertSeconds,
    // Next to the browser profile: `APP_DATA_DIR/recorder/screenshots` in Docker.
    screenshotDir: path.join(path.dirname(config.browser.profileDir), 'screenshots'),
  },
  notify: post,
  postProcess: (record, setId) =>
    processor.enqueue(setId, async (signal) => {
      await processSet(record, setId, config.processing, {
        signal,
        logger: logger.child({ module: 'pipeline' }),
      });
      const set = record.set(setId);
      if (set?.status === 'failed') {
        post(
          record.session.channelId,
          `⚠️ Processing failed for **${set.displayName}**'s set: ${set.error ?? 'unknown error'}. ` +
            'The raw recording is kept, so an admin can re-run it.',
        );
      }
    }),
  logger: logger.child({ module: 'controller' }),
});

// Logged out or a captcha: refuse /record start up front, and alert the session's chat.
const HEALTH_INTERVAL_MS = 5 * 60 * 1000;
const health = new HealthMonitor({
  check: () => checkBrowser(page),
  onChange: (state, previous) => {
    const active = sessions.active;
    if (state === 'ok') {
      logger.info({ previous }, 'recorder browser is healthy again');
      if (active)
        post(active.channelId, '✅ The recorder account is back; new streams will be recorded.');
      return;
    }
    logger.error({ state }, `recorder browser problem: ${HEALTH_PROBLEMS[state]}`);
    if (active) {
      post(
        active.channelId,
        `⚠️ Recording may have stopped: ${HEALTH_PROBLEMS[state]}. ${FIX_HINT}`,
      );
    }
  },
  logger: logger.child({ module: 'health' }),
});
health.start(HEALTH_INTERVAL_MS);
// At startup too: a problem is logged (by onChange) before anyone tries to record.
if ((await health.poll()) === 'ok') logger.info('Discord web client ready');

const preflight = async (): Promise<string | undefined> => {
  const state = await health.poll();
  return state === 'ok' ? undefined : `Can't record: ${HEALTH_PROBLEMS[state]}. ${FIX_HINT}`;
};

const client = await startBot({
  config: config.discord,
  sessions,
  logger,
  preflight,
  onRecorderLeftVoice: (channelId) => {
    controller.recorderLeftVoice(channelId);
  },
  retryTarget: () => controller.retryTarget(),
  split: (names) => controller.split(names),
  findSessions: (channelId) => findSessions(config.session.recordingsDir, channelId),
});
clientRef.current = client;

// After a restart mid-session (crash, deploy, reboot), carry on with that session.
const RESUME_LOOP_MS = 10 * 60 * 1000;
const resumeAfterRestart = async (): Promise<void> => {
  const dir = config.session.recordingsDir;
  const active = await readActiveSession(dir).catch((error: unknown) => {
    logger.warn({ err: error }, 'could not read the active session');
    return undefined;
  });
  if (!active) return;
  const forget = () => writeActiveSession(dir, null).catch(() => undefined);
  const session = await readJsonFile(
    sessionPaths(dir, active.dir).sessionFile,
    sessionSchema,
  ).catch(() => undefined);
  if (!session) {
    logger.warn({ dir: active.dir }, 'the active session is gone; not resuming');
    return forget();
  }
  const say = (content: string) => {
    post(session.channelId, content);
  };
  // Crashing again soon after resuming: don't keep rejoining voice.
  if (active.resumedAt && Date.now() - Date.parse(active.resumedAt) < RESUME_LOOP_MS) {
    logger.error({ dir: active.dir }, 'restarted again soon after resuming; not resuming');
    say(
      "⚠️ The recorder restarted again soon after resuming, so it isn't resuming by itself. " +
        'Check its logs, then run `/record resume`.',
    );
    return forget();
  }
  const browser = await health.poll();
  if (browser !== 'ok') {
    say(
      `⚠️ The recorder restarted mid-session but can't resume: ${HEALTH_PROBLEMS[browser]}. ` +
        `${FIX_HINT} Then run \`/record resume\`.`,
    );
    return forget();
  }
  if (!client.isReady()) await once(client, Events.ClientReady);
  const channel = client.guilds.cache.get(session.guildId)?.channels.cache.get(session.channelId);
  if (!channel?.isVoiceBased()) {
    logger.warn({ channelId: session.channelId }, "can't see the session's channel; not resuming");
    return forget();
  }
  const liveNow = channel.members
    .filter(
      (member) => member.voice.streaming === true && member.id !== config.discord.recorderUserId,
    )
    .map((member) => ({ userId: member.id, displayName: member.displayName }));
  await writeActiveSession(dir, { ...active, resumedAt: new Date().toISOString() });
  logger.info({ dir: active.dir }, 'resuming the session after a restart');
  const result = sessions.start(
    {
      guildId: session.guildId,
      channelId: channel.id,
      channelName: channel.name,
      title: session.title,
      startedAt: new Date(session.startedAt),
      startedBy: session.startedBy,
      resumeDir: active.dir,
      afterRestart: true,
    },
    liveNow,
  );
  if (result.ok) say(messages.resumedAfterRestart(sessions.status()?.target));
};
void resumeAfterRestart().catch((error: unknown) => {
  logger.error({ err: error }, 'could not resume the session after a restart');
});

// Raw captures and dropped export formats are cleaned up at startup, then hourly. The
// sweep runs in the processor's queue, so it never edits a session.json that an import
// or a reprocess has open.
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;
const sweep = async (): Promise<void> => {
  try {
    const result = await sweepRecordings(
      config.session.recordingsDir,
      config.processing,
      logger.child({ module: 'retention' }),
    );
    if (result.files > 0) logger.info(result, 'retention sweep freed space');
  } catch (error) {
    logger.error({ err: error }, 'retention sweep failed');
  }
};
void processor.enqueue('retention sweep', sweep);
const sweepTimer = setInterval(
  () => void processor.enqueue('retention sweep', sweep),
  SWEEP_INTERVAL_MS,
);
sweepTimer.unref();

// Sets uploaded through the archive: import and level each, one at a time.
const IMPORT_INTERVAL_MS = 15_000;
const importing = new Set<string>();
const importLogger = logger.child({ module: 'imports' });
const scanImports = async (): Promise<void> => {
  let pending;
  try {
    pending = await findImports(config.session.recordingsDir);
  } catch (error) {
    importLogger.error({ err: error }, 'could not look for uploaded sets');
    return;
  }
  for (const request of pending) {
    if (importing.has(request.requestFile)) continue;
    importing.add(request.requestFile);
    void processor.enqueue(`import ${request.requestFile}`, async (signal) => {
      try {
        const imported = await importSet(config.session.recordingsDir, request, importLogger);
        if (imported) {
          await processSet(imported.record, imported.setId, config.processing, {
            signal,
            logger: logger.child({ module: 'pipeline' }),
          });
        }
      } finally {
        importing.delete(request.requestFile);
      }
    });
  }
};
void scanImports();
const importTimer = setInterval(() => void scanImports(), IMPORT_INTERVAL_MS);
importTimer.unref();

const shutdown = async (signal: string): Promise<void> => {
  logger.info({ signal }, 'shutting down');
  const active = sessions.active;
  if (active) {
    post(
      active.channelId,
      "⏸️ The recorder is shutting down; it'll carry on with this session when it's back.",
    );
    // Finalises the current set (marked partial) and leaves voice, through the controller,
    // keeping the session as the one to resume (state.json).
    controller.shuttingDown();
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
