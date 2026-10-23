/**
 * Drives the Discord web client as the recorder account: join or leave voice,
 * self-mute and deafen, open a Go Live stream and set its volume.
 *
 * Every Discord DOM selector lives in this module. Discord's class names are hashed and
 * change with each deploy, so prefer roles, aria labels and `data-*` attributes. All of
 * these were first worked out against the live client in milestone 4; when one breaks,
 * run `probe.ts` and compare its aria snapshots (see docs/development.md).
 */
import type { Locator, Page } from 'playwright';

const APP_LOAD_TIMEOUT_MS = 60_000;
const ACTION_TIMEOUT_MS = 10_000;

export class DiscordWebError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'DiscordWebError';
  }
}

export interface StreamTarget {
  userId: string;
  displayName: string;
}

export const channelUrl = (guildId: string, channelId: string): string =>
  `https://discord.com/channels/${guildId}/${channelId}`;

const selectors = {
  /** A channel's entry in the channel sidebar. */
  sidebarChannel: (page: Page, channelId: string): Locator =>
    page.locator(`[data-list-item-id="channels___${channelId}"]`),
  /** The voice channel view's own join button, shown when clicking the sidebar doesn't join. */
  joinVoiceButton: (page: Page): Locator => page.getByRole('button', { name: /^join voice$/i }),
  /** The bottom-left panel with voice status and the mute and deafen toggles. */
  userPanel: (page: Page): Locator =>
    page.getByRole('region', { name: 'User status and settings' }),
  /** Only rendered while connected to voice. The call view has a second one, so scope it. */
  disconnectButton: (page: Page): Locator =>
    selectors.userPanel(page).getByRole('button', { name: 'Disconnect' }),
  /** The user panel's toggles; `aria-checked` is their state. */
  muteSwitch: (page: Page): Locator =>
    selectors.userPanel(page).getByRole('switch', { name: /^(un)?mute$/i }),
  deafenSwitch: (page: Page): Locator =>
    selectors.userPanel(page).getByRole('switch', { name: /^(un)?deafen$/i }),
  /**
   * A user's Go Live tile in the call view. Each user has a camera/avatar tile and, while
   * live, a stream tile; both carry their user ID, and the stream one is labelled
   * "Call tile, stream, <username>".
   */
  streamTile: (page: Page, userId: string): Locator =>
    page
      .locator(`[data-call-tile][data-selenium-video-tile="${userId}"]`)
      .filter({ has: page.getByRole('button', { name: /^Call tile, stream,/ }) }),
  watchStreamButton: (scope: Locator | Page): Locator =>
    scope.getByRole('button', { name: /watch stream/i }),
  /** Shown on a stream tile while this account has that stream muted. */
  streamTileUnmuteButton: (page: Page, userId: string): Locator =>
    selectors.streamTile(page, userId).getByRole('button', { name: 'Unmute' }),
  /** Only rendered while a stream is open in the call view. */
  stopWatchingButton: (page: Page): Locator => page.getByRole('button', { name: 'Stop Watching' }),
  /**
   * The stream volume slider in a stream tile's context menu. Not the "Control volume"
   * button in the call view's bottom bar: clicking that mutes the stream, and its slider
   * has no ARIA role or value.
   */
  streamVolumeSlider: (page: Page): Locator => page.getByRole('menu').getByRole('slider'),
  /** Login form, shown when the profile's session has expired. */
  loginForm: (page: Page): Locator =>
    page.locator('form').filter({ has: page.locator('input[name="email"]') }),
};

/** True if Discord is showing its login page instead of the app. */
export async function isLoggedOut(page: Page): Promise<boolean> {
  return page.url().includes('/login') || (await selectors.loginForm(page).isVisible());
}

/** Open the voice channel's page and wait for the channel sidebar to render. */
export async function openChannel(page: Page, guildId: string, channelId: string): Promise<void> {
  await page.goto(channelUrl(guildId, channelId));
  try {
    await selectors.sidebarChannel(page, channelId).waitFor({ timeout: APP_LOAD_TIMEOUT_MS });
  } catch (error) {
    if (await isLoggedOut(page)) {
      throw new DiscordWebError('The recorder account is logged out; log in over noVNC', {
        cause: error,
      });
    }
    throw new DiscordWebError(`Channel ${channelId} did not appear in the sidebar`, {
      cause: error,
    });
  }
}

export async function isInVoice(page: Page): Promise<boolean> {
  return selectors.disconnectButton(page).isVisible();
}

/** Join the voice channel. `openChannel` must have run first. */
export async function joinVoice(page: Page, channelId: string): Promise<void> {
  if (await isInVoice(page)) return;
  await selectors.sidebarChannel(page, channelId).click();
  try {
    await selectors.disconnectButton(page).waitFor({ timeout: ACTION_TIMEOUT_MS });
    return;
  } catch {
    // Some client versions only open the channel view on click; fall through to its button.
  }
  try {
    await selectors.joinVoiceButton(page).click({ timeout: ACTION_TIMEOUT_MS });
    await selectors.disconnectButton(page).waitFor({ timeout: ACTION_TIMEOUT_MS });
  } catch (error) {
    throw new DiscordWebError(`Could not join voice channel ${channelId}`, { cause: error });
  }
}

