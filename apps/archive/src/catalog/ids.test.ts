import { describe, expect, it } from 'vitest';
import { isUuid, setUuid } from './ids.ts';

describe('setUuid', () => {
  it('is a stable version 5 UUID', () => {
    const id = setUuid('session-1', '2026-10-31T21-03-12_dj');
    expect(isUuid(id)).toBe(true);
    expect(id[14]).toBe('5');
    expect('89ab').toContain(id[19]);
    expect(setUuid('session-1', '2026-10-31T21-03-12_dj')).toBe(id);
  });

  it('differs per session and per set', () => {
    expect(setUuid('session-1', 'a')).not.toBe(setUuid('session-2', 'a'));
    expect(setUuid('session-1', 'a')).not.toBe(setUuid('session-1', 'b'));
  });
});
