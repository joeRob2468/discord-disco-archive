import { createLogger } from '@dsr/core';
import type { Page } from 'playwright';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OnDemandBrowser } from './on-demand.ts';

const logger = createLogger('test');
logger.level = 'silent';

const HOUR = 60 * 60 * 1000;

function browserWith(busy = { value: false }) {
  const events: string[] = [];
  const browser = new OnDemandBrowser({
    launch: () => {
      events.push('launch');
      return Promise.resolve({
        page: {} as Page,
        close: () => {
          events.push('close');
          return Promise.resolve();
        },
      });
    },
    keepAliveMs: 2 * HOUR,
    isBusy: () => busy.value,
    onOpen: () => events.push('onOpen'),
    onClose: () => events.push('onClose'),
    logger,
  });
  return { browser, events, busy };
}

describe('OnDemandBrowser', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts once, however many callers open it at the same time', async () => {
    const { browser, events } = browserWith();
    await Promise.all([browser.open(), browser.open()]);
    await browser.open();
    expect(events).toEqual(['launch', 'onOpen']);
    expect(browser.isOpen).toBe(true);
  });

  it('closes after keepAliveMs without use', async () => {
    const { browser, events } = browserWith();
    await browser.open();
    await vi.advanceTimersByTimeAsync(2 * HOUR - 1);
    expect(browser.isOpen).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(events).toEqual(['launch', 'onOpen', 'onClose', 'close']);
    expect(browser.isOpen).toBe(false);
    expect(() => browser.page).toThrow();
  });

  it('counts the keep-alive from the last use', async () => {
    const { browser } = browserWith();
    await browser.open();
    await vi.advanceTimersByTimeAsync(HOUR);
    browser.keepAlive();
    await vi.advanceTimersByTimeAsync(2 * HOUR - 1);
    expect(browser.isOpen).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(browser.isOpen).toBe(false);
  });

  it('stays open while busy, then closes keepAliveMs after that', async () => {
    const { browser, busy } = browserWith({ value: true });
    await browser.open();
    await vi.advanceTimersByTimeAsync(10 * HOUR);
    expect(browser.isOpen).toBe(true);
    busy.value = false;
    await vi.advanceTimersByTimeAsync(2 * HOUR);
    expect(browser.isOpen).toBe(false);
  });

  it('starts again after closing', async () => {
    const { browser, events } = browserWith();
    await browser.open();
    await browser.close();
    await browser.open();
    expect(events.filter((event) => event === 'launch')).toHaveLength(2);
    expect(browser.isOpen).toBe(true);
  });
});
