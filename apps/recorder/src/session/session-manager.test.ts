import { beforeEach, describe, expect, it } from 'vitest';
import { SessionManager, type TargetChange } from './session-manager.ts';

const CHANNEL = '300000000000000001';
const OTHER_CHANNEL = '300000000000000002';
const A = { userId: '400000000000000001', displayName: 'DJ A' };
const B = { userId: '400000000000000002', displayName: 'DJ B' };
const C = { userId: '400000000000000003', displayName: 'DJ C' };

const info = {
  guildId: '500000000000000001',
  channelId: CHANNEL,
  channelName: 'disco',
  title: undefined,
  startedBy: { userId: A.userId, displayName: 'Host' },
};

describe('SessionManager', () => {
  let clock: number;
  let changes: TargetChange[];
  let manager: SessionManager;

  const tick = (seconds = 1) => {
    clock += seconds * 1000;
  };
  const summary = () =>
    changes.map((c) => `${c.from?.displayName ?? '-'} → ${c.to?.displayName ?? '-'} (${c.reason})`);

  beforeEach(() => {
    clock = Date.parse('2026-11-14T20:00:00Z');
    changes = [];
    manager = new SessionManager({
      now: () => new Date(clock),
      onTargetChange: (change) => changes.push(change),
    });
  });

  describe('start', () => {
    it('starts with no target when nobody is live', () => {
      expect(manager.start(info, [])).toMatchObject({ ok: true, alreadyRunning: false });
      expect(manager.status()?.target).toBeUndefined();
    });

    it('targets the first already-live streamer', () => {
      manager.start(info, [A, B]);
      expect(summary()).toEqual(['- → DJ A (already-live)']);
    });

    it('is a no-op in the same channel and refuses another channel', () => {
      manager.start(info, []);
      expect(manager.start(info, [])).toMatchObject({ ok: true, alreadyRunning: true });
      expect(manager.start({ ...info, channelId: OTHER_CHANNEL }, [])).toMatchObject({ ok: false });
    });
  });

  describe('session callbacks', () => {
    it('reports the session start before the first target, and the end after the last', () => {
      const events: string[] = [];
      const withEvents = new SessionManager({
        onSessionStart: () => events.push('start'),
        onTargetChange: (change) => events.push(`target ${change.to?.displayName ?? '-'}`),
        onSessionEnd: (session) => events.push(`end ${session.title ?? '-'}`),
      });
      withEvents.start(info, [A]);
      withEvents.setTitle('Halloween');
      withEvents.stop();
      expect(events).toEqual(['start', 'target DJ A', 'target -', 'end Halloween']);
    });
  });

  describe('handover', () => {
    beforeEach(() => {
      manager.start(info, []);
    });

    it('records the first person to go live', () => {
      manager.streamStarted(CHANNEL, A.userId, A.displayName);
      expect(summary()).toEqual(['- → DJ A (went-live)']);
    });

    it('stays on the current streamer when the next DJ goes live early', () => {
      manager.streamStarted(CHANNEL, A.userId, A.displayName);
      tick();
      manager.streamStarted(CHANNEL, B.userId, B.displayName);
      expect(manager.status()?.target?.userId).toBe(A.userId);
      expect(manager.status()?.live.map((s) => s.displayName)).toEqual(['DJ A', 'DJ B']);
    });

    it('hands over to the earliest live streamer when the current one stops', () => {
      manager.streamStarted(CHANNEL, A.userId, A.displayName);
      tick();
      manager.streamStarted(CHANNEL, C.userId, C.displayName);
      tick();
      manager.streamStarted(CHANNEL, B.userId, B.displayName);
      manager.streamEnded(CHANNEL, A.userId);
      expect(summary().at(-1)).toBe('DJ A → DJ C (stopped-streaming)');
    });

    it('waits with no target when the last streamer stops, then picks up the next', () => {
      manager.streamStarted(CHANNEL, A.userId, A.displayName);
      manager.streamEnded(CHANNEL, A.userId);
      manager.streamStarted(CHANNEL, B.userId, B.displayName);
      expect(summary()).toEqual([
        '- → DJ A (went-live)',
        'DJ A → - (stopped-streaming)',
        '- → DJ B (went-live)',
      ]);
    });

    it('ignores a non-target streamer stopping', () => {
      manager.streamStarted(CHANNEL, A.userId, A.displayName);
      manager.streamStarted(CHANNEL, B.userId, B.displayName);
      manager.streamEnded(CHANNEL, B.userId);
      expect(summary()).toEqual(['- → DJ A (went-live)']);
    });

    it('ignores events from other channels', () => {
      manager.streamStarted(OTHER_CHANNEL, A.userId, A.displayName);
      expect(manager.status()?.live).toEqual([]);
    });

    it('switches on silence only when someone else is live', () => {
      manager.streamStarted(CHANNEL, A.userId, A.displayName);
      expect(manager.targetSilent()).toBeUndefined();
      manager.streamStarted(CHANNEL, B.userId, B.displayName);
      manager.targetSilent();
      expect(summary().at(-1)).toBe('DJ A → DJ B (silence)');
    });
  });

  describe('switchTo', () => {
    beforeEach(() => {
      manager.start(info, []);
      manager.streamStarted(CHANNEL, A.userId, A.displayName);
      manager.streamStarted(CHANNEL, B.userId, B.displayName);
    });

    it('switches to a live streamer and records who asked', () => {
      const result = manager.switchTo(B.userId, 'mod');
      expect(result).toMatchObject({
        ok: true,
        change: { reason: 'requested', requestedBy: 'mod' },
      });
      expect(manager.status()?.target?.userId).toBe(B.userId);
    });

    it('is a no-op for the current target', () => {
      expect(manager.switchTo(A.userId, 'mod')).toEqual({ ok: true, change: undefined });
    });

    it('refuses someone who is not live', () => {
      expect(manager.switchTo(C.userId, 'mod')).toMatchObject({ ok: false });
    });
  });

  describe('stop', () => {
    it('ends the current target and clears state', () => {
      manager.start(info, [A]);
      expect(manager.stop()?.channelId).toBe(CHANNEL);
      expect(summary().at(-1)).toBe('DJ A → - (session-stopped)');
      expect(manager.status()).toBeUndefined();
      expect(manager.stop()).toBeUndefined();
    });
  });
});
