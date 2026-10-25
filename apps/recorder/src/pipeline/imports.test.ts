import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createLogger, readJsonFile, SCHEMA_VERSION, sessionSchema } from '@dsr/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SessionRecord } from '../capture/session-record.ts';
import type { SessionInfo } from '../session/session-manager.ts';
import { findImports, importSet } from './imports.ts';

const info: SessionInfo = {
  guildId: '500000000000000001',
  channelId: '300000000000000001',
  channelName: 'Disco',
  title: undefined,
  startedAt: new Date(2026, 9, 31, 18, 0, 0),
  startedBy: { userId: '400000000000000009', displayName: 'Host' },
};
const logger = createLogger('test');
logger.level = 'silent';

const request = {
  schemaVersion: SCHEMA_VERSION,
  file: 'upload-1.mp3',
  userId: '400000000000000001',
  displayName: 'Afterglow',
  startedAt: new Date(2026, 9, 31, 20, 0, 0).toISOString(),
};

describe('importing uploaded sets', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'dsr-imports-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  /** A session (finished unless `ended` is false) with one upload waiting in it. */
  async function sessionWithUpload({
    ended = true,
    body = request,
  }: { ended?: boolean; body?: object } = {}) {
    const record = await SessionRecord.create(dir, info);
    if (ended) await record.finish(info, new Date(2026, 9, 31, 23));
    await mkdir(record.paths.uploadsDir, { recursive: true });
    await writeFile(path.join(record.paths.uploadsDir, 'upload-1.mp3'), 'mp3-audio');
    await writeFile(path.join(record.paths.uploadsDir, 'upload-1.json'), JSON.stringify(body));
    return record;
  }

  const sessionSets = async (record: SessionRecord) =>
    (await readJsonFile(record.paths.sessionFile, sessionSchema))?.sets ?? [];

  it('adds the set as processing, moves the audio into raw/ and removes the request', async () => {
    const record = await sessionWithUpload();
    const [pending] = await findImports(dir);
    expect(pending?.sessionDir).toBe(path.basename(record.paths.dir));

    const imported = await importSet(dir, pending ?? { sessionDir: '', requestFile: '' }, logger);
    expect(imported?.setId).toMatch(/_afterglow$/);
    const [set] = await sessionSets(record);
    expect(set).toMatchObject({
      displayName: 'Afterglow',
      nameGiven: true,
      userId: request.userId,
      startedAt: request.startedAt,
      status: 'processing',
      partial: false,
      files: { rawAudio: `raw/${imported?.setId ?? ''}.mp3` },
    });
    expect(set?.endedAt).toBeUndefined();
    expect(await readFile(path.join(record.paths.dir, set?.files.rawAudio ?? ''), 'utf8')).toBe(
      'mp3-audio',
    );
    expect(await readdir(record.paths.uploadsDir)).toEqual([]);
    expect(await findImports(dir)).toEqual([]);
  });

  it('gives the set its end once processing has measured it', async () => {
    const record = await sessionWithUpload();
    const [pending] = await findImports(dir);
    const imported = await importSet(dir, pending ?? { sessionDir: '', requestFile: '' }, logger);
    // Through the import's own record: the one from `sessionWithUpload` is out of date.
    await imported?.record.completeSet(imported.setId, { master: 'leveled/x.flac' }, false, 3600);
    const [set] = await sessionSets(record);
    expect(set).toMatchObject({
      status: 'ready',
      endedAt: new Date(2026, 9, 31, 21, 0, 0).toISOString(),
    });
  });

  it('waits while the session is still recording', async () => {
    const record = await sessionWithUpload({ ended: false });
    const [pending] = await findImports(dir);
    expect(await importSet(dir, pending ?? { sessionDir: '', requestFile: '' }, logger)).toBe(
      undefined,
    );
    expect(await sessionSets(record)).toEqual([]);
    expect(await findImports(dir)).toHaveLength(1);
  });

  it('sets an invalid request aside instead of retrying it', async () => {
    const record = await sessionWithUpload({ body: { ...request, file: '../escape.mp3' } });
    const [pending] = await findImports(dir);
    expect(await importSet(dir, pending ?? { sessionDir: '', requestFile: '' }, logger)).toBe(
      undefined,
    );
    expect(await sessionSets(record)).toEqual([]);
    expect((await readdir(record.paths.uploadsDir)).sort()).toEqual([
      'upload-1.json.invalid',
      'upload-1.mp3',
    ]);
  });

  it('marks the set failed if the audio is missing', async () => {
    const record = await sessionWithUpload();
    await rm(path.join(record.paths.uploadsDir, 'upload-1.mp3'));
    const [pending] = await findImports(dir);
    expect(await importSet(dir, pending ?? { sessionDir: '', requestFile: '' }, logger)).toBe(
      undefined,
    );
    const [set] = await sessionSets(record);
    expect(set).toMatchObject({ status: 'failed', error: 'The uploaded file is missing.' });
  });
});
