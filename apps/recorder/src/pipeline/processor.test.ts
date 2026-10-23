import { createLogger } from '@dsr/core';
import { describe, expect, it } from 'vitest';
import { Processor } from './processor.ts';

const logger = createLogger('test');
logger.level = 'silent';

describe('Processor', () => {
  it('runs jobs one at a time, in order, past failures', async () => {
    const processor = new Processor(logger);
    const events: string[] = [];
    const job =
      (name: string, fail = false) =>
      async () => {
        events.push(`${name} start`);
        await new Promise((resolve) => setTimeout(resolve, 5));
        events.push(`${name} end`);
        if (fail) throw new Error(name);
      };
    void processor.enqueue('a', job('a', true));
    await processor.enqueue('b', job('b'));
    expect(events).toEqual(['a start', 'a end', 'b start', 'b end']);
  });

  it('aborts the running job and skips queued ones on shutdown', async () => {
    const processor = new Processor(logger);
    let sawAbort = false;
    let ranSecond = false;
    void processor.enqueue('long', (signal) => {
      return new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => {
          sawAbort = true;
          resolve();
        });
      });
    });
    const second = processor.enqueue('next', () => {
      ranSecond = true;
      return Promise.resolve();
    });
    // Let the first job start before shutting down.
    await new Promise((resolve) => setTimeout(resolve, 0));
    processor.shutdown();
    await second;
    expect(sawAbort).toBe(true);
    expect(ranSecond).toBe(false);
  });
});
