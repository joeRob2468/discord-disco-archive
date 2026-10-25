/**
 * Sets an admin adds from a file (docs/design.md, "Uploaded sets"). The audio and an
 * import request go into the session's `uploads/` folder; the recorder adds the set to
 * `session.json` and levels it, so the archive never adds sets itself.
 *
 * Files arrive in pieces (`CHUNK_BYTES`), each its own short request: a proxy's request
 * time limit (Traefik's is 60 s) never cuts a large upload off, and a dropped connection
 * only costs the piece in flight. While it arrives, an upload is two hidden files: its
 * details (`.<id>.pending`) and the audio so far (`.<id>.<ext>.part`). Once complete, the
 * audio is renamed and the import request written, so the recorder only ever sees whole
 * uploads.
 */
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, stat, truncate, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  importRequestSchema,
  SCHEMA_VERSION,
  sessionPaths,
  writeJsonFileAtomic,
  type ImportRequest,
} from '@dsr/core';
import { z } from 'zod';

export class UploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UploadError';
  }
}

/** A piece didn't arrive whole: the connection closed, stalled or ended early. */
export class UploadInterruptedError extends UploadError {
  constructor(message: string) {
    super(message);
    this.name = 'UploadInterruptedError';
  }
}

/** A piece for the wrong place (a retry after the server already had it, or a gap). */
export class UploadOffsetError extends UploadError {
  readonly received: number;

  constructor(received: number) {
    super(`Expected the piece at ${String(received)} bytes.`);
    this.name = 'UploadOffsetError';
    this.received = received;
  }
}

/** The size of each piece the browser sends. */
export const CHUNK_BYTES = 8 * 1024 * 1024;
/** Give up on a piece that sends nothing for this long (the connection silently dropped). */
const IDLE_MS = 60_000;
/** Remove unfinished uploads this old: abandoned, or left by an archive restart. */
const STALE_MS = 24 * 60 * 60 * 1000;

/** Audio (and video) formats ffmpeg reads; the upload keeps its extension. */
export const UPLOAD_EXTENSIONS = [
  'wav',
  'flac',
  'aiff',
  'aif',
  'mp3',
  'm4a',
  'aac',
  'ogg',
  'opus',
  'wma',
  'mp4',
  'mkv',
  'mov',
  'webm',
] as const;

export interface Upload {
  /** The file's original name, for its extension. */
  fileName: string;
  /** Its size in bytes. */
  size: number;
  userId: string;
  displayName: string;
  startedAt: Date;
}

export interface UploadProgress {
  received: number;
  size: number;
  /** True once the whole file is in and the import request written. */
  done: boolean;
}

const UPLOAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const pendingSchema = z.object({ request: importRequestSchema, size: z.number().int().min(1) });

/** Uploads receiving a piece right now, so two requests never append at once. */
const busy = new Set<string>();

function uploadsDirOf(recordingsDir: string, sessionDir: string): string {
  const root = path.resolve(recordingsDir);
  if (path.dirname(path.resolve(root, sessionDir)) !== root || sessionDir.startsWith('.')) {
    throw new UploadError(`Not a session folder: ${sessionDir}`);
  }
  return sessionPaths(recordingsDir, sessionDir).uploadsDir;
}

const pendingFile = (dir: string, id: string): string => path.join(dir, `.${id}.pending`);
const partFile = (dir: string, request: ImportRequest): string =>
  path.join(dir, `.${request.file}.part`);

/**
 * Check an upload's details and set it up to receive pieces. Throws `UploadError` for a
 * bad request, before anything is written. Returns its ID.
 */
export async function startUpload(
  recordingsDir: string,
  sessionDir: string,
  upload: Upload,
): Promise<string> {
  const ext = path.extname(upload.fileName).slice(1).toLowerCase();
  if (!(UPLOAD_EXTENSIONS as readonly string[]).includes(ext)) {
    throw new UploadError(
      `Can't use a .${ext || '?'} file. Upload ${UPLOAD_EXTENSIONS.join(', ')}.`,
    );
  }
  if (!Number.isSafeInteger(upload.size) || upload.size < 1) {
    throw new UploadError('The file is empty.');
  }
  const id = randomUUID();
  const parsed = importRequestSchema.safeParse({
    schemaVersion: SCHEMA_VERSION,
    file: `${id}.${ext}`,
    userId: upload.userId,
    displayName: upload.displayName.trim(),
    startedAt: Number.isNaN(upload.startedAt.getTime()) ? '' : upload.startedAt.toISOString(),
  } satisfies ImportRequest);
  if (!parsed.success) throw new UploadError('Pick a DJ, a name and a start time.');

  const dir = uploadsDirOf(recordingsDir, sessionDir);
  await mkdir(dir, { recursive: true });
  await removeStale(dir);
  await writeFile(partFile(dir, parsed.data), '');
  await writeJsonFileAtomic(pendingFile(dir, id), { request: parsed.data, size: upload.size });
  return id;
}

