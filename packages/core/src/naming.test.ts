import { describe, expect, it } from 'vitest';
import { localTimestamp, sessionDirName, setBaseName, slugify } from './naming.ts';

describe('slugify', () => {
  it('lowercases and joins words with dashes', () => {
    expect(slugify('Halloween Disco 2026!', 'x')).toBe('halloween-disco-2026');
  });

  it('strips accents', () => {
    expect(slugify('Café Noir', 'x')).toBe('cafe-noir');
  });

  it('falls back when nothing usable remains', () => {
    expect(slugify('🎧🔥', 'fallback')).toBe('fallback');
  });

  it('truncates without leaving a trailing dash', () => {
    expect(slugify('abc def', 'x', 4)).toBe('abc');
  });
});

describe('names', () => {
  const date = new Date(2026, 10, 14, 21, 3, 12);

  it('builds the session folder name from the local date and label', () => {
    expect(sessionDirName(date, 'Disco Room')).toBe('2026-11-14_disco-room');
  });

  it('builds a filename-safe timestamp', () => {
    expect(localTimestamp(date)).toBe('2026-11-14T21-03-12');
  });

  it('uses the user ID when the display name has no usable characters', () => {
    expect(setBaseName(date, '✨', '123456789012345678')).toBe(
      '2026-11-14T21-03-12_123456789012345678',
    );
  });
});
