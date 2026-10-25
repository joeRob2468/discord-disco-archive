import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createLogger, readJsonFile, sessionSchema } from '@dsr/core';
import type { Page } from 'playwright';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionManager } from '../session/session-manager.ts';
import { RecordingController } from './controller.ts';
import { readActiveSession, writeActiveSession } from './recorder-state.ts';

// The browser and ffmpeg are mocked: these tests cover the controller's decisions.
vi.mock('../browser/discord-web.ts', () => ({
  openChannel: vi.fn(() => Promise.resolve()),
  muteAndDeafen: vi.fn(() => Promise.resolve()),
  joinVoice: vi.fn(() => Promise.resolve()),
  isMutedAndDeafened: vi.fn(() => Promise.resolve(true)),
  closePopups: vi.fn(() => Promise.resolve([])),
  watchStream: vi.fn(() => Promise.resolve()),
  unmuteStream: vi.fn(() => Promise.resolve(false)),
  setStreamVolume: vi.fn(() => Promise.resolve(85)),
  stopWatching: vi.fn(() => Promise.resolve()),
  leaveVoice: vi.fn(() => Promise.resolve()),
}));
vi.mock('@dsr/media', () => ({
  concatAudio: vi.fn(() => Promise.resolve('')),
  captureAudio: vi.fn(() => {
    let finish = (): void => undefined;
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });
    return {
      done,
      stop: () => {
        finish();
        return done;
      },
    };
  }),
}));

/** The session folders in `dir` (it also holds the recorder's state.json). */
const sessionDirs = async (dir: string) =>
  (await readdir(dir)).filter((name) => name !== 'state.json');

// These tests trigger warnings on purpose (failed rejoins, no capture file to measure).
const quietLogger = createLogger('test');
quietLogger.level = 'silent';

const web = await import('../browser/discord-web.ts');
const media = await import('@dsr/media');

const CHANNEL = '300000000000000001';
const AFK_CHANNEL = '300000000000000099';
const DJ = { userId: '400000000000000001', displayName: 'DJ A' };
const info = {
  guildId: '500000000000000001',
  channelId: CHANNEL,
  channelName: 'disco',
  title: undefined,
  startedBy: { userId: DJ.userId, displayName: 'Host' },
};

