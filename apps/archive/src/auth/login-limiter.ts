/**
 * Caps login attempts per client, so the shared passwords can't be guessed at speed. An
 * attempt is counted before the password is checked, so parallel requests can't all slip
 * in during the failed-login delay; a correct password clears the client's count. IPv6
 * clients count per /64, since one host usually holds a whole /64 and could rotate.
 */
export const LOGIN_ATTEMPTS = 10;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
/** Forget clients whose attempts have all expired. */
const PRUNE_INTERVAL_MS = 60_000;

/** The key a client's attempts are counted under. */
export function clientKey(ip: string | undefined): string {
  if (ip === undefined) return 'direct';
  if (!ip.includes(':') || ip.startsWith('::ffff:')) return ip;
  // Expand `::` so the first four groups are the /64.
  const [head = '', tail] = ip.toLowerCase().split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = [
    ...left,
    ...Array<string>(Math.max(0, 8 - left.length - right.length)).fill('0'),
    ...right,
  ];
  return `${groups
    .slice(0, 4)
    .map((group) => group.replace(/^0+(?=.)/, ''))
    .join(':')}::/64`;
}

export class LoginLimiter {
  readonly #now: () => number;
  /** Per client: when each attempt in the window was made, oldest first. */
  readonly #attempts = new Map<string, number[]>();
  #prunedAt = 0;

  constructor({ now = Date.now }: { now?: () => number } = {}) {
    this.#now = now;
  }

  /**
   * Count an attempt by `client`. Returns 0 if it may go ahead, else the seconds until
   * it may try again.
   */
  take(client: string): number {
    const now = this.#now();
    this.#prune(now);
    const recent = (this.#attempts.get(client) ?? []).filter((at) => at > now - LOGIN_WINDOW_MS);
    const oldest = recent[0];
    if (recent.length >= LOGIN_ATTEMPTS && oldest !== undefined) {
      this.#attempts.set(client, recent);
      return Math.ceil((oldest + LOGIN_WINDOW_MS - now) / 1000);
    }
    recent.push(now);
    this.#attempts.set(client, recent);
    return 0;
  }

  /** A correct password: the client starts afresh. */
  succeeded(client: string): void {
    this.#attempts.delete(client);
  }

  #prune(now: number): void {
    if (now - this.#prunedAt < PRUNE_INTERVAL_MS) return;
    this.#prunedAt = now;
    for (const [client, attempts] of this.#attempts) {
      if ((attempts.at(-1) ?? 0) <= now - LOGIN_WINDOW_MS) this.#attempts.delete(client);
    }
  }
}
