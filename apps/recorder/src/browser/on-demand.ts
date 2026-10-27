/**
 * Runs the recorder's browser only while it's needed. An idle Discord web client costs
 * a steady share of a CPU core (it repaints its animations in software on Xvfb), and
 * sessions are months apart, so the browser starts on `/record check`, `/record start`
 * or `/record resume` and closes once nothing has used it for `keepAliveMs`. It stays
 * open while a session is active.
 */
import type { Logger } from '@dsr/core';
import type { Page } from 'playwright';

export interface OpenBrowser {
  page: Page;
  close: () => Promise<void>;
}

export interface OnDemandBrowserDeps {
  /** Start the browser and load Discord. */
  launch: () => Promise<OpenBrowser>;
  /** How long it stays open after its last use. */
  keepAliveMs: number;
  /** True while something (an active session) needs the browser regardless of the timer. */
  isBusy: () => boolean;
  /** Called after it opens and before it closes, e.g. to run health checks only meanwhile. */
  onOpen?: () => void;
  onClose?: () => void;
  logger: Logger;
}

export class OnDemandBrowser {
  readonly #deps: OnDemandBrowserDeps;
  #open: OpenBrowser | undefined;
  #opening: Promise<OpenBrowser> | undefined;
  #closing: Promise<void> | undefined;
  #timer: NodeJS.Timeout | undefined;

  constructor(deps: OnDemandBrowserDeps) {
    this.#deps = deps;
  }

  get isOpen(): boolean {
    return this.#open !== undefined;
  }

  /** The open browser's page; throws while it's closed. */
  get page(): Page {
    if (!this.#open) throw new Error("The recorder's browser isn't running");
    return this.#open.page;
  }

  /** Start the browser if it isn't running, and keep it open for another `keepAliveMs`. */
  async open(): Promise<Page> {
    this.keepAlive();
    if (this.#open) return this.#open.page;
    await this.#closing;
    this.#opening ??= this.#launch().finally(() => {
      this.#opening = undefined;
    });
    return (await this.#opening).page;
  }

  /** Keep the browser open for another `keepAliveMs` from now. */
  keepAlive(): void {
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.#expired();
    }, this.#deps.keepAliveMs);
    this.#timer.unref();
  }

  async close(): Promise<void> {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    const open = this.#open;
    if (!open) return;
    this.#open = undefined;
    this.#deps.onClose?.();
    this.#closing = open.close().catch((error: unknown) => {
      this.#deps.logger.warn({ err: error }, 'could not close the browser cleanly');
    });
    await this.#closing;
    this.#closing = undefined;
    this.#deps.logger.info('browser closed');
  }

  async #launch(): Promise<OpenBrowser> {
    this.#deps.logger.info('starting the browser');
    const open = await this.#deps.launch();
    this.#open = open;
    this.#deps.onOpen?.();
    this.#deps.logger.info('browser started');
    return open;
  }

  #expired(): void {
    if (this.#deps.isBusy() || this.#opening) {
      this.keepAlive();
      return;
    }
    this.#timer = undefined;
    this.#deps.logger.info('browser idle; closing it');
    void this.close();
  }
}
