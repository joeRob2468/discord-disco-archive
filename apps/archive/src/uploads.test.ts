import { mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  FREE_MARGIN_BYTES,
  receiveChunk,
  startUpload,
  UploadInterruptedError,
  UploadOffsetError,
  uploadProgress,
} from './uploads.ts';

const SESSION = '2026-10-24_disco';
const upload = {
  fileName: 'set.mp3',
  size: 10,
  userId: '400000000000000001',
  displayName: 'Afterglow',
  startedAt: new Date('2026-10-25T01:00:00Z'),
};

/** A body of `text`, then an error if `fail` is given (the client went away). */
function body(text: string, fail?: Error): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      if (fail) controller.error(fail);
      else controller.close();
    },
  });
}

describe('chunked uploads', () => {
  let dir: string;
  const uploads = () => path.join(dir, SESSION, 'uploads');
  const visible = async () => (await readdir(uploads())).filter((name) => !name.startsWith('.'));
  const send = (id: string, offset: number, text: string, fail?: Error) =>
    receiveChunk(dir, SESSION, id, offset, text.length, body(text, fail));

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'dsr-uploads-'));
    await mkdir(path.join(dir, SESSION));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('assembles the pieces, then writes the import request', async () => {
    const id = await startUpload(dir, SESSION, upload);
    expect(await send(id, 0, '01234')).toEqual({ received: 5, size: 10, done: false });
    expect(await visible()).toEqual([]);
    expect(await send(id, 5, '56789')).toEqual({ received: 10, size: 10, done: true });
    expect((await visible()).sort()).toEqual([`${id}.json`, `${id}.mp3`]);
    expect(await readFile(path.join(uploads(), `${id}.mp3`), 'utf8')).toBe('0123456789');
    expect(JSON.parse(await readFile(path.join(uploads(), `${id}.json`), 'utf8'))).toMatchObject({
      file: `${id}.mp3`,
      displayName: 'Afterglow',
    });
    // Nothing of it left in progress.
    expect(await readdir(uploads())).toHaveLength(2);
  });

  it('drops a piece cut off midway, so it can be sent again', async () => {
    const id = await startUpload(dir, SESSION, upload);
    await send(id, 0, '01234');
    await expect(send(id, 5, '567', new Error('aborted'))).rejects.toThrow(UploadInterruptedError);
    expect(await uploadProgress(dir, SESSION, id)).toEqual({ received: 5, size: 10, done: false });
    expect((await send(id, 5, '56789')).done).toBe(true);
    expect(await readFile(path.join(uploads(), `${id}.mp3`), 'utf8')).toBe('0123456789');
  });

  it('drops a piece shorter than announced', async () => {
    const id = await startUpload(dir, SESSION, upload);
    await expect(receiveChunk(dir, SESSION, id, 0, 5, body('012'))).rejects.toThrow(
      'Received 3 of 5 bytes.',
    );
    expect((await uploadProgress(dir, SESSION, id))?.received).toBe(0);
  });

  it('refuses a piece for the wrong place, saying where it stands', async () => {
    const id = await startUpload(dir, SESSION, upload);
    await send(id, 0, '01234');
    // A retry of a piece that did arrive.
    const repeat = await send(id, 0, '01234').catch((error: unknown) => error);
    expect(repeat).toBeInstanceOf(UploadOffsetError);
    expect((repeat as UploadOffsetError).received).toBe(5);
  });

  it('refuses unknown uploads and bad details', async () => {
    await expect(send('00000000-0000-4000-8000-000000000000', 0, 'x')).rejects.toThrow(
      'No such upload',
    );
    await expect(startUpload(dir, SESSION, { ...upload, fileName: 'set.exe' })).rejects.toThrow(
      "Can't use a .exe file",
    );
    await expect(startUpload(dir, SESSION, { ...upload, size: 0 })).rejects.toThrow('empty');
    await expect(startUpload(dir, SESSION, { ...upload, userId: '' })).rejects.toThrow('Pick a DJ');
  });

  it('clears unfinished uploads left for a day', async () => {
    await mkdir(uploads(), { recursive: true });
    const stale = ['.old.mp3.part', '.old.pending'];
    for (const name of [...stale, '.current.mp3.part']) {
      await writeFile(path.join(uploads(), name), 'x');
    }
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    for (const name of stale) await utimes(path.join(uploads(), name), twoDaysAgo, twoDaysAgo);
    await startUpload(dir, SESSION, upload);
    const names = await readdir(uploads());
    expect(names).not.toContain('.old.mp3.part');
    expect(names).not.toContain('.old.pending');
    expect(names).toContain('.current.mp3.part');
  });

  it('refuses an upload the disk has no room for, counting others in progress', async () => {
    await mkdir(path.join(dir, '2026-10-25_later'));
    const free = () => Promise.resolve(FREE_MARGIN_BYTES + 25);
    // Another session's upload with 5 of its 10 bytes in: 5 still to come.
    const other = await startUpload(dir, '2026-10-25_later', upload, free);
    await receiveChunk(dir, '2026-10-25_later', other, 0, 5, body('01234'));
    expect(await startUpload(dir, SESSION, { ...upload, size: 20 }, free)).toMatch(/^[0-9a-f-]+$/);
    // Now 5 + 20 are on their way: one more byte doesn't fit.
    await expect(startUpload(dir, SESSION, { ...upload, size: 1 }, free)).rejects.toThrow(
      'Not enough disk space',
    );
  });
});
