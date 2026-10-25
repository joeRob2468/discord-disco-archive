/**
 * Sets an admin adds from a file (docs/design.md, "Uploaded sets"). The audio and an
 * import request go into the session's `uploads/` folder; the recorder adds the set to
 * `session.json` and levels it, so the archive never adds sets itself.
 */
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
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
  const audio = path.join(uploadsDir, request.file);
  // Hidden while it's being written; the recorder only looks at `.json` requests.
  const partial = path.join(uploadsDir, `.${request.file}.part`);
  try {
    await pipeline(Readable.fromWeb(body), createWriteStream(partial));
    if ((await stat(partial)).size === 0) throw new UploadError('The file is empty.');
    await rename(partial, audio);
    await writeJsonFileAtomic(path.join(uploadsDir, `${id}.json`), request);
  } catch (error) {
    await rm(partial, { force: true });
    await rm(audio, { force: true });
    throw error;
  }
  return id;
}
