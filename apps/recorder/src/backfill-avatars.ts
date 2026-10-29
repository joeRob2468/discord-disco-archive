/**
 * One-time: give sets recorded before avatars were saved their DJ's avatar URL, so the
 * archive copies them. Sessions still recording are skipped (the running recorder writes
 * those); their sets get one when they're leveled.
 *
 * Usage (in the container):
 *   backfill-avatars.ts
 */
import { readdir } from 'node:fs/promises';
import { createLogger } from '@dsr/core';
import { createAvatarLookup, fillAvatar } from './bot/avatars.ts';
import { SessionRecord } from './capture/session-record.ts';
import { loadConfig } from './config.ts';

const logger = createLogger('recorder:backfill-avatars');
const config = loadConfig();
const { recordingsDir } = config.session;
const lookup = createAvatarLookup(config.discord.botToken, config.discord.guildId);

let filled = 0;
let without = 0;
for (const entry of await readdir(recordingsDir, { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name.startsWith('_')) continue;
  let record: SessionRecord;
  try {
    record = await SessionRecord.open(recordingsDir, entry.name);
  } catch (error) {
    logger.warn({ err: error, dir: entry.name }, 'skipped: no readable session.json');
    continue;
  }
  if (record.session.endedAt === undefined) {
    logger.info({ dir: entry.name }, 'skipped: still recording');
    continue;
  }
  for (const set of record.session.sets) {
    if (set.avatarUrl !== undefined) continue;
    if (await fillAvatar(record, set.id, lookup, logger)) filled++;
    else without++;
  }
}
logger.info({ filled, without }, 'done');
