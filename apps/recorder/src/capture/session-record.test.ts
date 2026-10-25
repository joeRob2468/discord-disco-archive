import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readJsonFile, sessionSchema } from '@dsr/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SessionInfo } from '../session/session-manager.ts';
import { findSessions, SessionRecord, setlistCsv } from './session-record.ts';

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
      cut: { start: true, end: false },
      files: { rawAudio: 'raw/2026-10-31T21-03-12_dj-spooky.wav' },
    });
  });

  it("keeps other writers' changes instead of saving an old copy over them", async () => {
    const record = await SessionRecord.create(dir, info);
    const { setId } = await record.startSet(dj, new Date(2026, 9, 31, 21), false);
    // Another process (an import, here) adds a set behind this record's back.
    const other = await SessionRecord.open(dir, path.basename(record.paths.dir));
    await other.addImportedSet(
      { userId: dj.userId, displayName: 'Afterglow' },
      new Date(2026, 9, 31, 22),
      '.mp3',
    );
    await record.endSet(setId, new Date(2026, 9, 31, 22), { partial: false });
    expect((await readSession(record))?.sets.map((set) => set.displayName)).toEqual([
      'DJ Spooky',
      'Afterglow',
    ]);
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

  it('reopens a finished session to record more sets into it (/record resume)', async () => {
    const first = await SessionRecord.create(dir, info);
    const second = await SessionRecord.create(dir, info);
    const name = path.basename(second.paths.dir);
    expect(name).toMatch(/-2$/);
    const { setId } = await second.startSet(dj, new Date(2026, 9, 31, 21), false);
    await second.endSet(setId, new Date(2026, 9, 31, 22), { partial: false });
    await second.finish(info, new Date(2026, 9, 31, 22, 30));

    const reopened = await SessionRecord.reopen(dir, name);
    expect((await readSession(reopened))?.endedAt).toBeUndefined();
    await reopened.startSet(
      { userId: dj.userId, displayName: 'DJ Later' },
      new Date(2026, 9, 31, 23),
      false,
    );
    await reopened.finish(info, new Date(2026, 10, 1, 0, 30));
    // Same folder (its -2 suffix kept: the title didn't change), both sets, ended again.
    expect(path.basename(reopened.paths.dir)).toBe(name);
    const session = await readSession(reopened);
    expect(session?.sets.map((set) => set.displayName)).toEqual(['DJ Spooky', 'DJ Later']);
    expect(session?.endedAt).toBe(new Date(2026, 10, 1, 0, 30).toISOString());
    expect((await readSession(first))?.sets).toEqual([]);
  });

  it("lists a channel's sessions, newest first", async () => {
    await SessionRecord.create(dir, info);
    await SessionRecord.create(dir, { ...info, startedAt: new Date(2026, 10, 7, 20) });
    await SessionRecord.create(dir, { ...info, channelId: '300000000000000002' });
    const found = await findSessions(dir, info.channelId);
    expect(found.map((session) => session.startedAt)).toEqual([
      new Date(2026, 10, 7, 20),
      new Date(2026, 9, 31, 20),
    ]);
    expect(found[0]).toMatchObject({ ended: false, sets: 0, channelName: 'Halloween Disco' });
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
