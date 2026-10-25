/**
 * A per-client cap on media bandwidth, so one fast downloader (or one person with several
 * downloads running) can't take the whole upload link while others download too. All of a
 * client's responses draw on one budget. An idle client gets `BURST_MS` of data at full
 * speed, so starting playback and seeking aren't slowed.
 */
const BURST_MS = 1_000;
/** Forget clients idle this long (their budget is full again anyway). */
const PRUNE_INTERVAL_MS = 60_000;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export class BandwidthLimiter {
  readonly #bytesPerMs: number;
  readonly #now: () => number;
  readonly #sleep: (ms: number) => Promise<void>;
  /** Per client: the time its budget is used up to. Ahead of now means it must wait. */
  readonly #spentUntil = new Map<string, number>();
  #prunedAt = 0;

  constructor(
    bytesPerSecond: number,
    {
      now = Date.now,
      wait = sleep,
    }: { now?: () => number; wait?: (ms: number) => Promise<void> } = {},
  ) {
    this.#bytesPerMs = bytesPerSecond / 1000;
    this.#now = now;
    this.#sleep = wait;
  }

  /** Wait until `bytes` more may be sent to `client`. */
  async take(client: string, bytes: number): Promise<void> {
    const now = this.#now();
    this.#prune(now);
    const from = Math.max(this.#spentUntil.get(client) ?? 0, now - BURST_MS);
    const until = from + bytes / this.#bytesPerMs;
    this.#spentUntil.set(client, until);
    if (until > now) await this.#sleep(until - now);
  }

  /** `body`, passed on no faster than `client`'s share allows. */
  throttle(body: ReadableStream<Uint8Array>, client: string): ReadableStream<Uint8Array> {
    return body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform: async (chunk, controller) => {
          await this.take(client, chunk.byteLength);
          controller.enqueue(chunk);
        },
      }),
    );
  }

  #prune(now: number): void {
    if (now - this.#prunedAt < PRUNE_INTERVAL_MS) return;
    this.#prunedAt = now;
    for (const [client, until] of this.#spentUntil) {
      if (until < now - BURST_MS) this.#spentUntil.delete(client);
    }
  }
}
