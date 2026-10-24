/**
 * Acts on the session manager's decisions: joins and leaves voice, opens the target's
 * stream, and runs one ffmpeg capture per set, handing each finished set to
 * post-processing. When the capture reports a long silence, it asks the session
 * manager whether to hand over (rule 3).
 *
 * Browser steps are slow and must not interleave, so every event goes through one
 * queue and runs to completion before the next starts.
 *
 * If the recorder drops out of voice on its own (network, AFK move, kick), it closes the
 * current set, rejoins with a few retries, and picks the current target up again as a
 * new set.
 */
import { stat } from 'node:fs/promises';
import type { Logger } from '@dsr/core';
import { captureAudio, type FfmpegProcess, type SilenceEvent } from '@dsr/media';
import type { Page } from 'playwright';
import {
  isMutedAndDeafened,
  joinVoice,
  leaveVoice,
  muteAndDeafen,
  openChannel,
  setStreamVolume,
  stopWatching,
  unmuteStream,
  watchStream,
} from '../browser/discord-web.ts';
import type {
  SessionInfo,
  SessionManager,
  Target,
  TargetChange,
} from '../session/session-manager.ts';
import { SessionRecord } from './session-record.ts';

/** Below this the stream counts as silent. Paused or muted streams measure about -91 dB. */
const SILENCE_THRESHOLD_DB = -60;
/** While silent, how often to re-check for someone else live to hand over to. */
const SILENCE_RECHECK_MS = 5_000;
/** float32 stereo at 48 kHz; the capture format from `@dsr/media`'s `audioCaptureArgs`. */
const WAV_BYTES_PER_SECOND = 48_000 * 2 * 4;
/** Warn when a capture holds this much less audio than the time it ran. */
const MISSING_AUDIO_WARN_SECONDS = 1;

export interface ControllerConfig {
  recordingsDir: string;
  pulseSource: string;
  streamVolume: number;
  handoverSilenceSeconds: number;
}

export interface ControllerDeps {
  page: Page;
  sessions: SessionManager;
  config: ControllerConfig;
  /** Post a notice in a channel's chat. */
  notify: (channelId: string, content: string) => void;
  /** Level and export a finished set; resolves when done, never rejects. */
  postProcess: (record: SessionRecord, setId: string) => Promise<void>;
  logger: Logger;
  now?: () => Date;
  /** Waits before each rejoin attempt; the first is usually 0. */
  rejoinDelaysMs?: readonly number[];
}

const REJOIN_DELAYS_MS = [0, 10_000, 30_000, 60_000];

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

