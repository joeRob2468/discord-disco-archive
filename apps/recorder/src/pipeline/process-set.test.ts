import { describe, expect, it } from 'vitest';
import { settlePartial } from './process-set.ts';

const DURATION = 600;
const quietStart = { start: 12.5, end: DURATION };
const quietEnd = { start: 0, end: 590 };
const soundBothEnds = { start: 0, end: DURATION };

describe('settlePartial', () => {
  it('keeps a cut start partial only if the capture opens with sound', () => {
    const cut = { start: true, end: false };
    expect(settlePartial(cut, soundBothEnds, DURATION)).toBe(true);
    // Live but not playing yet when recording began: the full set is there.
    expect(settlePartial(cut, quietStart, DURATION)).toBe(false);
  });

  it('keeps a cut end partial only if the capture closes with sound', () => {
    const cut = { start: false, end: true };
    expect(settlePartial(cut, soundBothEnds, DURATION)).toBe(true);
    // Stopped after the music ended.
    expect(settlePartial(cut, quietEnd, DURATION)).toBe(false);
  });

  it('is never partial when neither end was cut', () => {
    expect(settlePartial({ start: false, end: false }, soundBothEnds, DURATION)).toBe(false);
  });
});
