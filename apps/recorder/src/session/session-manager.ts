/**
 * The active recording session and the handover rules that decide whose stream is
 * recorded (docs/design.md, "Whose stream to record"). Pure state + decisions: Discord
 * events come in as method calls, and session and target changes go out through the
 * `on*` callbacks, which the recording controller acts on.
 *
 * Restart grace: when the current DJ's stream ends and nobody else is live, their set is
 * held open for `restartGraceMs`. If they go live again in time it continues as the same
 * set (`resumed`); otherwise it ends then. Anyone else going live hands over at once.
 */
import { StreamTracker, type LiveStream } from './stream-tracker.ts';

export interface SessionInfo {
  guildId: string;
  channelId: string;
  channelName: string;
  title: string | undefined;
  startedAt: Date;
  startedBy: { userId: string; displayName: string };
  /** Reopen this session folder and record into it (`/record resume`), not a new one. */
  resumeDir?: string;
}

export type SwitchReason =
  /** Recording began and this stream was already live. */
  | 'already-live'
  /** Nobody was being recorded and this user went live. */
  | 'went-live'
  /** The previous target stopped streaming. */
  | 'stopped-streaming'
  /** The previous target went silent while this user was live. */
  | 'silence'
  /** `/record switch`. */
  | 'requested'
  /** `/record stop`. */
  | 'session-stopped'
  /** The target's stream ended with nobody else live: their set is held open (grace). */
  | 'stream-dropped'
  /** The held target went live again within the grace window: same set continues. */
  | 'resumed';

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
  /** How long the set is held open, for `stream-dropped`. */
  holdSeconds?: number;
}

export interface SessionStatus {
  session: SessionInfo;
  target: Target | undefined;
  /** A target whose stream dropped, held open in case it comes back. */
  held: Target | undefined;
  live: LiveStream[];
}

export type StartResult =
  { ok: true; session: SessionInfo; alreadyRunning: boolean } | { ok: false; reason: string };

export type SwitchResult =
  { ok: true; change: TargetChange | undefined } | { ok: false; reason: string };

export interface SessionManagerOptions {
  now?: () => Date;
  /** How long a dropped target's set stays open (0 ends it at once). */
  restartGraceMs?: number;
  /** Timer for the grace window; returns a cancel function. Injectable for tests. */
  setTimer?: (callback: () => void, ms: number) => () => void;
  /** Called before the first target is picked, so listeners can join first. */
  onSessionStart?: (session: SessionInfo) => void;
  onTargetChange?: (change: TargetChange, session: SessionInfo) => void;
  /** Called after the final `session-stopped` target change, with the final title. */
  onSessionEnd?: (session: SessionInfo) => void;
}

export class SessionManager {
  readonly #now: () => Date;
  readonly #onSessionStart: (session: SessionInfo) => void;
  readonly #onTargetChange: (change: TargetChange, session: SessionInfo) => void;
  readonly #onSessionEnd: (session: SessionInfo) => void;
  readonly #restartGraceMs: number;
  readonly #setTimer: (callback: () => void, ms: number) => () => void;
  readonly #tracker = new StreamTracker();
  #session: SessionInfo | undefined;
  #target: Target | undefined;
  #held: Target | undefined;
  #cancelHold: (() => void) | undefined;

  constructor(options: SessionManagerOptions = {}) {
    this.#now = options.now ?? (() => new Date());
    this.#onSessionStart = options.onSessionStart ?? (() => undefined);
    this.#onTargetChange = options.onTargetChange ?? (() => undefined);
    this.#onSessionEnd = options.onSessionEnd ?? (() => undefined);
    this.#restartGraceMs = options.restartGraceMs ?? 0;
    this.#setTimer =
      options.setTimer ??
      ((callback, ms) => {
        const timer = setTimeout(callback, ms);
        return () => {
          clearTimeout(timer);
        };
      });
  }

  get active(): SessionInfo | undefined {
    return this.#session;
  }

  /**
   * Start a session. `liveNow` is who is already streaming in the channel; the earliest
   * of them becomes the first target. A resumed session keeps its original `startedAt`.
   */
  start(
    info: Omit<SessionInfo, 'startedAt'> & { startedAt?: Date },
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

    const now = this.#now();
    this.#session = { ...info, startedAt: info.startedAt ?? now };
    this.#tracker.clear();
    for (const stream of liveNow) this.#tracker.start(stream.userId, stream.displayName, now);
    this.#onSessionStart(this.#session);

    const first = this.#tracker.earliest();
    if (first) this.#setTarget(first, 'already-live');
    return { ok: true, session: this.#session, alreadyRunning: false };
  }

  /** End the session. Returns it, or undefined if none was active. */
  stop(): SessionInfo | undefined {
    const session = this.#session;
    if (!session) return undefined;
    const current = this.#target ?? this.#held;
    this.#clearHold();
    if (current) this.#emit({ from: current, to: undefined, reason: 'session-stopped' });
    this.#session = undefined;
    this.#target = undefined;
    this.#tracker.clear();
    this.#onSessionEnd(session);
    return session;
  }

  setTitle(title: string): SessionInfo | undefined {
    if (!this.#session) return undefined;
    this.#session = { ...this.#session, title };
    return this.#session;
  }

  status(): SessionStatus | undefined {
    if (!this.#session) return undefined;
    return {
      session: this.#session,
      target: this.#target,
      held: this.#held,
      live: this.#tracker.list(),
    };
  }

  /** A member in `channelId` went live. */
  streamStarted(channelId: string, userId: string, displayName: string): void {
    if (this.#session?.channelId !== channelId) return;
    if (!this.#tracker.start(userId, displayName, this.#now())) return;
    // Back within the grace window: the same set carries on.
    if (this.#held?.userId === userId) {
      const target = this.#held;
      this.#clearHold();
      this.#target = target;
      this.#emit({ from: undefined, to: target, reason: 'resumed' });
      return;
    }
    // Rule 1: stay on the current streamer. Only pick this one if nobody is recorded. A
    // held set ends here: someone else going live hands over at once.
    if (!this.#target) this.#setTarget({ userId, displayName }, 'went-live');
  }

  /** A member stopped streaming, or left the channel while streaming. */
  streamEnded(channelId: string, userId: string): void {
    if (this.#session?.channelId !== channelId) return;
    this.#tracker.end(userId);
    if (this.#target?.userId !== userId) return;
    // Rule 2: hand over to whoever went live earliest, or wait.
    const next = this.#tracker.earliest();
    if (next || this.#restartGraceMs <= 0) {
      this.#setTarget(next, 'stopped-streaming');
      return;
    }
    // Nobody else is live: hold the set open in case this stream comes back.
    const held = this.#target;
    this.#target = undefined;
    this.#held = held;
    this.#cancelHold = this.#setTimer(() => {
      this.#expireHold(held);
    }, this.#restartGraceMs);
    this.#emit({
      from: held,
      to: undefined,
      reason: 'stream-dropped',
      holdSeconds: Math.round(this.#restartGraceMs / 1000),
    });
  }

  #expireHold(held: Target): void {
    if (this.#held !== held) return;
    this.#clearHold();
    this.#emit({ from: held, to: undefined, reason: 'stopped-streaming' });
  }

  #clearHold(): void {
    this.#cancelHold?.();
    this.#cancelHold = undefined;
    this.#held = undefined;
  }

  /** Rule 3: the current stream has been silent for the handover window. */
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
    // A held set ends with any other change of target.
    const from = this.#target ?? this.#held;
    this.#clearHold();
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
