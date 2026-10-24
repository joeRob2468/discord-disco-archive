import { createLogger } from '@dsr/core';
import { describe, expect, it } from 'vitest';
import { HealthMonitor, type BrowserHealth } from './health.ts';

const logger = createLogger('test');
// One test makes the check throw on purpose.
logger.level = 'silent';

function monitorWith(results: (BrowserHealth | Error)[]) {
  const changes: [BrowserHealth, BrowserHealth][] = [];
  const monitor = new HealthMonitor({
    check: () => {
      const next = results.shift() ?? 'ok';
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
    },
    onChange: (health, previous) => changes.push([health, previous]),
    logger,
  });
  return { monitor, changes };
}

describe('HealthMonitor', () => {
  it('reports a problem once, and its recovery once', async () => {
    const { monitor, changes } = monitorWith(['ok', 'logged-out', 'logged-out', 'ok']);
    for (let i = 0; i < 4; i++) await monitor.poll();
    expect(changes).toEqual([
      ['logged-out', 'ok'],
      ['ok', 'logged-out'],
    ]);
  });

  it('keeps the last state when a check throws', async () => {
    const { monitor, changes } = monitorWith(['captcha', new Error('navigating'), 'captcha']);
    for (let i = 0; i < 3; i++) await monitor.poll();
    expect(monitor.state).toBe('captcha');
    expect(changes).toEqual([['captcha', 'ok']]);
  });
});
