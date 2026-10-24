/** Display formatting. Dates render in the server time zone (`TZ`), like folder names. */

const dateFormat = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' });
const dateTimeFormat = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export const formatDate = (iso: string): string => dateFormat.format(new Date(iso));

export const formatDateTime = (iso: string): string => dateTimeFormat.format(new Date(iso));

/** `1:02:03` or `4:05`. */
export function formatDuration(seconds: number | undefined): string {
  if (seconds === undefined || seconds < 0) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const mm = String(m).padStart(h > 0 ? 2 : 1, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** `1.4 GB`, `320 MB`, `12 kB` (decimal units, like file managers). */
export function formatBytes(bytes: number): string {
  const units = ['B', 'kB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 || value >= 100 ? 0 : 1)} ${units[unit] ?? 'B'}`;
}

/** `12.5 h` for long totals, else `1:02:03`. */
export const formatHours = (seconds: number): string =>
  seconds >= 36_000 ? `${(seconds / 3600).toFixed(1)} h` : formatDuration(seconds) || '0:00';