describe('RecordingController: recorder dropping out of voice', () => {
  let dir: string;
  let notices: string[];
  let sessions: SessionManager;
  let controller: RecordingController;

  beforeEach(async () => {
    vi.clearAllMocks();
    dir = await mkdtemp(path.join(tmpdir(), 'dsr-controller-'));
    notices = [];
    sessions = new SessionManager({
      onSessionStart: (session) => {
        controller.sessionStarted(session);
      },
      onTargetChange: (change, session) => {
        controller.targetChanged(change, session);
      },
      onSessionEnd: (session) => {
        controller.sessionEnded(session);
      },
    });
    controller = new RecordingController({
      page: {} as Page,
      sessions,
      config: {
        recordingsDir: dir,
        pulseSource: 'test',
        streamVolume: 85,
        handoverSilenceSeconds: 45,
        silenceAlertSeconds: 300,
      },
      notify: (_channel, content) => notices.push(content),
      postProcess: () => Promise.resolve(),
      logger: quietLogger,
      rejoinDelaysMs: [0, 0],
    });
    sessions.start(info, [DJ]);
    await controller.idle();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const sets = async () => {
    const [folder] = await sessionDirs(dir);
    const session = await readJsonFile(path.join(dir, folder ?? '', 'session.json'), sessionSchema);
    return session?.sets ?? [];
  };

  it('cuts the set, rejoins and records the same DJ again as a new set', async () => {
    controller.recorderLeftVoice(CHANNEL);
    await controller.idle();

    expect(web.joinVoice).toHaveBeenCalledTimes(2);
    expect(media.captureAudio).toHaveBeenCalledTimes(2);
    const [first, second] = await sets();
    expect(first).toMatchObject({ status: 'processing', partial: true });
    expect(second).toMatchObject({ status: 'recording', partial: true, userId: DJ.userId });
    expect(notices.some((n) => n.includes('dropped out of voice'))).toBe(true);
    expect(notices.some((n) => n.startsWith('✅ Back in voice') && n.includes('DJ A'))).toBe(true);
  });

  it('ignores other channels and its own leaving at the end of a session', async () => {
    controller.recorderLeftVoice(AFK_CHANNEL);
    sessions.stop();
    await controller.idle();
    controller.recorderLeftVoice(CHANNEL);
    await controller.idle();
    expect(web.joinVoice).toHaveBeenCalledTimes(1);
    expect(notices.some((n) => n.includes('dropped out'))).toBe(false);
  });

  it('gives up after its retries and says so', async () => {
    // Once per retry (two), so later tests can join again.
    const offline = new Error('no network');
    vi.mocked(web.joinVoice).mockRejectedValueOnce(offline).mockRejectedValueOnce(offline);
    controller.recorderLeftVoice(CHANNEL);
    await controller.idle();
    expect(web.joinVoice).toHaveBeenCalledTimes(3);
    expect(media.captureAudio).toHaveBeenCalledTimes(1);
    expect(notices.at(-1)).toContain("couldn't get back into voice");
  });
});

describe('RecordingController: restart grace', () => {
  let dir: string;
  let timers: (() => void)[];
  let sessions: SessionManager;
  let controller: RecordingController;

  beforeEach(async () => {
    vi.clearAllMocks();
    dir = await mkdtemp(path.join(tmpdir(), 'dsr-grace-'));
    timers = [];
    sessions = new SessionManager({
      restartGraceMs: 60_000,
      setTimer: (callback) => {
        timers.push(callback);
        return () => undefined;
      },
      onSessionStart: (session) => {
        controller.sessionStarted(session);
      },
      onTargetChange: (change, session) => {
        controller.targetChanged(change, session);
      },
      onSessionEnd: (session) => {
        controller.sessionEnded(session);
      },
    });
    controller = new RecordingController({
      page: {} as Page,
      sessions,
      config: {
        recordingsDir: dir,
        pulseSource: 'test',
        streamVolume: 85,
        handoverSilenceSeconds: 45,
        silenceAlertSeconds: 300,
      },
      notify: () => undefined,
      postProcess: () => Promise.resolve(),
      logger: quietLogger,
    });
    sessions.start(info, [DJ]);
    await controller.idle();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const onlySet = async () => {
    const [folder] = await sessionDirs(dir);
    const session = await readJsonFile(path.join(dir, folder ?? '', 'session.json'), sessionSchema);
    expect(session?.sets).toHaveLength(1);
    return session?.sets[0];
  };

  it('records a stream that comes back as the next segment of the same set, then joins them', async () => {
    sessions.streamEnded(CHANNEL, DJ.userId);
    await controller.idle();
    expect((await onlySet())?.status).toBe('recording');

    sessions.streamStarted(CHANNEL, DJ.userId, DJ.displayName);
    await controller.idle();
    const outputs = vi.mocked(media.captureAudio).mock.calls.map(([options]) => options.output);
    expect(outputs).toHaveLength(2);
    expect(outputs[1]).toMatch(/\.seg2\.wav$/);

    // The joined file replaces the first segment; give the mock something to rename.
    vi.mocked(media.concatAudio).mockImplementation(async (_inputs, output) => {
      await writeFile(output, '');
      return '';
    });
    sessions.stop();
    await controller.idle();
    expect(media.concatAudio).toHaveBeenCalledWith([outputs[0], outputs[1]], expect.any(String));
    expect(await onlySet()).toMatchObject({
      status: 'processing',
      cut: { start: true, end: true },
    });
  });

  it("doesn't count a stop while held as cutting the set's end", async () => {
    sessions.streamEnded(CHANNEL, DJ.userId);
    await controller.idle();
    sessions.stop();
    await controller.idle();
    // The set ended when its stream did, before the stop.
    expect(await onlySet()).toMatchObject({ cut: { start: true, end: false } });
  });

  it('ends the held set when the grace window runs out', async () => {
    sessions.streamEnded(CHANNEL, DJ.userId);
    await controller.idle();
    for (const fire of timers) fire();
    await controller.idle();
    expect(await onlySet()).toMatchObject({ status: 'processing', partial: true });
    expect(media.concatAudio).not.toHaveBeenCalled();
  });
});

describe('RecordingController: opening streams', () => {
  let dir: string;
  let notices: string[];
  let sessions: SessionManager;
  let controller: RecordingController;

  beforeEach(async () => {
    vi.clearAllMocks();
    dir = await mkdtemp(path.join(tmpdir(), 'dsr-open-'));
    notices = [];
    sessions = new SessionManager({
      onSessionStart: (session) => {
        controller.sessionStarted(session);
      },
      onTargetChange: (change, session) => {
        controller.targetChanged(change, session);
      },
      onSessionEnd: (session) => {
        controller.sessionEnded(session);
      },
    });
    controller = new RecordingController({
      page: {} as Page,
      sessions,
      config: {
        recordingsDir: dir,
        pulseSource: 'test',
        streamVolume: 85,
        handoverSilenceSeconds: 45,
        silenceAlertSeconds: 300,
      },
      notify: (_channel, content) => notices.push(content),
      postProcess: () => Promise.resolve(),
      logger: quietLogger,
    });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const blocked = new Error('locator.hover: Timeout 10000ms exceeded');

  it('closes popups first, and retries a failed open once (pressing Escape)', async () => {
    vi.mocked(web.watchStream).mockRejectedValueOnce(blocked);
    sessions.start(info, [DJ]);
    await controller.idle();
    expect(web.closePopups).toHaveBeenNthCalledWith(1, expect.anything(), { escape: false });
    expect(web.closePopups).toHaveBeenNthCalledWith(2, expect.anything(), { escape: true });
    expect(web.watchStream).toHaveBeenCalledTimes(2);
    expect(media.captureAudio).toHaveBeenCalledTimes(1);
    expect(notices).toEqual([]);
  });

  it('says so after the retry fails, and /record switch to the same DJ retries it', async () => {
    vi.mocked(web.watchStream).mockRejectedValueOnce(blocked).mockRejectedValueOnce(blocked);
    sessions.start(info, [DJ]);
    await controller.idle();
    expect(media.captureAudio).not.toHaveBeenCalled();
    expect(notices.at(-1)).toContain("Couldn't open **DJ A**'s stream");

    expect(sessions.switchTo(DJ.userId, DJ.userId)).toEqual({ ok: true, change: undefined });
    expect(controller.retryTarget()).toBe(true);
    await controller.idle();
    expect(media.captureAudio).toHaveBeenCalledTimes(1);
    // Recording now: nothing to retry.
    expect(controller.retryTarget()).toBe(false);
  });

  it('closes popups when the stream goes silent', async () => {
    sessions.start(info, [DJ]);
    await controller.idle();
    vi.mocked(web.closePopups).mockClear();
    const [, onSilence] = vi.mocked(media.captureAudio).mock.calls[0] ?? [];
    onSilence?.({ type: 'start', at: 45 });
    await controller.idle();
    expect(web.closePopups).toHaveBeenCalledWith(expect.anything(), { escape: false });
  });
});

describe('RecordingController: long silence', () => {
  let dir: string;
  let notices: string[];
  let sessions: SessionManager;
  let controller: RecordingController;

  beforeEach(async () => {
    vi.clearAllMocks();
    dir = await mkdtemp(path.join(tmpdir(), 'dsr-silence-'));
    notices = [];
    sessions = new SessionManager({
      onSessionStart: (session) => {
        controller.sessionStarted(session);
      },
      onTargetChange: (change, session) => {
        controller.targetChanged(change, session);
      },
      onSessionEnd: (session) => {
        controller.sessionEnded(session);
      },
    });
    controller = new RecordingController({
      page: {} as Page,
      sessions,
      config: {
        recordingsDir: dir,
        pulseSource: 'test',
        streamVolume: 85,
        handoverSilenceSeconds: 45,
        silenceAlertSeconds: 300,
      },
      notify: (_channel, content) => notices.push(content),
      postProcess: () => Promise.resolve(),
      logger: quietLogger,
    });
    sessions.start(info, [DJ]);
    await controller.idle();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  });

  afterEach(async () => {
    vi.useRealTimers();
    await rm(dir, { recursive: true, force: true });
  });

  const silence = (type: 'start' | 'end') => {
    const [, onSilence] = vi.mocked(media.captureAudio).mock.calls[0] ?? [];
    onSilence?.({ type, at: 0 });
  };

  it('alerts and reopens the stream, keeping the capture, then says when audio is back', async () => {
    silence('start');
    // Reported after 45 s of silence; the alert comes at 300 s.
    await vi.advanceTimersByTimeAsync(254_000);
    await controller.idle();
    expect(notices).toEqual([]);
    await vi.advanceTimersByTimeAsync(1_000);
    await controller.idle();
    expect(notices).toEqual([
      expect.stringContaining("**DJ A**'s stream has been silent for 5 min"),
    ]);
    expect(web.stopWatching).toHaveBeenCalled();
    expect(web.watchStream).toHaveBeenCalledTimes(2);
    expect(media.captureAudio).toHaveBeenCalledTimes(1);

    silence('end');
    expect(notices.at(-1)).toBe("✅ **DJ A**'s stream is audible again.");
  });

  it("doesn't alert when the audio comes back in time", async () => {
    silence('start');
    await vi.advanceTimersByTimeAsync(60_000);
    silence('end');
    await vi.advanceTimersByTimeAsync(600_000);
    await controller.idle();
    expect(notices).toEqual([]);
    expect(web.watchStream).toHaveBeenCalledTimes(1);
  });
});

describe('RecordingController: /record split', () => {
  let dir: string;
  let notices: string[];
  let sessions: SessionManager;
  let controller: RecordingController;
  let events: string[];

  beforeEach(async () => {
    vi.clearAllMocks();
    dir = await mkdtemp(path.join(tmpdir(), 'dsr-split-'));
    notices = [];
    events = [];
    // Record when each capture starts and stops, to check the handover overlaps.
    vi.mocked(media.captureAudio).mockImplementation((options) => {
      const name = path.basename(options.output);
      events.push(`start ${name}`);
      let finish = (): void => undefined;
      const done = new Promise<void>((resolve) => {
        finish = resolve;
      });
      return {
        done,
        stop: () => {
          events.push(`stop ${name}`);
          finish();
          return done;
        },
      } as ReturnType<typeof media.captureAudio>;
    });
    sessions = new SessionManager({
      restartGraceMs: 60_000,
      setTimer: () => () => undefined,
      onSessionStart: (session) => {
        controller.sessionStarted(session);
      },
      onTargetChange: (change, session) => {
        controller.targetChanged(change, session);
      },
      onSessionEnd: (session) => {
        controller.sessionEnded(session);
      },
    });
    controller = new RecordingController({
      page: {} as Page,
      sessions,
      config: {
        recordingsDir: dir,
        pulseSource: 'test',
        streamVolume: 85,
        handoverSilenceSeconds: 45,
        silenceAlertSeconds: 300,
      },
      notify: (_channel, content) => notices.push(content),
      postProcess: () => Promise.resolve(),
      logger: quietLogger,
      waitForCapture: () => {
        events.push('new capture recording');
        return Promise.resolve();
      },
    });
    sessions.start(info, [DJ]);
    await controller.idle();
  });

  afterEach(async () => {
    vi.mocked(media.captureAudio).mockReset();
    await rm(dir, { recursive: true, force: true });
  });

  const sets = async () => {
    const [folder] = await sessionDirs(dir);
    const session = await readJsonFile(path.join(dir, folder ?? '', 'session.json'), sessionSchema);
    return session?.sets ?? [];
  };

  it('starts the new set before ending the old one, naming both', async () => {
    expect(controller.split({ name: 'Afterglow', previous: 'Orbit' })).toBeUndefined();
    await controller.idle();

    const [first, second] = await sets();
    expect(first).toMatchObject({ displayName: 'Orbit', nameGiven: true, status: 'processing' });
    // Its start was cut (the DJ was live before recording), but the split didn't cut its end.
    expect(first?.cut).toEqual({ start: true, end: false });
    expect(second).toMatchObject({
      displayName: 'Afterglow',
      nameGiven: true,
      userId: DJ.userId,
      status: 'recording',
      partial: false,
    });
    expect(second?.id).toMatch(/_afterglow$/);
    expect(events).toEqual([
      expect.stringMatching(/^start .*_dj-a\.wav$/),
      expect.stringMatching(/^start .*_afterglow\.wav$/),
      'new capture recording',
      expect.stringMatching(/^stop .*_dj-a\.wav$/),
    ]);
    expect(notices.at(-1)).toBe(
      "✂️ Split: **Orbit**'s set ends here; now recording **Afterglow** on DJ A's stream.",
    );
  });

  it("names the new set after the stream's owner by default", async () => {
    controller.split({});
    await controller.idle();
    const [first, second] = await sets();
    expect(first?.displayName).toBe('DJ A');
    expect(second?.displayName).toBe('DJ A');
    // The owner's own name: nothing given.
    expect(second?.nameGiven).toBeUndefined();
    expect(notices.at(-1)).toBe("✂️ Split: **DJ A**'s set ends here; now recording **DJ A**.");
  });

  it('refuses while nothing is being recorded', async () => {
    sessions.streamEnded(CHANNEL, DJ.userId);
    await controller.idle();
    expect(controller.split({ name: 'X' })).toContain('Nothing is being recorded');
  });

  it('carries on the new set if the stream drops and comes back', async () => {
    controller.split({ name: 'Afterglow' });
    await controller.idle();
    sessions.streamEnded(CHANNEL, DJ.userId);
    await controller.idle();
    sessions.streamStarted(CHANNEL, DJ.userId, DJ.displayName);
    await controller.idle();
    expect(events.at(-1)).toMatch(/^start .*_afterglow\.seg2\.wav$/);
  });
});

describe('RecordingController: /record resume', () => {
  let dir: string;
  let sessions: SessionManager;
  let controller: RecordingController;

  beforeEach(async () => {
    vi.clearAllMocks();
    dir = await mkdtemp(path.join(tmpdir(), 'dsr-resume-'));
    sessions = new SessionManager({
      onSessionStart: (session) => {
        controller.sessionStarted(session);
      },
      onTargetChange: (change, session) => {
        controller.targetChanged(change, session);
      },
      onSessionEnd: (session) => {
        controller.sessionEnded(session);
      },
    });
    controller = new RecordingController({
      page: {} as Page,
      sessions,
      config: {
        recordingsDir: dir,
        pulseSource: 'test',
        streamVolume: 85,
        handoverSilenceSeconds: 45,
        silenceAlertSeconds: 300,
      },
      notify: () => undefined,
      postProcess: () => Promise.resolve(),
      logger: quietLogger,
    });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('records into the earlier session folder, keeping its sets and start', async () => {
    const first = sessions.start(info, [DJ]);
    await controller.idle();
    sessions.stop();
    await controller.idle();
    const [folder] = await sessionDirs(dir);
    const startedAt = first.ok ? first.session.startedAt : new Date();

    const other = { userId: '400000000000000002', displayName: 'DJ B' };
    sessions.start({ ...info, startedAt, resumeDir: folder ?? '' }, [other]);
    await controller.idle();
    expect(await sessionDirs(dir)).toEqual([folder]);
    const reopened = await readJsonFile(
      path.join(dir, folder ?? '', 'session.json'),
      sessionSchema,
    );
    expect(reopened?.endedAt).toBeUndefined();
    expect(reopened?.startedAt).toBe(startedAt.toISOString());
    expect(reopened?.sets.map((set) => set.displayName)).toEqual(['DJ A', 'DJ B']);
  });
});

describe('RecordingController: carrying on after a restart', () => {
  let dir: string;
  let processed: string[];
  let sessions: SessionManager;
  let controller: RecordingController;

  const build = () => {
    sessions = new SessionManager({
      onSessionStart: (session) => {
        controller.sessionStarted(session);
      },
      onTargetChange: (change, session) => {
        controller.targetChanged(change, session);
      },
      onSessionEnd: (session) => {
        controller.sessionEnded(session);
      },
    });
    controller = new RecordingController({
      page: {} as Page,
      sessions,
      config: {
        recordingsDir: dir,
        pulseSource: 'test',
        streamVolume: 85,
        handoverSilenceSeconds: 45,
        silenceAlertSeconds: 300,
      },
      notify: () => undefined,
      postProcess: (_record, setId) => {
        processed.push(setId);
        return Promise.resolve();
      },
      logger: quietLogger,
    });
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    dir = await mkdtemp(path.join(tmpdir(), 'dsr-restart-'));
    processed = [];
    build();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const state = () => readActiveSession(dir);

  it('remembers the active session until /record stop', async () => {
    sessions.start(info, [DJ]);
    await controller.idle();
    const [folder] = await sessionDirs(dir);
    expect(await state()).toMatchObject({ dir: folder });
    sessions.stop();
    await controller.idle();
    expect(await state()).toBeUndefined();
  });

  it('keeps it when shutting down, to resume after the restart', async () => {
    sessions.start(info, [DJ]);
    await controller.idle();
    controller.shuttingDown();
    sessions.stop();
    await controller.idle();
    expect(await state()).toMatchObject({ dir: (await sessionDirs(dir))[0] });
  });

  it('after a crash, ends the interrupted set as partial and levels the unfinished ones', async () => {
    const first = sessions.start(info, [DJ]);
    await controller.idle();
    const [folder] = await sessionDirs(dir);
    const sessionFile = path.join(dir, folder ?? '', 'session.json');
    // A crash: the set stays "recording", its capture file as far as it got.
    const crashed = await readJsonFile(sessionFile, sessionSchema);
    const recording = crashed?.sets[0];
    await writeFile(path.join(dir, folder ?? '', recording?.files.rawAudio ?? ''), 'audio');
    // Plus a set that was being leveled.
    await writeFile(
      sessionFile,
      JSON.stringify({
        ...crashed,
        sets: [
          {
            ...recording,
            id: 'leveling',
            status: 'processing',
            startedAt: recording?.startedAt,
          },
          recording,
        ],
      }),
    );

    build();
    processed = [];
    sessions.start(
      {
        ...info,
        startedAt: first.ok ? first.session.startedAt : new Date(),
        resumeDir: folder ?? '',
        afterRestart: true,
      },
      [],
    );
    await controller.idle();
    const sets = (await readJsonFile(sessionFile, sessionSchema))?.sets ?? [];
    const interrupted = sets.find((set) => set.id === recording?.id);
    expect(interrupted).toMatchObject({ status: 'processing', partial: true });
    expect(interrupted?.endedAt).toBeDefined();
    expect(processed.sort()).toEqual([recording?.id, 'leveling'].sort());
  });
});

describe('RecordingController: resuming right after a stop', () => {
  it("lets the stopped session finish first, so it doesn't end the resumed one", async () => {
    vi.clearAllMocks();
    const dir = await mkdtemp(path.join(tmpdir(), 'dsr-resume-race-'));
    let release = (): void => undefined;
    const leveling = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sessions = new SessionManager({
      onSessionStart: (session) => {
        controller.sessionStarted(session);
      },
      onTargetChange: (change, session) => {
        controller.targetChanged(change, session);
      },
      onSessionEnd: (session) => {
        controller.sessionEnded(session);
      },
    });
    const controller = new RecordingController({
      page: {} as Page,
      sessions,
      config: {
        recordingsDir: dir,
        pulseSource: 'test',
        streamVolume: 85,
        handoverSilenceSeconds: 45,
        silenceAlertSeconds: 300,
      },
      notify: () => undefined,
      // The first set's leveling is still running when the session is resumed.
      postProcess: async (record, setId) => {
        await leveling;
        await record.completeSet(setId, { master: 'leveled/x.flac' });
      },
      logger: quietLogger,
    });
    try {
      const first = sessions.start(info, [DJ]);
      await controller.idle().catch(() => undefined);
      sessions.stop();
      const [folder] = await sessionDirs(dir);
      sessions.start(
        {
          ...info,
          startedAt: first.ok ? first.session.startedAt : new Date(),
          resumeDir: folder ?? '',
        },
        [DJ],
      );
      setTimeout(release, 50);
      await controller.idle();
      const session = await readJsonFile(
        path.join(dir, folder ?? '', 'session.json'),
        sessionSchema,
      );
      expect(session?.endedAt).toBeUndefined();
      expect(session?.sets.map((set) => set.status)).toEqual(['ready', 'recording']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('state.json', () => {
  it('keeps when the session was resumed by itself, for the crash-loop check', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'dsr-state-'));
    try {
      await writeActiveSession(dir, {
        sessionId: 's1',
        dir: 'a',
        resumedAt: '2026-10-25T01:00:00.000Z',
      });
      await writeActiveSession(dir, { sessionId: 's1', dir: 'a' });
      expect((await readActiveSession(dir))?.resumedAt).toBe('2026-10-25T01:00:00.000Z');
      await writeActiveSession(dir, { sessionId: 's2', dir: 'b' });
      expect((await readActiveSession(dir))?.resumedAt).toBeUndefined();
      await writeActiveSession(dir, null);
      expect(await readActiveSession(dir)).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
