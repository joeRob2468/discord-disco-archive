/**
 * Milestone 4 prototype: run the Discord UI steps of an automated watch one at a time
 * against a live channel, and save what the page looked like after each one, so the
 * selectors in `browser/discord-web.ts` can be checked and fixed.
 *
 * Usage (in the container, with someone streaming in the channel):
 *   probe.ts https://discord.com/channels/<guild>/<voice channel> <streamer user ID> ["display name"]
 *
 * Steps: open the channel, deafen and mute, join, open the stream, measure the level,
 * unmute the stream if this account has it muted, set its volume to 100%, measure again.
 * After each step it writes an aria snapshot, the page HTML and a screenshot to
 * `<config dir>/probe/<run>/`. It stops at the first failure and stays up for
 * inspection over noVNC; Ctrl+C leaves voice and exits.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createLogger } from '@dsr/core';
import { measurePulseLevel } from '@dsr/media';
import type { Page } from 'playwright';
import {
  isMutedAndDeafened,
  joinVoice,
  leaveVoice,
  muteAndDeafen,
  openChannel,
  setStreamVolume,
  unmuteStream,
  watchStream,
  type StreamTarget,
} from './browser/discord-web.ts';
import { launchBrowser } from './browser/launch.ts';
import { loadBrowserConfig, loadCaptureConfig } from './config.ts';

const LEVEL_SECONDS = 5;

const logger = createLogger('recorder:probe');

function parseArgs(argv: readonly string[]): {
  guildId: string;
  channelId: string;
  target: StreamTarget;
} {
  const [url, userId, displayName] = argv;
  const match = /\/channels\/(\d+)\/(\d+)/.exec(url ?? '');
  if (!match?.[1] || !match[2] || !userId || !/^\d+$/.test(userId)) {
    throw new Error('Usage: probe.ts <voice channel URL> <streamer user ID> ["display name"]');
  }
  // The stream tile is found by user ID; the display name is only for messages.
  return {
    guildId: match[1],
    channelId: match[2],
    target: { userId, displayName: displayName ?? userId },
  };
}

const args = parseArgs(process.argv.slice(2));
const browserConfig = loadBrowserConfig();
const captureConfig = loadCaptureConfig();
const runDir = path.join(
  path.dirname(browserConfig.profileDir),
  'probe',
  new Date().toISOString().replaceAll(':', '-').slice(0, 19),
);
await mkdir(runDir, { recursive: true });

async function dump(page: Page, name: string): Promise<void> {
  const base = path.join(runDir, name);
  try {
    await writeFile(`${base}.aria.yaml`, await page.locator('body').ariaSnapshot());
    await writeFile(`${base}.html`, await page.content());
    await page.screenshot({ path: `${base}.png` });
    logger.info({ files: `${base}.*` }, 'saved page state');
  } catch (error) {
    logger.warn({ err: error, name }, 'could not save page state');
  }
}

async function measureLevel(label: string): Promise<void> {
  const level = await measurePulseLevel(captureConfig.pulseSource, LEVEL_SECONDS);
  logger.info({ label, meanDb: level.mean, maxDb: level.max }, 'capture level');
}

const context = await launchBrowser(browserConfig);
const page = context.pages()[0] ?? (await context.newPage());

const steps: [name: string, run: () => Promise<unknown>][] = [
  ['01-open-channel', () => openChannel(page, args.guildId, args.channelId)],
  ['02-mute-deafen', () => muteAndDeafen(page)],
  ['03-join-voice', () => joinVoice(page, args.channelId)],
  [
    '04-check-deafened',
    async () => {
      if (!(await isMutedAndDeafened(page)))
        throw new Error('not muted and deafened after joining');
    },
  ],
  ['05-watch-stream', () => watchStream(page, args.target)],
  ['06-level-default-volume', () => measureLevel('default stream volume')],
  [
    '07-unmute-stream',
    async () => {
      logger.info({ wasMuted: await unmuteStream(page, args.target) }, 'stream unmuted');
    },
  ],
  [
    '08-stream-volume',
    async () => {
      const value = await setStreamVolume(page, args.target, 100);
      logger.info({ value }, 'stream volume set');
    },
  ],
  ['09-level-full-volume', () => measureLevel('stream volume 100%')],
];

logger.info({ runDir, target: args.target }, 'probe starting');
for (const [name, run] of steps) {
  try {
    logger.info({ step: name }, 'running');
    await run();
    await dump(page, name);
  } catch (error) {
    logger.error({ err: error, step: name }, 'step failed; staying up for inspection over noVNC');
    await dump(page, `${name}-FAILED`);
    break;
  }
}
logger.info('probe finished; Ctrl+C to leave voice and exit');

const shutdown = async (signal: string): Promise<void> => {
  logger.info({ signal }, 'leaving voice and closing browser');
  try {
    await leaveVoice(page);
  } catch (error) {
    logger.warn({ err: error }, 'could not leave voice');
  }
  await context.close();
  process.exit(0);
};

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => void shutdown(signal));
}
