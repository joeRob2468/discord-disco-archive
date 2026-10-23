import { describe, expect, it } from 'vitest';
import { formatElapsed, status, switched, targetChanged } from './messages.ts';

const at = (iso: string) => new Date(iso);
const A = { userId: '1', displayName: 'DJ A', since: at('2026-11-14T20:00:00Z') };
const B = { userId: '2', displayName: 'DJ B', since: at('2026-11-14T20:30:00Z') };

describe('messages', () => {
  it('formats elapsed time', () => {
    expect(formatElapsed(0, 3_720_000)).toBe('1h02m');
    expect(formatElapsed(0, 59_000)).toBe('0m');
    expect(formatElapsed(0, 240_000)).toBe('4m');
  });

  it('explains each kind of switch', () => {
    expect(switched({ from: A, to: B, reason: 'stopped-streaming' })).toBe(
      '🔀 Switched from **DJ A** to **DJ B**: DJ A stopped streaming.',
    );
    expect(switched({ from: A, to: B, reason: 'requested', requestedBy: '9' })).toBe(
      '🔀 Switched from **DJ A** to **DJ B**: requested by <@9>.',
    );
    expect(switched({ from: A, to: B, reason: 'silence' })).toContain('went silent');
  });

  it('announces every new recording, and idling, but not session start/stop', () => {
    expect(targetChanged({ from: undefined, to: A, reason: 'went-live' })).toBe(
      '🔴 Now recording **DJ A**.',
    );
    expect(targetChanged({ from: A, to: B, reason: 'silence' })).toContain('🔀 Switched');
    expect(targetChanged({ from: A, to: undefined, reason: 'stopped-streaming' })).toBe(
      '⏸️ **DJ A** stopped streaming. Waiting for the next stream.',
    );
    expect(targetChanged({ from: undefined, to: A, reason: 'already-live' })).toBeUndefined();
    expect(targetChanged({ from: A, to: undefined, reason: 'session-stopped' })).toBeUndefined();
  });

  it('lists the target and other live streams in the status', () => {
    const text = status(
      {
        session: {
          guildId: 'g',
          channelId: 'c',
          channelName: 'disco',
          title: 'Halloween',
          startedAt: at('2026-11-14T19:00:00Z'),
          startedBy: { userId: '9', displayName: 'Host' },
        },
        target: A,
        live: [A, B],
      },
      at('2026-11-14T21:05:00Z'),
    );
    expect(text).toContain('**Halloween** for 2h05m');
    expect(text).toContain('🎧 Recording: **DJ A**');
    expect(text).toContain('📡 Also live: **DJ B**');
  });
});
