/**
 * Sets an admin adds from a file (docs/design.md, "Uploaded sets"). The audio and an
 * import request go into the session's `uploads/` folder; the recorder adds the set to
 * `session.json` and levels it, so the archive never adds sets itself.
 */
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
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

export class UploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UploadError';
  }
}

/** The upload didn't arrive whole: the connection closed, stalled or ended early. */
export class UploadInterruptedError extends UploadError {
  constructor(message: string) {
    super(message);
    this.name = 'UploadInterruptedError';
  }
}

/** Give up on an upload that sends nothing for this long (the connection silently dropped). */
const IDLE_MS = 60_000;
/** Remove partial files this old: left by an archive that stopped mid-upload. */
const STALE_PART_MS = 24 * 60 * 60 * 1000;

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
  /** The size the client announced (`Content-Length`), to catch a body that ends early. */
  bytes: number | undefined;
  userId: string;
  displayName: string;
  startedAt: Date;
}

/**
 * Stream `body` into the session's `uploads/` folder and write its import request.
 * Throws `UploadError` for a bad request, before anything is written.
 */
export async function saveUpload(
  recordingsDir: string,
  sessionDir: string,
  body: ReadableStream<Uint8Array>,
  upload: Upload,
): Promise<string> {
  const ext = path.extname(upload.fileName).slice(1).toLowerCase();
  if (!(UPLOAD_EXTENSIONS as readonly string[]).includes(ext)) {
    throw new UploadError(
      `Can't use a .${ext || '?'} file. Upload ${UPLOAD_EXTENSIONS.join(', ')}.`,
    );
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
  const request = parsed.data;

  const root = path.resolve(recordingsDir);
  if (path.dirname(path.resolve(root, sessionDir)) !== root || sessionDir.startsWith('.')) {
    throw new UploadError(`Not a session folder: ${sessionDir}`);
  }
  const { uploadsDir } = sessionPaths(recordingsDir, sessionDir);
  await mkdir(uploadsDir, { recursive: true });
  await removeStaleParts(uploadsDir);
  const audio = path.join(uploadsDir, request.file);
  // Hidden while it's being written; the recorder only looks at `.json` requests.
  const partial = path.join(uploadsDir, `.${request.file}.part`);
  try {
    const received = await receive(body, partial);
    if (upload.bytes !== undefined && received !== upload.bytes) {
      throw new UploadInterruptedError(
        `Received ${String(received)} of ${String(upload.bytes)} bytes.`,
      );
    }
    if (received === 0) throw new UploadError('The file is empty.');
    await rename(partial, audio);
    await writeJsonFileAtomic(path.join(uploadsDir, `${id}.json`), request);
  } catch (error) {
    await rm(partial, { force: true });
    await rm(audio, { force: true });
    throw error;
  }
  return id;
}

/**
 * Write `body` to `file`. Returns the bytes written; throws `UploadInterruptedError` if
 * the client went away or sent nothing for `IDLE_MS`.
 */
async function receive(body: ReadableStream<Uint8Array>, file: string): Promise<number> {
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
    await pipeline(Readable.fromWeb(body), watchdog, createWriteStream(file), {
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

async function removeStaleParts(uploadsDir: string): Promise<void> {
  const now = Date.now();
  for (const name of await readdir(uploadsDir)) {
    if (!name.endsWith('.part')) continue;
    const file = path.join(uploadsDir, name);
    const info = await stat(file).catch(() => undefined);
    if (info && now - info.mtimeMs > STALE_PART_MS) await rm(file, { force: true });
  }
}