interface ActiveCapture {
  setId: string;
  file: string;
  startedAt: Date;
  target: Target;
  ffmpeg: FfmpegProcess;
  stopping: boolean;
  silenceTimer: NodeJS.Timeout | undefined;
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export class RecordingController {
  readonly #page: Page;
  readonly #sessions: SessionManager;
  readonly #config: ControllerConfig;
  readonly #notify: (channelId: string, content: string) => void;
  readonly #logger: Logger;
  readonly #now: () => Date;
  readonly #postProcess: (record: SessionRecord, setId: string) => Promise<void>;
  #queue: Promise<void> = Promise.resolve();
  /** The current session's latest post-processing job. */
  #processing: Promise<void> = Promise.resolve();
  /** Sessions waiting for post-processing before they can be finished. */
  readonly #finishing = new Set<Promise<void>>();
  #record: SessionRecord | undefined;
  #capture: ActiveCapture | undefined;
  #inVoice = false;
  /** Set while we leave on purpose, so our own leave isn't taken for a drop. */
  #leaving = false;
  readonly #rejoinDelaysMs: readonly number[];

  constructor(deps: ControllerDeps) {
    this.#page = deps.page;
    this.#sessions = deps.sessions;
    this.#config = deps.config;
    this.#notify = deps.notify;
    this.#logger = deps.logger;
    this.#now = deps.now ?? (() => new Date());
    this.#postProcess = deps.postProcess;
    this.#rejoinDelaysMs = deps.rejoinDelaysMs ?? REJOIN_DELAYS_MS;
  }

  sessionStarted(session: SessionInfo): void {
    this.#enqueue('session start', () => this.#start(session));
  }

  targetChanged(change: TargetChange, session: SessionInfo): void {
    this.#enqueue('target change', () => this.#switch(change, session));
  }

  /**
   * The bot saw the recorder account leave `channelId` (disconnected or moved). Ignored
   * unless it's the active session's channel and we didn't leave on purpose.
   */
  recorderLeftVoice(channelId: string): void {
    const session = this.#sessions.active;
    if (session?.channelId !== channelId || this.#leaving || !this.#inVoice) return;
    this.#inVoice = false;
    this.#logger.warn({ channelId }, 'recorder dropped out of voice');
    this.#enqueue('rejoin', () => this.#rejoin(session));
  }

  sessionEnded(session: SessionInfo): void {
    this.#enqueue('session end', () => this.#end(session));
  }

  /**
   * Resolves once every queued step (final set, leaving voice) is done and every ended
   * session has been finished after its post-processing.
   */
  async idle(): Promise<void> {
    await this.#queue;
    await Promise.all(this.#finishing);
  }

  #enqueue(label: string, step: () => Promise<void>): void {
    this.#queue = this.#queue.then(step).catch((error: unknown) => {
      this.#logger.error({ err: error, step: label }, 'recording step failed');
    });
  }

  async #start(session: SessionInfo): Promise<void> {
    this.#record = await SessionRecord.create(this.#config.recordingsDir, session);
    this.#logger.info({ dir: this.#record.paths.dir }, 'session folder created');

