/**
 * Launches the browser that runs the Discord web client as the recorder account.
 * See docs/plan.md, "Browser settings", for why each option is set.
 *
 * Firefox is the one to use for recording: Chromium plays Discord's stream audio in
 * mono (docs/research.md, "Audio quality"). Chrome stays available as a fallback.
 */
import { chromium, firefox, type BrowserContext } from 'playwright';
import type { BrowserConfig } from '../config.ts';

export const DISCORD_APP_URL = 'https://discord.com/app';

/**
 * Each browser keeps its own profile (and login): Firefox in `<PROFILE_DIR>-firefox`, so
 * switching `BROWSER_CHANNEL` never hands one browser the other's profile.
 */
export function profileDirFor(config: BrowserConfig): string {
  return config.channel === 'firefox' ? `${config.profileDir}-firefox` : config.profileDir;
}

// Our own signal handlers close the context cleanly. Playwright's defaults kill the
// browser outright, which leaves the profile marked as crashed.
const OWN_SIGNAL_HANDLING = { handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false };

export async function launchBrowser(config: BrowserConfig): Promise<BrowserContext> {
  const { width, height } = config.windowSize;

  if (config.channel === 'firefox') {
    return firefox.launchPersistentContext(profileDirFor(config), {
      headless: false,
      ...OWN_SIGNAL_HANDLING,
      // Playwright's Firefox ignores -width/-height (it opens "1920" as a URL), so size
      // the page instead; Playwright fits the window to it.
      viewport: { width, height },
      firefoxUserPrefs: {
        // Play stream audio without a click.
        'media.autoplay.default': 0,
        'media.autoplay.blocking_policy': 0,
        // Joining voice may ask for a mic; grant it without a prompt. The default
        // source is a silent null source.
        'media.navigator.permission.disabled': true,
        // Never show "Restore session?" over the stream after a crash.
        'browser.sessionstore.resume_from_crash': false,
      },
    });
  }

  return chromium.launchPersistentContext(profileDirFor(config), {
    // Headed on Xvfb: headless Chromium is unreliable at WebRTC playback.
    headless: false,
    ...(config.channel === 'chrome' ? { channel: 'chrome' } : {}),
    // Playwright mutes Chromium by default; we need audio to reach PulseAudio.
    ignoreDefaultArgs: ['--mute-audio'],
    ...OWN_SIGNAL_HANDLING,
    args: [
      '--autoplay-policy=no-user-gesture-required',
      // Never show "Restore pages?" over the stream if a previous run did crash.
      '--hide-crash-restore-bubble',
      `--window-size=${String(width)},${String(height)}`,
      '--window-position=0,0',
    ],
    // Let the page use the real window size instead of a fixed emulated viewport.
    viewport: null,
    // Joining voice may ask for a mic; the default source is a silent null source.
    permissions: ['microphone'],
  });
}
