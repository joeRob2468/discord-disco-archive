import { describe, expect, it } from 'vitest';
import { toMatchQuery } from './search.ts';

describe('toMatchQuery', () => {
  it('turns words into quoted prefix terms', () => {
    expect(toMatchQuery('night owl')).toBe('"night"* "owl"*');
  });

  it('drops FTS syntax so user input cannot break the query', () => {
    expect(toMatchQuery('owl" OR (x*')).toBe('"owl"* "OR"* "x"*');
  });

  it('keeps non-ASCII letters', () => {
    expect(toMatchQuery('café 東京')).toBe('"café"* "東京"*');
  });

  it('returns undefined when there are no words', () => {
    expect(toMatchQuery(' "* ')).toBeUndefined();
  });
});
