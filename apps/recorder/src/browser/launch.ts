/**
 * Launches the browser that runs the Discord web client as the recorder account.
 * See docs/plan.md, "Browser settings", for why each option is set.
 */
import { chromium, type BrowserContext } from 'playwright';
import type { BrowserConfig } from '../config.ts';

export const DISCORD_APP_URL = 'https://discord.com/app';

export async function launchBrowser(config: BrowserConfig): Promise<BrowserContext> {
  const { width, height } = config.windowSize;

  return chromium.launchPersistentContext(config.profileDir, {
    // Headed on Xvfb: headless Chromium is unreliable at WebRTC playback.
    headless: false,
    ...(config.channel === 'chrome' ? { channel: 'chrome' } : {}),
    // Playwright mutes Chromium by default; we need audio to reach PulseAudio.
    ignoreDefaultArgs: ['--mute-audio'],
    args: [
      '--autoplay-policy=no-user-gesture-required',
      `--window-size=${width},${height}`,
      '--window-position=0,0',
    ],
    // Let the page use the real window size instead of a fixed emulated viewport.
    viewport: null,
    // Joining voice may ask for a mic; the default source is a silent null source.
    permissions: ['microphone'],
  });
}
