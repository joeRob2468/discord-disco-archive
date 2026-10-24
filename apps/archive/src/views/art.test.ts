import { describe, expect, it } from 'vitest';
import { gradient, initials } from './art.ts';

describe('gradient', () => {
  it('is stable per seed and differs between seeds', () => {
    expect(gradient('session-1')).toBe(gradient('session-1'));
    expect(gradient('session-1')).not.toBe(gradient('session-2'));
    expect(gradient('x')).toMatch(/^linear-gradient\(\d+deg, hsl\(/);
  });
});

describe('initials', () => {
  it('takes the first letters of up to two words', () => {
    expect(initials('Val Mason')).toBe('VM');
    expect(initials('night owl the third')).toBe('NO');
    expect(initials('DJ_Spooky')).toBe('DS');
  });

  it('falls back to the first character for names without letters', () => {
    expect(initials('🎃')).toBe('🎃');
    expect(initials('')).toBe('?');
  });
});
