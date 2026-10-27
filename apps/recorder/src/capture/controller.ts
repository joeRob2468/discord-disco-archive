/**
 * Acts on the session manager's decisions: joins and leaves voice, opens the target's
 * stream, and runs one ffmpeg capture per set, handing each finished set to
 * post-processing. When the capture reports a long silence, it asks the session
 * manager whether to hand over (rule 4).
 *
 * Browser steps are slow and must not interleave, so every event goes through one
 * queue and runs to completion before the next starts.
 *
 * If the recorder drops out of voice on its own (network, AFK move, kick), it closes the
 * current set, rejoins with a few retries, and picks the current target up again as a
 * new set.
 *
 * Discord popups (modal dialogs) block clicks on the call view, so they're closed before
 * opening a stream and when the stream goes silent; a failed open is retried once. Both
 * save a screenshot of the browser, for finding out what happened afterwards.
 *
 * A live stream that stays silent is reported in chat as it goes on (at the handover's
 * seconds, then `SILENCE_WARN_SECONDS`), and at `silenceAlertSeconds` it may have stopped
 * playing on our side (the browser stopped feeding the capture), so the controller
 * reopens it, once per silence. The capture keeps running throughout.
 *
 * `/record split` ends the current set and records the same stream as a new one, for DJs
 * sharing a stream. The new capture starts before the old one stops, so the handover
 * overlaps by a moment instead of losing it.
 *
 * Restart grace: when the session manager holds a set open after its stream dropped, the
 * capture stops but the set doesn't end. If the stream comes back, the next capture goes
 * into a new segment file; when the set ends, its segments are joined into its raw WAV.
 */
import { rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Logger } from '@dsr/core';
import { captureAudio, concatAudio, type FfmpegProcess, type SilenceEvent } from '@dsr/media';
import type { Page } from 'playwright';
import {
  closePopups,
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
import { saveScreenshot } from '../browser/screenshots.ts';
import { writeActiveSession } from './recorder-state.ts';
import type {
  SessionInfo,
  SessionManager,
  Target,
  TargetChange,
} from '../session/session-manager.ts';
import { SessionRecord } from './session-record.ts';

/** Below this the stream counts as silent. Paused or muted streams measure about -91 dB. */
const SILENCE_THRESHOLD_DB = -60;
/** A second chat notice of a continuing silence, before the reopen. */
const SILENCE_WARN_SECONDS = 180;
/** While silent, how often to re-check for someone else live to hand over to. */
const SILENCE_RECHECK_MS = 5_000;
/** float32 stereo at 48 kHz; the capture format from `@dsr/media`'s `audioCaptureArgs`. */
const WAV_BYTES_PER_SECOND = 48_000 * 2 * 4;
/** A split stops the old capture once the new one holds this much audio... */
const SPLIT_OVERLAP_BYTES = WAV_BYTES_PER_SECOND / 4;
/** ...or after this long, whichever comes first. */
const SPLIT_WAIT_MS = 5_000;
/** Warn when a capture holds this much less audio than the time it ran. */
const MISSING_AUDIO_WARN_SECONDS = 1;

export interface ControllerConfig {
  recordingsDir: string;
  pulseSource: string;
  streamVolume: number;
  handoverSilenceSeconds: number;
  /** Alert and reopen the stream after this much silence (at least the handover's). */
  silenceAlertSeconds: number;
  /** Where to save screenshots of the browser when something goes wrong; none if unset. */
  screenshotDir?: string | undefined;
}

export interface ControllerDeps {
  /** The browser's page; it's open from just before a session starts until after it ends. */
  page: () => Page;
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
  /** Resolves once a new capture is recording, before a split stops the old one. */
  waitForCapture?: (file: string) => Promise<void>;
}

const REJOIN_DELAYS_MS = [0, 10_000, 30_000, 60_000];

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** Wait until `file` holds a moment of audio (or give up after `SPLIT_WAIT_MS`). */
async function waitForAudio(file: string): Promise<void> {
  const deadline = Date.now() + SPLIT_WAIT_MS;
  while (Date.now() < deadline) {
    const size = await stat(file).then(
      (info) => info.size,
      () => 0,
    );
    if (size >= SPLIT_OVERLAP_BYTES) return;
    await sleep(100);
  }
}

interface ActiveCapture {
  setId: string;
  /** The set's raw WAV (`files.rawAudio`): the first segment, and the joined result. */
  mainFile: string;
  /** The segment being written now. */
  file: string;
  /** Finished segment files, in order. */
  parts: string[];
  /** When the current segment started. */
  startedAt: Date;
  target: Target;
  ffmpeg: FfmpegProcess;
  stopping: boolean;
  silenceTimer: NodeJS.Timeout | undefined;
  /** The 3-minute notice and the long-silence alert, while silent. */
  warnTimer: NodeJS.Timeout | undefined;
  alertTimer: NodeJS.Timeout | undefined;
  /** Set once chat was told of the current silence, to say when the audio is back. */
  noticed: boolean;
  /** Set while the set is held open between segments (its stream dropped). */
  heldAt: Date | undefined;
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export class RecordingController {
  readonly #page: () => Page;
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
  /** Set when shutting down: the session ends but stays the one to resume. */
  #restarting = false;
  readonly #rejoinDelaysMs: readonly number[];
  readonly #waitForCapture: (file: string) => Promise<void>;

  constructor(deps: ControllerDeps) {
    this.#page = deps.page;
    this.#sessions = deps.sessions;
    this.#config = deps.config;
    this.#notify = deps.notify;
    this.#logger = deps.logger;
    this.#now = deps.now ?? (() => new Date());
    this.#postProcess = deps.postProcess;
    this.#rejoinDelaysMs = deps.rejoinDelaysMs ?? REJOIN_DELAYS_MS;
    this.#waitForCapture = deps.waitForCapture ?? waitForAudio;
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

  /**
   * The recorder is shutting down: the session that ends next stays in `state.json`, so
   * it's resumed after the restart.
   */
  shuttingDown(): void {
    this.#restarting = true;
  }

  sessionEnded(session: SessionInfo): void {
    this.#enqueue('session end', () => this.#end(session));
  }

  /**
   * `/record switch` to the current target: reopen its stream if it isn't being recorded
   * (opening it failed). False if it's being recorded already, or nothing is targeted.
   */
  retryTarget(): boolean {
    const session = this.#sessions.active;
    const target = this.#sessions.status()?.target;
    if (!session || !target || this.#capture?.target.userId === target.userId) return false;
    this.#enqueue('retry stream', async () => {
      // Opened meanwhile, or the target moved on.
      if (this.#capture || this.#sessions.status()?.target?.userId !== target.userId) return;
      if (!this.#inVoice) {
        this.#logger.warn({ to: target.displayName }, 'not in voice; not retrying this stream');
        return;
      }
      await stopWatching(this.#page());
      await this.#openStream(target, true, session);
    });
    return true;
  }

  /**
   * `/record split`: end the current set here and record the same stream as a new set,
   * named `name` (default: the stream's owner); `previous` renames the set that ends.
   * Returns why it can't, or undefined once the split is queued.
   */
  split({ name, previous }: { name?: string; previous?: string }): string | undefined {
    const session = this.#sessions.active;
    const owner = this.#sessions.status()?.target;
    const capture = this.#capture;
    if (
      !session ||
      !owner ||
      !capture ||
      capture.heldAt ||
      capture.target.userId !== owner.userId
    ) {
      return 'Nothing is being recorded right now, so there is no set to split.';
    }
    this.#enqueue('split', () => this.#split(capture, session, owner, name, previous));
    return undefined;
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
    if (session.resumeDir === undefined) {
      this.#record = await SessionRecord.create(this.#config.recordingsDir, session);
      this.#logger.info({ dir: this.#record.paths.dir }, 'session folder created');
    } else {
      // A session just stopped finishes after its encodes; let it, before reopening it.
      await Promise.all(this.#finishing);
      this.#record = await SessionRecord.reopen(this.#config.recordingsDir, session.resumeDir);
      this.#logger.info({ dir: this.#record.paths.dir }, 'session folder reopened');
      // Before closing interrupted sets, which would then count as unfinished too.
      if (session.afterRestart) this.#reprocess(this.#record);
      await this.#closeInterrupted(this.#record);
    }
    await this.#saveState(this.#record);

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

  /** Remember the active session (`state.json`), so a restart can carry on with it. */
  async #saveState(record: SessionRecord | undefined): Promise<void> {
    const active = record && {
      sessionId: record.session.id,
      dir: path.basename(record.paths.dir),
    };
    try {
      await writeActiveSession(this.#config.recordingsDir, active ?? null);
    } catch (error) {
      this.#logger.warn({ err: error }, 'could not save the active session');
    }
  }

  /**
   * Sets a resumed session left `recording`: the recorder stopped without ending them
   * (a crash). Each ends where its capture file stopped growing, as partial, and is
   * leveled with whatever audio reached the disk.
   */
  async #closeInterrupted(record: SessionRecord): Promise<void> {
    for (const set of record.session.sets.filter((s) => s.status === 'recording')) {
      const file = set.files.rawAudio && path.join(record.paths.dir, set.files.rawAudio);
      const written = file && (await stat(file).catch(() => undefined));
      if (!written) {
        await record.endSet(set.id, new Date(), {
          partial: true,
          error: 'The recorder stopped while recording, and no audio was saved.',
        });
        continue;
      }
      await record.endSet(set.id, written.mtime, { partial: true });
      this.#logger.warn({ setId: set.id }, 'closed a set the recorder stopped during');
      this.#processing = this.#postProcess(record, set.id);
    }
  }

  /** Level again the sets a restart interrupted (left `processing`; nothing else has them). */
  #reprocess(record: SessionRecord): void {
    for (const set of record.session.sets.filter((s) => s.status === 'processing')) {
      this.#logger.info({ setId: set.id }, 'leveling a set the restart interrupted');
      this.#processing = this.#postProcess(record, set.id);
    }
  }

  async #join(session: SessionInfo): Promise<void> {
    await openChannel(this.#page(), session.guildId, session.channelId);
    // Deafen before joining so voice chat never plays, even briefly.
    await muteAndDeafen(this.#page());
    await joinVoice(this.#page(), session.channelId);
    this.#inVoice = true;
    if (!(await isMutedAndDeafened(this.#page()))) {
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
    if (!(await this.#showStream(target, session))) return false;
    await this.#startCapture(target, partial, session);
    return true;
  }

  /**
   * Watch, unmute and set the volume of `target`'s stream, closing popups first and
   * retrying once. False (and says so) on failure.
   */
  async #showStream(target: Target, session: SessionInfo): Promise<boolean> {
    for (let attempt = 1; ; attempt++) {
      try {
        // On the retry, press Escape anyway in case a popup isn't marked up as a dialog.
        await this.#closePopups(attempt > 1);
        await watchStream(this.#page(), target);
        const wasMuted = await unmuteStream(this.#page(), target);
        const volume = await setStreamVolume(this.#page(), target, this.#config.streamVolume);
        this.#logger.info({ target: target.displayName, wasMuted, volume }, 'stream opened');
        return true;
      } catch (error) {
        const screenshot = await this.#screenshot('open-failed');
        if (attempt === 1) {
          this.#logger.warn(
            { err: error, target: target.displayName, screenshot },
            'could not open stream; retrying',
          );
          // It may have opened partway (watching, but not unmuted or set).
          await stopWatching(this.#page()).catch(() => undefined);
          continue;
        }
        this.#logger.error(
          { err: error, target: target.displayName, screenshot },
          'could not open stream',
        );
        this.#notify(
          session.channelId,
          `⚠️ Couldn't open **${target.displayName}**'s stream, so it isn't being recorded. ` +
            `Try \`/record switch\` to **${target.displayName}** to retry.`,
        );
        return false;
      }
    }
  }

  /** Close any Discord popups, logging what was closed. Never throws. */
  async #closePopups(escape = false): Promise<string[]> {
    try {
      const closed = await closePopups(this.#page(), { escape });
      if (closed.length > 0) this.#logger.warn({ popups: closed }, 'closed Discord popups');
      return closed;
    } catch (error) {
      this.#logger.warn({ err: error }, 'could not check for Discord popups');
      return [];
    }
  }

  /** Save a screenshot of the browser; its path, or undefined if none was saved. */
  async #screenshot(reason: string): Promise<string | undefined> {
    const dir = this.#config.screenshotDir;
    if (dir === undefined) return undefined;
    try {
      return await saveScreenshot(this.#page(), dir, reason, this.#now());
    } catch (error) {
      this.#logger.warn({ err: error, reason }, 'could not save a screenshot');
      return undefined;
    }
  }

  /** The target's stream dropped: stop capturing but keep the set open for its return. */
  async #hold(): Promise<void> {
    const capture = this.#capture;
    if (!capture || capture.heldAt) return;
    await this.#stopSegment(capture);
    capture.heldAt = this.#now();
    this.#logger.info({ setId: capture.setId, segments: capture.parts.length }, 'set held open');
  }

  /** The held target is live again: record the next segment of the same set. */
  async #resume(target: Target, session: SessionInfo): Promise<void> {
    const capture = this.#capture;
    if (capture?.heldAt === undefined || capture.target.userId !== target.userId) {
      // Nothing held for them (e.g. the recorder rejoined meanwhile): a new set.
      await this.#stopCapture(false);
      if (this.#inVoice) await this.#openStream(target, false, session);
      return;
    }
    if (!this.#inVoice || !(await this.#showStream(target, session))) {
      await this.#stopCapture(false);
      return;
    }
    const gapSeconds = Math.round((this.#now().getTime() - capture.heldAt.getTime()) / 1000);
    capture.heldAt = undefined;
    capture.file = capture.mainFile.replace(
      /\.wav$/,
      `.seg${String(capture.parts.length + 1)}.wav`,
    );
    capture.startedAt = this.#now();
    this.#spawn(capture, session);
    this.#logger.info({ setId: capture.setId, file: capture.file, gapSeconds }, 'set resumed');
  }

  async #switch(change: TargetChange, session: SessionInfo): Promise<void> {
    if (change.reason === 'stream-dropped') {
      await this.#hold();
      if (this.#inVoice) await stopWatching(this.#page());
      return;
    }
    if (change.reason === 'resumed' && change.to) {
      await this.#resume(change.to, session);
      return;
    }
    await this.#stopCapture(change.reason === 'session-stopped');
    if (change.from && this.#inVoice) await stopWatching(this.#page());
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
    // Shutting down to restart: keep it as the active session, to carry on with after.
    if (!this.#restarting) await this.#saveState(undefined);

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
      await stopWatching(this.#page());
      await leaveVoice(this.#page());
    } catch (error) {
      this.#logger.warn({ err: error }, 'could not leave voice cleanly');
    } finally {
      this.#inVoice = false;
      this.#leaving = false;
    }
  }

  /** Start a set and its capture; returns it (undefined without a session folder). */
  async #startCapture(
    target: Target,
    partial: boolean,
    session: SessionInfo,
    nameGiven = false,
  ): Promise<ActiveCapture | undefined> {
    if (!this.#record) return undefined;
    const { setId, rawAudioPath } = await this.#record.startSet(
      target,
      this.#now(),
      partial,
      nameGiven,
    );
    const capture: ActiveCapture = {
      setId,
      mainFile: rawAudioPath,
      file: rawAudioPath,
      parts: [],
      startedAt: this.#now(),
      target,
      // Runs the silence callback later, once `capture` exists.
      ffmpeg: this.#runCapture(rawAudioPath, (event) => {
        this.#onSilence(capture, event);
      }),
      stopping: false,
      silenceTimer: undefined,
      warnTimer: undefined,
      alertTimer: undefined,
      noticed: false,
      heldAt: undefined,
    };
    this.#capture = capture;
    this.#watchExit(capture, session);
    this.#logger.info({ setId, file: rawAudioPath }, 'capture started');
    return capture;
  }

  #runCapture(output: string, onSilence: (event: SilenceEvent) => void): FfmpegProcess {
    return captureAudio(
      {
        source: this.#config.pulseSource,
        output,
        silence: {
          thresholdDb: SILENCE_THRESHOLD_DB,
          seconds: this.#config.handoverSilenceSeconds,
        },
      },
      onSilence,
    );
  }

  /** Start the next segment's ffmpeg, writing `capture.file`. */
  #spawn(capture: ActiveCapture, session: SessionInfo): void {
    capture.ffmpeg = this.#runCapture(capture.file, (event) => {
      this.#onSilence(capture, event);
    });
    capture.stopping = false;
    this.#watchExit(capture, session);
  }

  /** Report the current segment's ffmpeg dying on its own (not when we stop it). */
  #watchExit(capture: ActiveCapture, session: SessionInfo): void {
    const ffmpeg = capture.ffmpeg;
    const died = (reason: string): void => {
      if (!capture.stopping && capture.ffmpeg === ffmpeg) {
        this.#captureDied(capture, session, reason);
      }
    };
    ffmpeg.done.then(
      () => {
        died('ffmpeg exited');
      },
      (error: unknown) => {
        died(errorMessage(error));
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

  /** Stop the current segment's ffmpeg. Returns the error if it didn't stop cleanly. */
  async #stopSegment(capture: ActiveCapture): Promise<string | undefined> {
    capture.stopping = true;
    this.#clearSilence(capture);
    let error: string | undefined;
    try {
      await capture.ffmpeg.stop();
    } catch (stopError) {
      error = errorMessage(stopError);
      this.#logger.error({ err: stopError, setId: capture.setId }, 'capture did not stop cleanly');
    }
    await this.#checkDuration(capture);
    capture.parts.push(capture.file);
    return error;
  }

  /** End the current set: stop capturing (unless held), join its segments, then post-process. */
  async #stopCapture(partial: boolean): Promise<void> {
    const capture = this.#capture;
    if (!capture) return;
    this.#capture = undefined;
    await this.#endCapture(capture, partial);
  }

  async #endCapture(capture: ActiveCapture, partial: boolean): Promise<void> {
    const held = capture.heldAt;
    // A held set ended when its stream dropped, not now.
    const error = held ? undefined : await this.#stopSegment(capture);
    if (capture.parts.length > 1) await this.#joinSegments(capture);
    await this.#record?.endSet(capture.setId, held ?? this.#now(), {
      // A held set ended when its stream did, so a stop now didn't cut it.
      partial: held ? false : partial,
      ...(error !== undefined && { error }),
    });
    this.#logger.info(
      { setId: capture.setId, partial, segments: capture.parts.length },
      'capture stopped',
    );
    if (error === undefined && this.#record) {
      this.#processing = this.#postProcess(this.#record, capture.setId);
    }
  }

  async #split(
    old: ActiveCapture,
    session: SessionInfo,
    owner: Target,
    name: string | undefined,
    previous: string | undefined,
  ): Promise<void> {
    // The stream dropped or moved on while this was queued.
    if (this.#capture !== old || old.heldAt || old.stopping) {
      this.#logger.info({ setId: old.setId }, 'split skipped: the set already ended');
      return;
    }
    if (previous !== undefined) await this.#record?.renameSet(old.setId, previous);
    const ended = previous ?? old.target.displayName;
    const next: Target = { ...owner, displayName: name ?? owner.displayName };
    // The new capture first, the old one stopped once the new one is recording: the
    // handover overlaps by a moment instead of losing it.
    const started = await this.#startCapture(next, false, session, name !== undefined);
    if (started) await this.#waitForCapture(started.file);
    await this.#endCapture(old, false);
    this.#logger.info(
      { from: old.setId, to: started?.setId, owner: owner.displayName },
      'set split',
    );
    this.#notify(
      session.channelId,
      `✂️ Split: **${ended}**'s set ends here; now recording **${next.displayName}**` +
        (next.displayName === owner.displayName ? '.' : ` on ${owner.displayName}'s stream.`),
    );
  }

  /**
   * Join a set's segments back to back into its raw WAV (the dropout is cut out). On
   * failure the set keeps only its first segment, and the others stay on disk.
   */
  async #joinSegments(capture: ActiveCapture): Promise<void> {
    const joined = capture.mainFile.replace(/\.wav$/, '.joined.wav');
    try {
      await concatAudio(capture.parts, joined);
      await rename(joined, capture.mainFile);
      for (const part of capture.parts.slice(1)) await rm(part, { force: true });
      this.#logger.info(
        { setId: capture.setId, segments: capture.parts.length },
        'segments joined',
      );
    } catch (error) {
      this.#logger.error(
        { err: error, setId: capture.setId, parts: capture.parts },
        'could not join segments; keeping the first one',
      );
      await rm(joined, { force: true });
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
      const channelId = this.#sessions.active?.channelId;
      if (capture.noticed && channelId !== undefined) {
        capture.noticed = false;
        this.#notify(channelId, `✅ ${this.#streamOf(capture)} is audible again.`);
      }
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
    // `silencedetect` reports silence once it has lasted the handover's seconds.
    const after = (seconds: number): number =>
      Math.max(0, seconds - this.#config.handoverSilenceSeconds) * 1000;
    if (SILENCE_WARN_SECONDS < this.#config.silenceAlertSeconds) {
      capture.warnTimer = setTimeout(() => {
        capture.warnTimer = undefined;
        this.#silenceNotice(
          capture,
          `has been silent for ${String(SILENCE_WARN_SECONDS / 60)} min. If it stays silent, ` +
            `the recorder will reopen it at ${String(Math.round(this.#config.silenceAlertSeconds / 60))} min.`,
        );
      }, after(SILENCE_WARN_SECONDS));
    }
    capture.alertTimer = setTimeout(() => {
      capture.alertTimer = undefined;
      this.#enqueue('silence alert', () => this.#silenceAlert(capture));
    }, after(this.#config.silenceAlertSeconds));
    // Handing over to someone else live is announced as a switch, not as a silence.
    const done = check();
    // A popup may have cut the audio: record what the browser shows, and close it.
    this.#enqueue('silence check', async () => {
      if (this.#capture !== capture || capture.stopping) return;
      const screenshot = await this.#screenshot('silent');
      const popups = await this.#closePopups();
      this.#logger.info(
        { target: capture.target.displayName, screenshot, popups },
        'checked silent stream',
      );
      if (!done) {
        this.#silenceNotice(
          capture,
          `has been silent for ${String(this.#config.handoverSilenceSeconds)} s.`,
        );
      }
    });
    if (done) return;
    capture.silenceTimer = setInterval(() => {
      if (check()) this.#clearSilence(capture);
    }, SILENCE_RECHECK_MS);
  }

  /** Tell chat about a continuing silence of the current set's stream ("🔇 … `text`"). */
  #silenceNotice(capture: ActiveCapture, text: string): void {
    const session = this.#sessions.active;
    if (this.#capture !== capture || capture.stopping || capture.heldAt || !session) return;
    capture.noticed = true;
    this.#notify(session.channelId, `🔇 ${this.#streamOf(capture)} ${text}`);
  }

  #clearSilence(capture: ActiveCapture): void {
    if (capture.silenceTimer) clearInterval(capture.silenceTimer);
    if (capture.warnTimer) clearTimeout(capture.warnTimer);
    if (capture.alertTimer) clearTimeout(capture.alertTimer);
    capture.silenceTimer = undefined;
    capture.warnTimer = undefined;
    capture.alertTimer = undefined;
  }

  /**
   * "**DJ**'s stream", or "**Owner**'s stream (**Set**)" for a set named apart from the
   * stream's owner (a split), so chat says whose stream to check.
   */
  #streamOf(capture: ActiveCapture): string {
    const set = capture.target.displayName;
    const owner = this.#sessions.status()?.target;
    return owner?.userId === capture.target.userId && owner.displayName !== set
      ? `**${owner.displayName}**'s stream (**${set}**)`
      : `**${set}**'s stream`;
  }

  /**
   * The current DJ's stream is still live but has been silent for `silenceAlertSeconds`:
   * say so, and reopen it in case it stopped playing on our side.
   */
  async #silenceAlert(capture: ActiveCapture): Promise<void> {
    const session = this.#sessions.active;
    if (this.#capture !== capture || capture.stopping || capture.heldAt || !session) return;
    if (this.#sessions.status()?.target?.userId !== capture.target.userId) return;
    const name = capture.target.displayName;
    const minutes = Math.round(this.#config.silenceAlertSeconds / 60);
    this.#logger.warn(
      { target: name, seconds: this.#config.silenceAlertSeconds },
      'stream silent too long; reopening',
    );
    capture.noticed = true;
    this.#notify(
      session.channelId,
      `⚠️ ${this.#streamOf(capture)} has been silent for ${String(minutes)} min. ` +
        "Reopening it in case the problem is on the recorder's side.",
    );
    const screenshot = await this.#screenshot('silent-long');
    this.#logger.info({ target: name, screenshot }, 'saved screenshot of silent stream');
    if (!this.#inVoice) return;
    await stopWatching(this.#page()).catch(() => undefined);
    // The capture keeps running: it records whatever the browser plays.
    if (await this.#showStream(capture.target, session)) {
      this.#logger.info({ target: name }, 'reopened silent stream');
    }
  }
}
