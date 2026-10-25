/**
 * Screenshots of the recorder's browser, saved when something goes wrong (a stream that
 * won't open, a stream gone silent) so the cause can be seen afterwards. Only the newest
 * `KEEP` are kept.
 */
import { mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from 'playwright';

const KEEP = 50;

/** `2026-10-24T20-58-39_silent.png`: sorts by time, safe on any filesystem. */
const fileName = (when: Date, reason: string): string =>
  `${when.toISOString().slice(0, 19).replaceAll(':', '-')}_${reason}.png`;

/** Save a screenshot of `page` into `dir`. Returns its path, or throws if it couldn't. */
export async function saveScreenshot(
  page: Page,
  dir: string,
  reason: string,
  when: Date,
): Promise<string> {
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, fileName(when, reason));
  await page.screenshot({ path: file });
  await prune(dir);
  return file;
}

async function prune(dir: string): Promise<void> {
  const shots = (await readdir(dir)).filter((name) => name.endsWith('.png')).sort();
  for (const name of shots.slice(0, -KEEP)) await rm(path.join(dir, name), { force: true });
}
