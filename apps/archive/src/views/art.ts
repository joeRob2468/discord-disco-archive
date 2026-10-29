/**
 * Artwork: uploaded images where there are any, else a gradient derived from an ID, so
 * a given session, set or DJ always gets the same colours.
 */

import type { SetSummary } from '../catalog/catalog.ts';

export const imageUrl = (name: string): string => `/images/${encodeURIComponent(name)}`;

/** A set's uploaded art: its own, else its album's cover (undefined: use a gradient). */
export const setArt = (set: SetSummary): string | undefined => set.image ?? set.sessionImage;

/** FNV-1a: a small, stable string hash. */
function hash(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Film grain: tiled fractal noise in grey with some transparency, overlay-blended onto the
 * gradient (`.art` and `.grain` in app.css) so it reads less flat and digital.
 */
export const GRAIN = `url("data:image/svg+xml,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'>" +
    "<filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/>" +
    "<feColorMatrix values='1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 0 0 0 0 .45'/></filter>" +
    "<rect width='100%' height='100%' filter='url(#n)'/></svg>",
)}") 0 0 / 160px 160px`;

/** CSS `background` value for `seed`: its gradient under a layer of grain. */
export function gradient(seed: string): string {
  const h = hash(seed);
  const hue = h % 360;
  const second = (hue + 40 + ((h >>> 9) % 100)) % 360;
  const angle = 100 + ((h >>> 17) % 120);
  return `${GRAIN}, linear-gradient(${String(angle)}deg, hsl(${String(hue)} 80% 58%), hsl(${String(second)} 75% 42%))`;
}

const graphemes = new Intl.Segmenter('en', { granularity: 'grapheme' });

/** The first user-perceived character (a whole emoji, not half of a surrogate pair). */
const firstGrapheme = (text: string): string | undefined =>
  graphemes.segment(text)[Symbol.iterator]().next().value?.segment;

/** Up to two initials, or the first character (e.g. an emoji) when there are no letters. */
export function initials(name: string): string {
  const words = name.match(/\p{L}[\p{L}\p{N}]*/gu) ?? [];
  if (words.length === 0) return firstGrapheme(name.trim()) ?? '?';
  return words
    .slice(0, 2)
    .map((word) => firstGrapheme(word)?.toUpperCase() ?? '')
    .join('');
}