export async function leaveVoice(page: Page): Promise<void> {
  if (!(await isInVoice(page))) return;
  await selectors.disconnectButton(page).click();
  await selectors.disconnectButton(page).waitFor({ state: 'hidden', timeout: ACTION_TIMEOUT_MS });
}

async function setSwitch(toggle: Locator, on: boolean, label: string): Promise<void> {
  try {
    if (
      (await toggle.getAttribute('aria-checked', { timeout: ACTION_TIMEOUT_MS })) === String(on)
    ) {
      return;
    }
    await toggle.click();
    await toggle.and(toggle.page().locator(`[aria-checked="${String(on)}"]`)).waitFor({
      timeout: ACTION_TIMEOUT_MS,
    });
  } catch (error) {
    throw new DiscordWebError(`Could not turn ${label} ${on ? 'on' : 'off'}`, { cause: error });
  }
}

/**
 * Self-mute and self-deafen. Deafening silences voice chat but keeps Go Live stream
 * audio (docs/research.md); muting is belt and braces, as the mic is a null source.
 */
export async function muteAndDeafen(page: Page): Promise<void> {
  await setSwitch(selectors.deafenSwitch(page), true, 'deafen');
  // Discord mutes along with deafen, but check rather than assume.
  await setSwitch(selectors.muteSwitch(page), true, 'mute');
}

export async function isMutedAndDeafened(page: Page): Promise<boolean> {
  const [muted, deafened] = await Promise.all([
    selectors.muteSwitch(page).getAttribute('aria-checked'),
    selectors.deafenSwitch(page).getAttribute('aria-checked'),
  ]);
  return muted === 'true' && deafened === 'true';
}

/** Open the target's Go Live stream from the call view. Requires being in voice. */
export async function watchStream(page: Page, target: StreamTarget): Promise<void> {
  const tile = selectors.streamTile(page, target.userId);
  try {
    await tile.hover({ timeout: ACTION_TIMEOUT_MS });
    await selectors.watchStreamButton(tile).click({ timeout: ACTION_TIMEOUT_MS });
    await selectors.stopWatchingButton(page).waitFor({ timeout: ACTION_TIMEOUT_MS });
  } catch (error) {
    throw new DiscordWebError(`Could not open ${target.displayName}'s stream`, { cause: error });
  }
}

/**
 * Unmute the target's stream if this account has it muted. Discord remembers a stream
 * mute per user across sessions, and a muted stream records as digital silence. While
 * muted, the stream tile shows an "Unmute" button.
 */
export async function unmuteStream(page: Page, target: StreamTarget): Promise<boolean> {
  const unmute = selectors.streamTileUnmuteButton(page, target.userId);
  if ((await unmute.count()) === 0) return false;
  try {
    // The button sits in the tile's overlay, which only shows while hovered.
    await selectors
      .streamTile(page, target.userId)
      .filter({ has: page.getByRole('button', { name: 'Unmute' }) })
      .first()
      .hover({ timeout: ACTION_TIMEOUT_MS });
    await unmute.first().click({ timeout: ACTION_TIMEOUT_MS });
    await unmute.first().waitFor({ state: 'detached', timeout: ACTION_TIMEOUT_MS });
    return true;
  } catch (error) {
    throw new DiscordWebError(`Could not unmute ${target.displayName}'s stream`, { cause: error });
  }
}

/**
 * Set a slider by keyboard, stepping from its current value towards `percent` and never
 * past it. Discord's sliders don't take direct value input, and steps differ between
 * sliders. No `End` key: the stream slider may go above 100%, which can clip inside
 * Discord's mixer (docs/plan.md, "Isolating stream audio from voice chat").
 */
async function setSlider(slider: Locator, percent: number): Promise<number> {
  const read = async (): Promise<number> => Number(await slider.getAttribute('aria-valuenow'));
  await slider.focus();
  for (let step = 0; step < 200 && (await read()) < percent; step++) {
    await slider.press('ArrowRight');
  }
  for (let step = 0; step < 200 && (await read()) > percent; step++) {
    await slider.press('ArrowLeft');
  }
  return read();
}

/**
 * Set the open stream's volume. It defaults to 50% on the viewer side, which halves
 * the captured level (docs/research.md, milestone 2). `watchStream` must have run.
 * Returns the value it ended on.
 */
export async function setStreamVolume(
  page: Page,
  target: StreamTarget,
  percent = 100,
): Promise<number> {
  try {
    // The stream tile shows twice while watching (main view and thumbnail strip).
    await selectors
      .streamTile(page, target.userId)
      .first()
      .click({ button: 'right', timeout: ACTION_TIMEOUT_MS });
    const slider = selectors.streamVolumeSlider(page);
    await slider.waitFor({ timeout: ACTION_TIMEOUT_MS });
    const value = await setSlider(slider, percent);
    await page.keyboard.press('Escape');
    return value;
  } catch (error) {
    throw new DiscordWebError(`Could not set ${target.displayName}'s stream volume`, {
      cause: error,
    });
  }
}
