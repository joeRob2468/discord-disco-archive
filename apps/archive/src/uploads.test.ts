import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { saveUpload, UploadInterruptedError } from './uploads.ts';

const SESSION = '2026-10-24_disco';
const upload = {
  fileName: 'set.mp3',
  bytes: undefined as number | undefined,
  userId: '400000000000000001',
  displayName: 'Afterglow',
  startedAt: new Date('2026-10-25T01:00:00Z'),
};

/** A body of `chunks`, then an error if `fail` is given (the client went away). */
function body(chunks: string[], fail?: Error): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      if (fail) controller.error(fail);
      else controller.close();
    },
  });
}

describe('saveUpload', () => {
  let dir: string;
  const uploads = () => path.join(dir, SESSION, 'uploads');

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'dsr-uploads-'));
    await mkdir(path.join(dir, SESSION));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('keeps nothing when the client goes away mid-upload', async () => {
    await expect(
      saveUpload(dir, SESSION, body(['part of a set'], new Error('aborted')), upload),
    ).rejects.toThrow(UploadInterruptedError);
    expect(await readdir(uploads())).toEqual([]);
  });

  it('keeps nothing when the body is shorter than announced', async () => {
    await expect(
      saveUpload(dir, SESSION, body(['12345']), { ...upload, bytes: 10 }),
    ).rejects.toThrow('Received 5 of 10 bytes.');
    expect(await readdir(uploads())).toEqual([]);
  });

  it('clears partial files left by an archive that stopped mid-upload', async () => {
    await mkdir(uploads(), { recursive: true });
    const stale = path.join(uploads(), '.old.mp3.part');
    const fresh = path.join(uploads(), '.current.mp3.part');
    await writeFile(stale, 'x');
    await writeFile(fresh, 'x');
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    await utimes(stale, twoDaysAgo, twoDaysAgo);
    await saveUpload(dir, SESSION, body(['audio']), { ...upload, bytes: 5 });
    const names = await readdir(uploads());
    expect(names).not.toContain('.old.mp3.part');
    expect(names).toContain('.current.mp3.part');
    expect(names.filter((name) => !name.startsWith('.'))).toHaveLength(2);
  });
});
