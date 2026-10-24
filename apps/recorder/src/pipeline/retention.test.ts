import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createLogger, readJsonFile, sessionSchema } from '@dsr/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SessionRecord } from '../capture/session-record.ts';
import type { SessionInfo } from '../session/session-manager.ts';
import { sweepRecordings } from './retention.ts';

const info: SessionInfo = {
  guildId: '500000000000000001',
  channelId: '300000000000000001',
  channelName: 'Disco',
  title: undefined,
  startedAt: new Date(2026, 9, 31, 20, 0, 0),
  startedBy: { userId: '400000000000000009', displayName: 'Host' },
};
const dj = { userId: '400000000000000001', displayName: 'DJ Spooky' };
const HOUR = 3_600_000;
const logger = createLogger('test');

describe('sweepRecordings', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'dsr-retention-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  /** A session with one set, leveled `hoursAgo` hours ago, with every file on disk. */
  async function leveledSession(hoursAgo: number, { ended = true, status = 'ready' } = {}) {
    const record = await SessionRecord.create(dir, info);
    const { setId, rawAudioPath } = await record.startSet(dj, new Date(2026, 9, 31, 21), false);
    await writeFile(rawAudioPath, 'raw-audio');
    await record.endSet(setId, new Date(2026, 9, 31, 22), { partial: false });
    await mkdir(record.paths.leveledDir, { recursive: true });
    const files = { master: 'leveled/a.flac', mp3: 'leveled/a.mp3', m4a: 'leveled/a.m4a' };
    for (const file of Object.values(files))
      await writeFile(path.join(record.paths.dir, file), 'x');
    const leveledAt = new Date(Date.now() - hoursAgo * HOUR);
    await utimes(path.join(record.paths.dir, files.master), leveledAt, leveledAt);
    if (status === 'ready') await record.completeSet(setId, files);
    else await record.failSet(setId, 'boom');
    if (ended) await record.finish(info, new Date(2026, 9, 31, 23));
    return { record, setId };
  }

  const filesOf = async (record: SessionRecord) =>
    (await readJsonFile(record.paths.sessionFile, sessionSchema))?.sets[0]?.files;

  it('deletes raw captures past retention and exports no longer wanted', async () => {
    const { record } = await leveledSession(49);
    const result = await sweepRecordings(
      dir,
      { rawRetentionHours: 48, exportFormats: ['mp3'] },
      logger,
    );
    expect(result).toEqual({ files: 2, bytes: 'raw-audio'.length + 1 });
    expect(await filesOf(record)).toEqual({ master: 'leveled/a.flac', mp3: 'leveled/a.mp3' });
    expect(await readdir(record.paths.rawDir)).toEqual([]);
    expect((await readdir(record.paths.leveledDir)).sort()).toEqual(['a.flac', 'a.mp3']);
  });

  it('keeps raw captures until retention has passed, or forever without it', async () => {
    const { record } = await leveledSession(47);
    const config = { exportFormats: ['mp3', 'm4a'] as const };
    await sweepRecordings(dir, { ...config, rawRetentionHours: 48 }, logger);
    await sweepRecordings(
      dir,
      { ...config, rawRetentionHours: undefined },
      logger,
      Date.now() + 1000 * HOUR,
    );
    expect(await filesOf(record)).toHaveProperty('rawAudio');
  });

  it('leaves failed sets and sessions still recording alone', async () => {
    const failed = await leveledSession(100, { status: 'failed' });
    const live = await leveledSession(100, { ended: false });
    const result = await sweepRecordings(
      dir,
      { rawRetentionHours: 0, exportFormats: ['mp3'] },
      logger,
    );
    expect(result.files).toBe(0);
    expect(await filesOf(failed.record)).toHaveProperty('rawAudio');
    expect(await filesOf(live.record)).toHaveProperty('rawAudio');
  });
});
