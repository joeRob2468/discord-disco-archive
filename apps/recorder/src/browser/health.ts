/**
 * Is the recorder's Discord web client usable? Checked before `/record start` joins and
 * every few minutes while running, because a logout or a captcha would otherwise only
 * show up when a recording fails. Login and captchas are never automated (ToS); a
 * person fixes them over noVNC (docs/operations.md).
 */
import type { Logger } from '@dsr/core';
import type { Page } from 'playwright';
import { isLoggedOut } from './discord-web.ts';

export type BrowserHealth = 'ok' | 'logged-out' | 'captcha';

/** Read-only look at the page; safe while the controller is using it. */
export async function checkBrowser(page: Page): Promise<BrowserHealth> {
  if (await isLoggedOut(page)) return 'logged-out';
  // hCaptcha, which Discord shows for logins and "suspicious activity" checks.
  const captcha = page.locator('iframe[src*="hcaptcha.com"]');
  if ((await captcha.count()) > 0 && (await captcha.first().isVisible())) return 'captcha';
  return 'ok';
}

export const HEALTH_PROBLEMS: Record<Exclude<BrowserHealth, 'ok'>, string> = {
  'logged-out': 'the recorder account is logged out of Discord',
  captcha: 'Discord is showing the recorder account a captcha',
};

/** What to do about a problem: shared by the pre-flight check and the alerts. */
export const FIX_HINT =
  'An admin needs to fix it in the recorder’s browser over noVNC (see docs/operations.md).';

export interface HealthMonitorDeps {
  check: () => Promise<BrowserHealth>;
  /** Called when the state changes (including the first problem after start). */
  onChange: (health: BrowserHealth, previous: BrowserHealth) => void;
  logger: Logger;
}

/**
 * Polls `check` and reports changes only, so a logout is logged and announced once, not
 * every few minutes, and its recovery once more.
 */
export class HealthMonitor {
  readonly #deps: HealthMonitorDeps;
  #state: BrowserHealth = 'ok';
  #timer: NodeJS.Timeout | undefined;

  constructor(deps: HealthMonitorDeps) {
    this.#deps = deps;
  }

  get state(): BrowserHealth {
    return this.#state;
  }

  /** Check now; resolves with the current state. */
  async poll(): Promise<BrowserHealth> {
    let next: BrowserHealth;
    try {
      next = await this.#deps.check();
    } catch (error) {
      // The page may be mid-navigation; keep the last known state and try next time.
      this.#deps.logger.warn({ err: error }, 'browser health check failed');
      return this.#state;
    }
    const previous = this.#state;
    this.#state = next;
    if (next !== previous) this.#deps.onChange(next, previous);
    return next;
  }

  start(intervalMs: number): void {
    this.#timer = setInterval(() => void this.poll(), intervalMs);
    this.#timer.unref();
  }

  stop(): void {
    clearInterval(this.#timer);
  }
}
