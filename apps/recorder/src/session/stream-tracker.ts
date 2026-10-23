/**
 * Who is live (Go Live) in the session's voice channel, and since when. Pure state:
 * the bot feeds it voice state changes; the session manager asks it who to record.
 */

export interface LiveStream {
  userId: string;
  displayName: string;
  /** When we saw them go live (or when tracking began, if they already were). */
  since: Date;
}

export class StreamTracker {
  readonly #live = new Map<string, LiveStream>();

  /** Returns true if this is a new live stream. */
  start(userId: string, displayName: string, at: Date): boolean {
    if (this.#live.has(userId)) return false;
    this.#live.set(userId, { userId, displayName, since: at });
    return true;
  }

  /** Returns the ended stream, if the user was live. */
  end(userId: string): LiveStream | undefined {
    const stream = this.#live.get(userId);
    this.#live.delete(userId);
    return stream;
  }

  get(userId: string): LiveStream | undefined {
    return this.#live.get(userId);
  }

  isLive(userId: string): boolean {
    return this.#live.has(userId);
  }

  /** All live streams, earliest first. */
  list(): LiveStream[] {
    return [...this.#live.values()].sort((a, b) => a.since.getTime() - b.since.getTime());
  }

  /** The earliest live stream other than `exceptUserId`: the handover candidate. */
  earliest(exceptUserId?: string): LiveStream | undefined {
    return this.list().find((stream) => stream.userId !== exceptUserId);
  }

  clear(): void {
    this.#live.clear();
  }
}
