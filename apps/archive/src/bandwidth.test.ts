import { describe, expect, it } from 'vitest';
import { BandwidthLimiter } from './bandwidth.ts';

/** A limiter on a fake clock: waiting moves the clock on, and the waits are recorded. */
function fakeLimiter(bytesPerSecond: number) {
  let now = 1_000_000;
  const waits: number[] = [];
  const limiter = new BandwidthLimiter(bytesPerSecond, {
    now: () => now,
    wait: (ms) => {
      waits.push(ms);
      now += ms;
      return Promise.resolve();
    },
  });
  return { limiter, waits, advance: (ms: number) => (now += ms) };
}

describe('BandwidthLimiter', () => {
  it('lets a burst through, then paces a client to its rate', async () => {
    const { limiter, waits } = fakeLimiter(1000);
    await limiter.take('a', 1000); // the 1 s burst
    expect(waits).toEqual([]);
    await limiter.take('a', 500);
    await limiter.take('a', 500);
    expect(waits).toEqual([500, 500]);
  });

  it('shares one budget between a client’s parallel downloads', async () => {
    const { limiter, waits } = fakeLimiter(1000);
    await Promise.all([limiter.take('a', 1000), limiter.take('a', 1000)]);
    // The second download waits for the first one's share.
    expect(waits).toEqual([1000]);
  });

  it('paces each client separately', async () => {
    const { limiter, waits } = fakeLimiter(1000);
    await limiter.take('a', 1000);
    await limiter.take('b', 1000);
    expect(waits).toEqual([]);
  });

  it('refills an idle client’s burst', async () => {
    const { limiter, waits, advance } = fakeLimiter(1000);
    await limiter.take('a', 2000);
    advance(5000);
    await limiter.take('a', 1000);
    expect(waits).toEqual([1000]);
  });

  it('throttles a stream without changing its bytes', async () => {
    const { limiter, waits } = fakeLimiter(1000);
    const first = new Uint8Array(1000).fill(1);
    const second = new Uint8Array(1000).fill(2);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(first);
        controller.enqueue(second);
        controller.close();
      },
    });
    const out = new Uint8Array(await new Response(limiter.throttle(body, 'a')).arrayBuffer());
    expect(out).toEqual(new Uint8Array([...first, ...second]));
    expect(waits).toEqual([1000]);
  });
});
