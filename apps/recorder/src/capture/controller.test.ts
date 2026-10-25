import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createLogger, readJsonFile, sessionSchema } from '@dsr/core';
import type { Page } from 'playwright';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionManager } from '../session/session-manager.ts';
import { RecordingController } from './controller.ts';

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
    const [folder] = await readdir(dir);
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
    const [folder] = await readdir(dir);
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
