/**
 * File and folder naming. Names are derived from human input (titles, display names),
 * so everything goes through `slugify` to stay filesystem- and URL-safe.
 */

const COMBINING_MARKS = /[̀-ͯ]/g;

/**
 * Lowercase ASCII slug of `a-z0-9-`. Returns `fallback` when nothing usable is left,
 * e.g. for a display name made only of emoji.
 */
export function slugify(input: string, fallback: string, maxLength = 60): string {
  const slug = input
    .normalize('NFKD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/, '');
  return slug === '' ? fallback : slug;
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** `YYYY-MM-DD` in the process time zone (set `TZ`). */
export function localDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** `YYYY-MM-DDTHH-mm-ss` in the process time zone; colons are not filename-safe everywhere. */
export function localTimestamp(date: Date): string {
  return `${localDate(date)}T${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

/** Session folder: `<date>_<title or channel name>`. */
export function sessionDirName(startedAt: Date, label: string): string {
  return `${localDate(startedAt)}_${slugify(label, 'session')}`;
}

/** Base file name (no extension) for one set: `<timestamp>_<display name>`. */
export function setBaseName(startedAt: Date, displayName: string, userId: string): string {
  return `${localTimestamp(startedAt)}_${slugify(displayName, userId)}`;
}