    try {
      await this.#join(session);
    } catch (error) {
      this.#logger.error({ err: error, channelId: session.channelId }, 'could not join voice');
      await this.#leave();
      this.#notify(
        session.channelId,
        `⚠️ The recorder couldn't join voice, so nothing is being recorded: ${errorMessage(error)}. ` +
          'Run `/record stop` and try again.',
      );
    }
  }

  async #join(session: SessionInfo): Promise<void> {
    await openChannel(this.#page, session.guildId, session.channelId);
    // Deafen before joining so voice chat never plays, even briefly.
    await muteAndDeafen(this.#page);
    await joinVoice(this.#page, session.channelId);
    this.#inVoice = true;
    if (!(await isMutedAndDeafened(this.#page))) {
      throw new Error('not muted and deafened after joining');
    }
    this.#logger.info({ channelId: session.channelId }, 'joined voice, muted and deafened');
  }

  async #rejoin(session: SessionInfo): Promise<void> {
    const lostAt = this.#now();
    const target = this.#capture?.target;
    // The set ends at the drop; what's after it was never heard.
    await this.#stopCapture(true);
    this.#notify(
      session.channelId,
      '⚠️ The recorder dropped out of voice' +
        (target ? `, so **${target.displayName}**'s set is cut here` : '') +
        '. Rejoining…',
    );

    const stillActive = (): boolean => this.#sessions.active?.channelId === session.channelId;
    let attempt = 0;
    for (const delay of this.#rejoinDelaysMs) {
      attempt += 1;
      if (delay > 0) await sleep(delay);
      if (!stillActive()) {
        this.#logger.info('session ended while rejoining; not rejoining');
        return;
      }
      try {
        await this.#join(session);
        break;
      } catch (error) {
        this.#inVoice = false;
        this.#logger.warn({ err: error, attempt }, 'rejoin attempt failed');
      }
    }
    const gapSeconds = Math.round((this.#now().getTime() - lostAt.getTime()) / 1000);
    if (!this.#inVoice) {
      this.#logger.error({ attempts: attempt, gapSeconds }, 'could not rejoin voice');
      this.#notify(
        session.channelId,
        "⚠️ The recorder couldn't get back into voice, so nothing is being recorded. " +
          'Run `/record stop`, then `/record start` again.',
      );
      return;
    }

    this.#logger.info({ attempts: attempt, gapSeconds }, 'rejoined voice');
    const current = this.#sessions.status()?.target;
    const resumed = current && (await this.#openStream(current, true, session));
    this.#notify(
      session.channelId,
      `✅ Back in voice after ${String(gapSeconds)} s` +
        (resumed ? `; recording **${current.displayName}** again as a new set.` : '.'),
    );
  }

  /** Open `target`'s stream and start a set. Returns false (and says so) if it fails. */
  async #openStream(target: Target, partial: boolean, session: SessionInfo): Promise<boolean> {
    try {
      await watchStream(this.#page, target);
      const wasMuted = await unmuteStream(this.#page, target);
      const volume = await setStreamVolume(this.#page, target, this.#config.streamVolume);
      this.#logger.info({ target: target.displayName, wasMuted, volume }, 'stream opened');
    } catch (error) {
      this.#logger.error({ err: error, target: target.displayName }, 'could not open stream');
      this.#notify(
        session.channelId,
        `⚠️ Couldn't open **${target.displayName}**'s stream, so it isn't being recorded. ` +
          'Try `/record switch` to retry.',
      );
      return false;
    }
    await this.#startCapture(target, partial, session);
    return true;
  }

  async #switch(change: TargetChange, session: SessionInfo): Promise<void> {
    await this.#stopCapture(change.reason === 'session-stopped');
    if (change.from && this.#inVoice) await stopWatching(this.#page);
    if (!change.to) return;
    if (!this.#inVoice) {
      this.#logger.warn({ to: change.to.displayName }, 'not in voice; not recording this stream');
      return;
    }

    await this.#openStream(change.to, change.reason === 'already-live', session);
  }

  async #end(session: SessionInfo): Promise<void> {
    await this.#stopCapture(true);
    await this.#leave();
    const record = this.#record;
    this.#record = undefined;
    if (!record) return;

    // Finishing may rename the folder, so it waits for the session's encodes. Recording
    // doesn't wait: a new session can start meanwhile.
    const endedAt = this.#now();
    const finishing = this.#processing
      .then(() => record.finish(session, endedAt))
      .then(
        () => {
          this.#logger.info({ dir: record.paths.dir }, 'session finished');
        },
        (error: unknown) => {
          this.#logger.error({ err: error, dir: record.paths.dir }, 'could not finish session');
        },
      )
      .finally(() => this.#finishing.delete(finishing));
    this.#finishing.add(finishing);
    this.#processing = Promise.resolve();
  }

  async #leave(): Promise<void> {
    this.#leaving = true;
    try {
      await stopWatching(this.#page);
      await leaveVoice(this.#page);
    } catch (error) {
      this.#logger.warn({ err: error }, 'could not leave voice cleanly');
    } finally {
      this.#inVoice = false;
      this.#leaving = false;
    }
  }

  async #startCapture(target: Target, partial: boolean, session: SessionInfo): Promise<void> {
    if (!this.#record) return;
    const { setId, rawAudioPath } = await this.#record.startSet(target, this.#now(), partial);
    const ffmpeg = captureAudio(
      {
        source: this.#config.pulseSource,
        output: rawAudioPath,
        silence: {
          thresholdDb: SILENCE_THRESHOLD_DB,
          seconds: this.#config.handoverSilenceSeconds,
        },
      },
      (event) => {
        this.#onSilence(capture, event);
      },
    );
    const capture: ActiveCapture = {
      setId,
      file: rawAudioPath,
      startedAt: this.#now(),
      target,
      ffmpeg,
      stopping: false,
      silenceTimer: undefined,
    };
    this.#capture = capture;
    this.#logger.info({ setId, file: rawAudioPath }, 'capture started');

    ffmpeg.done.then(
      () => {
        if (!capture.stopping) this.#captureDied(capture, session, 'ffmpeg exited');
      },
      (error: unknown) => {
        if (!capture.stopping) this.#captureDied(capture, session, errorMessage(error));
      },
    );
  }

  /** ffmpeg stopped on its own: close the set as failed and say so. */
  #captureDied(capture: ActiveCapture, session: SessionInfo, reason: string): void {
    this.#logger.error({ setId: capture.setId, reason }, 'capture stopped unexpectedly');
    this.#notify(
      session.channelId,
      `⚠️ Recording of **${capture.target.displayName}** stopped unexpectedly. ` +
        'Try `/record switch` to restart it.',
    );
    this.#enqueue('capture failure', async () => {
      if (this.#capture !== capture) return;
      this.#clearSilence(capture);
      this.#capture = undefined;
      await this.#record?.endSet(capture.setId, this.#now(), { partial: true, error: reason });
    });
  }

  async #stopCapture(partial: boolean): Promise<void> {
    const capture = this.#capture;
    if (!capture) return;
    this.#capture = undefined;
    capture.stopping = true;
    this.#clearSilence(capture);
    let error: string | undefined;
    try {
      await capture.ffmpeg.stop();
    } catch (stopError) {
      error = errorMessage(stopError);
      this.#logger.error({ err: stopError, setId: capture.setId }, 'capture did not stop cleanly');
    }
    await this.#record?.endSet(capture.setId, this.#now(), {
      partial,
      ...(error !== undefined && { error }),
    });
    this.#logger.info({ setId: capture.setId, partial }, 'capture stopped');
    await this.#checkDuration(capture);
    if (error === undefined && this.#record) {
      this.#processing = this.#postProcess(this.#record, capture.setId);
    }
  }

  /** Compare the audio in the file with how long the capture ran, to catch dropped audio. */
  async #checkDuration(capture: ActiveCapture): Promise<void> {
    try {
      const { size } = await stat(capture.file);
      const audioSeconds = size / WAV_BYTES_PER_SECOND;
      const wallSeconds = (this.#now().getTime() - capture.startedAt.getTime()) / 1000;
      const fields = {
        setId: capture.setId,
        audioSeconds: Math.round(audioSeconds * 10) / 10,
        wallSeconds: Math.round(wallSeconds * 10) / 10,
      };
      if (wallSeconds - audioSeconds > MISSING_AUDIO_WARN_SECONDS) {
        this.#logger.warn(fields, 'capture is shorter than the time it ran');
      } else {
        this.#logger.info(fields, 'capture duration ok');
      }
    } catch (error) {
      this.#logger.warn({ err: error, setId: capture.setId }, 'could not check capture duration');
    }
  }

  #onSilence(capture: ActiveCapture, event: SilenceEvent): void {
    if (this.#capture !== capture || capture.stopping) return;
    if (event.type === 'end') {
      this.#logger.info({ target: capture.target.displayName }, 'audio resumed');
      this.#clearSilence(capture);
      return;
    }
    this.#logger.info(
      { target: capture.target.displayName, seconds: this.#config.handoverSilenceSeconds },
      'stream went silent',
    );
    // Hand over now if someone else is live; otherwise keep checking while it stays
    // silent. Returns true once there is nothing left to check.
    const check = (): boolean => {
      if (this.#capture !== capture || capture.stopping) return true;
      // Only act on silence of the stream the session manager still targets.
      if (this.#sessions.status()?.target?.userId !== capture.target.userId) return true;
      return this.#sessions.targetSilent() !== undefined;
    };
    this.#clearSilence(capture);
    if (check()) return;
    capture.silenceTimer = setInterval(() => {
      if (check()) this.#clearSilence(capture);
    }, SILENCE_RECHECK_MS);
  }

  #clearSilence(capture: ActiveCapture): void {
    if (capture.silenceTimer) clearInterval(capture.silenceTimer);
    capture.silenceTimer = undefined;
  }
}
