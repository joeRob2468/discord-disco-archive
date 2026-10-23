import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readJsonFile, sessionSchema } from '@dsr/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SessionInfo } from '../session/session-manager.ts';
import { SessionRecord, setlistCsv } from './session-record.ts';

const info: SessionInfo = {
  guildId: '500000000000000001',
  channelId: '300000000000000001',
  channelName: 'Halloween Disco',
  title: undefined,
  startedAt: new Date(2026, 9, 31, 20, 0, 0),
  startedBy: { userId: '400000000000000009', displayName: 'Host' },
};
const dj = { userId: '400000000000000001', displayName: 'DJ Spooky' };

describe('SessionRecord', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'dsr-session-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const readSession = (record: SessionRecord) =>
    readJsonFile(record.paths.sessionFile, sessionSchema);

  it('writes a valid session.json with each set', async () => {
    const record = await SessionRecord.create(dir, info);
    expect(path.basename(record.paths.dir)).toBe('2026-10-31_halloween-disco');

    const { setId, rawAudioPath } = await record.startSet(
      dj,
      new Date(2026, 9, 31, 21, 3, 12),
      true,
    );
    expect(rawAudioPath).toBe(
      path.join(record.paths.dir, 'raw', '2026-10-31T21-03-12_dj-spooky.wav'),
    );
    expect((await readSession(record))?.sets[0]).toMatchObject({ status: 'recording' });

    await record.endSet(setId, new Date(2026, 9, 31, 22, 0, 0), { partial: false });
    expect((await readSession(record))?.sets[0]).toMatchObject({
      status: 'processing',
      partial: true,
      files: { rawAudio: 'raw/2026-10-31T21-03-12_dj-spooky.wav' },
    });
  });

  it('marks a set failed with its error', async () => {
    const record = await SessionRecord.create(dir, info);
    const { setId } = await record.startSet(dj, new Date(), false);
    await record.endSet(setId, new Date(), { partial: true, error: 'ffmpeg exited with 1' });
    expect((await readSession(record))?.sets[0]).toMatchObject({
      status: 'failed',
      partial: true,
      error: 'ffmpeg exited with 1',
    });
  });

  it('records post-processing results and keeps setlist.csv in step', async () => {
    const record = await SessionRecord.create(dir, info);
    const { setId } = await record.startSet(dj, new Date(2026, 9, 31, 21, 0, 0), false);
    // Writes from the controller and the processor may be issued without waiting.
    await Promise.all([
      record.endSet(setId, new Date(2026, 9, 31, 22, 0, 0), { partial: false }),
      record.completeSet(setId, { master: `leveled/${setId}.flac` }),
    ]);
    expect((await readSession(record))?.sets[0]).toMatchObject({
      status: 'ready',
      files: { rawAudio: `raw/${setId}.wav`, master: `leveled/${setId}.flac` },
    });
    const csv = await readFile(record.paths.setlistFile, 'utf8');
    expect(csv.split('\n')[1]).toContain(',DJ Spooky,false,ready,');
  });

  it('never reuses an existing folder', async () => {
    const first = await SessionRecord.create(dir, info);
    const second = await SessionRecord.create(dir, info);
    expect(path.basename(second.paths.dir)).toBe(`${path.basename(first.paths.dir)}-2`);
  });

  it('keeps a suffixed folder when the title did not change', async () => {
    await SessionRecord.create(dir, info);
    const second = await SessionRecord.create(dir, info);
    await second.finish(info, new Date());
    expect((await readdir(dir)).sort()).toEqual([
      '2026-10-31_halloween-disco',
      '2026-10-31_halloween-disco-2',
    ]);
  });

  it('renames the folder when the title changed during the session', async () => {
    const record = await SessionRecord.create(dir, info);
    await record.finish({ ...info, title: 'Spooky Night' }, new Date());
    expect(await readdir(dir)).toEqual(['2026-10-31_spooky-night']);
    expect(await readSession(record)).toMatchObject({ title: 'Spooky Night' });
  });
});

describe('setlistCsv', () => {
  it('quotes fields that need it', () => {
    const csv = setlistCsv([
      {
        id: 'x',
        userId: '400000000000000001',
        displayName: 'DJ "Comma, Inc"',
        startedAt: '2026-10-31T20:00:00.000Z',
        partial: true,
        hidden: false,
        status: 'processing',
        files: { rawAudio: 'raw/x.wav' },
      },
    ]);
    expect(csv).toBe(
      'start,end,user_id,display_name,partial,status,files\n' +
        '2026-10-31T20:00:00.000Z,,400000000000000001,"DJ ""Comma, Inc""",true,processing,raw/x.wav\n',
    );
  });
});