/** How much of an unfinished upload has arrived; undefined if there's no such upload. */
export async function uploadProgress(
  recordingsDir: string,
  sessionDir: string,
  id: string,
): Promise<UploadProgress | undefined> {
  const dir = uploadsDirOf(recordingsDir, sessionDir);
  const pending = await readPending(dir, id);
  if (!pending) return undefined;
  const received = (await stat(partFile(dir, pending.request))).size;
  return { received, size: pending.size, done: false };
}

/**
 * Append the piece at `offset` (`bytes` long, as the client announced). Throws
 * `UploadOffsetError` if `offset` isn't where the upload stands, and
 * `UploadInterruptedError` (after cutting the partial piece back off) if it doesn't
 * arrive whole. The last piece completes the upload.
 */
export async function receiveChunk(
  recordingsDir: string,
  sessionDir: string,
  id: string,
  offset: number,
  bytes: number | undefined,
  body: ReadableStream<Uint8Array>,
): Promise<UploadProgress> {
  const dir = uploadsDirOf(recordingsDir, sessionDir);
  const pending = await readPending(dir, id);
  if (!pending) throw new UploadError('No such upload. Start it again.');
  const key = `${sessionDir}/${id}`;
  if (busy.has(key)) throw new UploadError('A piece of this upload is already arriving.');
  busy.add(key);
  try {
    const part = partFile(dir, pending.request);
    const before = (await stat(part)).size;
    if (offset !== before) throw new UploadOffsetError(before);
    if (bytes === undefined || bytes < 1 || bytes > CHUNK_BYTES || before + bytes > pending.size) {
      throw new UploadError('Send the file in pieces of at most 8 MB.');
    }
    try {
      const received = await append(body, part);
      if (received !== bytes) {
        throw new UploadInterruptedError(`Received ${String(received)} of ${String(bytes)} bytes.`);
      }
    } catch (error) {
      // Keep only whole pieces, so the next try starts cleanly at `before`.
      await truncate(part, before);
      throw error;
    }
    const received = before + bytes;
    if (received < pending.size) return { received, size: pending.size, done: false };

    await rename(part, path.join(dir, pending.request.file));
    await writeJsonFileAtomic(path.join(dir, `${id}.json`), pending.request);
    await rm(pendingFile(dir, id), { force: true });
    return { received, size: pending.size, done: true };
  } finally {
    busy.delete(key);
  }
}

async function readPending(dir: string, id: string) {
  if (!UPLOAD_ID.test(id)) return undefined;
  try {
    return pendingSchema.parse(JSON.parse(await readFile(pendingFile(dir, id), 'utf8')));
  } catch {
    return undefined;
  }
}

/**
 * Append `body` to `file`. Returns the bytes written; throws `UploadInterruptedError` if
 * the client went away or sent nothing for `IDLE_MS`.
 */
async function append(body: ReadableStream<Uint8Array>, file: string): Promise<number> {
  const idle = new AbortController();
  let timer = setTimeout(() => {
    idle.abort();
  }, IDLE_MS);
  let received = 0;
  const watchdog = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      clearTimeout(timer);
      timer = setTimeout(() => {
        idle.abort();
      }, IDLE_MS);
      received += chunk.length;
      done(null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(body), watchdog, createWriteStream(file, { flags: 'a' }), {
      signal: idle.signal,
    });
    return received;
  } catch (error) {
    if (idle.signal.aborted) {
      throw new UploadInterruptedError(`No data for ${String(IDLE_MS / 1000)} s.`);
    }
    // The client closed the connection (Node reports the request as aborted).
    const code = (error as NodeJS.ErrnoException).code;
    if ((error as Error).message === 'aborted' || code === 'ECONNRESET') {
      throw new UploadInterruptedError(`The connection closed after ${String(received)} bytes.`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** Remove unfinished uploads untouched for `STALE_MS`. */
async function removeStale(dir: string): Promise<void> {
  const now = Date.now();
  for (const name of await readdir(dir)) {
    if (!name.startsWith('.') || !(name.endsWith('.part') || name.endsWith('.pending'))) continue;
    const file = path.join(dir, name);
    const info = await stat(file).catch(() => undefined);
    if (info && now - info.mtimeMs > STALE_MS) await rm(file, { force: true });
  }
}
