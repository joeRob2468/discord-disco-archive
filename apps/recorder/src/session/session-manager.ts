/**
 * The active recording session and the handover rules that decide whose stream is
 * recorded (docs/plan.md, "Which stream to record"). Pure state + decisions: Discord
 * events come in as method calls, and target changes go out through `onTargetChange`,
 * which the capture layer (milestone 4) will act on.
 */
import { StreamTracker, type LiveStream } from './stream-tracker.ts';

export interface SessionInfo {
  guildId: string;
  channelId: string;
  channelName: string;
  title: string | undefined;
  startedAt: Date;
  startedBy: { userId: string; displayName: string };
}

export type SwitchReason =
  /** Recording began and this stream was already live. */
  | 'already-live'
  /** Nobody was being recorded and this user went live. */
  | 'went-live'
  /** The previous target stopped streaming. */
  | 'stopped-streaming'
  /** The previous target went silent while this user was live (milestone 4). */
  | 'silence'
  /** `/record switch`. */
  | 'requested'
  /** `/record stop`. */
  | 'session-stopped';

export interface Target {
  userId: string;
  displayName: string;
  /** When the recorder started following this stream. */
  since: Date;
}

export interface TargetChange {
  from: Target | undefined;
  to: Target | undefined;
  reason: SwitchReason;
  /** Who ran `/record switch`, for `requested`. */
  requestedBy?: string;
}

export interface SessionStatus {
  session: SessionInfo;
  target: Target | undefined;
  live: LiveStream[];
}

export type StartResult =
  { ok: true; session: SessionInfo; alreadyRunning: boolean } | { ok: false; reason: string };

export type SwitchResult =
  { ok: true; change: TargetChange | undefined } | { ok: false; reason: string };

export interface SessionManagerOptions {
  now?: () => Date;
  onTargetChange?: (change: TargetChange, session: SessionInfo) => void;
}

export class SessionManager {
  readonly #now: () => Date;
  readonly #onTargetChange: (change: TargetChange, session: SessionInfo) => void;
  readonly #tracker = new StreamTracker();
  #session: SessionInfo | undefined;
  #target: Target | undefined;

  constructor(options: SessionManagerOptions = {}) {
    this.#now = options.now ?? (() => new Date());
    this.#onTargetChange = options.onTargetChange ?? (() => undefined);
  }

  get active(): SessionInfo | undefined {
    return this.#session;
  }

  /**
   * Start a session. `liveNow` is who is already streaming in the channel; the earliest
   * of them becomes the first target.
   */
  start(
    info: Omit<SessionInfo, 'startedAt'>,
    liveNow: readonly { userId: string; displayName: string }[],
  ): StartResult {
    if (this.#session) {
      if (this.#session.channelId === info.channelId) {
        return { ok: true, session: this.#session, alreadyRunning: true };
      }
      return {
        ok: false,
        reason: `Already recording in <#${this.#session.channelId}>. Run \`/record stop\` there first.`,
      };
    }

    const startedAt = this.#now();
    this.#session = { ...info, startedAt };
    this.#tracker.clear();
    for (const stream of liveNow) this.#tracker.start(stream.userId, stream.displayName, startedAt);

    const first = this.#tracker.earliest();
    if (first) this.#setTarget(first, 'already-live');
    return { ok: true, session: this.#session, alreadyRunning: false };
  }

  /** End the session. Returns it, or undefined if none was active. */
  stop(): SessionInfo | undefined {
    const session = this.#session;
    if (!session) return undefined;
    if (this.#target) this.#emit({ from: this.#target, to: undefined, reason: 'session-stopped' });
    this.#session = undefined;
    this.#target = undefined;
    this.#tracker.clear();
    return session;
  }

  setTitle(title: string): SessionInfo | undefined {
    if (!this.#session) return undefined;
    this.#session = { ...this.#session, title };
    return this.#session;
  }

  status(): SessionStatus | undefined {
    if (!this.#session) return undefined;
    return { session: this.#session, target: this.#target, live: this.#tracker.list() };
  }

  /** A member in `channelId` went live. */
  streamStarted(channelId: string, userId: string, displayName: string): void {
    if (this.#session?.channelId !== channelId) return;
    if (!this.#tracker.start(userId, displayName, this.#now())) return;
    // Rule 1: stay on the current streamer. Only pick this one if nobody is recorded.
    if (!this.#target) this.#setTarget({ userId, displayName }, 'went-live');
  }

  /** A member stopped streaming, or left the channel while streaming. */
  streamEnded(channelId: string, userId: string): void {
    if (this.#session?.channelId !== channelId) return;
    this.#tracker.end(userId);
    if (this.#target?.userId !== userId) return;
    // Rule 2: hand over to whoever went live earliest, or wait.
    const next = this.#tracker.earliest();
    this.#setTarget(next, 'stopped-streaming');
  }

  /** Rule 3 (milestone 4): the current stream has been silent for the handover window. */
  targetSilent(): TargetChange | undefined {
    if (!this.#target) return undefined;
    const next = this.#tracker.earliest(this.#target.userId);
    // Silence with nobody else live is just a quiet passage; keep recording.
    if (!next) return undefined;
    return this.#setTarget(next, 'silence');
  }

  /** Rule 4: `/record switch`. */
  switchTo(userId: string, requestedBy: string): SwitchResult {
    if (!this.#session) return { ok: false, reason: 'No recording session is active.' };
    const stream = this.#tracker.get(userId);
    if (!stream) {
      return {
        ok: false,
        reason: `<@${userId}> isn't streaming in <#${this.#session.channelId}>.`,
      };
    }
    if (this.#target?.userId === userId) return { ok: true, change: undefined };
    return { ok: true, change: this.#setTarget(stream, 'requested', requestedBy) };
  }

  #setTarget(
    next: { userId: string; displayName: string } | undefined,
    reason: SwitchReason,
    requestedBy?: string,
  ): TargetChange | undefined {
    const from = this.#target;
    const to = next && { userId: next.userId, displayName: next.displayName, since: this.#now() };
    if (from === undefined && to === undefined) return undefined;
    this.#target = to;
    const change: TargetChange = { from, to, reason, ...(requestedBy && { requestedBy }) };
    this.#emit(change);
    return change;
  }

  #emit(change: TargetChange): void {
    if (this.#session) this.#onTargetChange(change, this.#session);
  }
}
