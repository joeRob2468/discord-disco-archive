/**
 * Sets uploaded through the archive (docs/design.md, "Uploaded sets"). The archive saves
 * the audio and an import request (`uploads/<id>.json`, `@dsr/core`'s
 * `importRequestSchema`) in a finished session's folder; the recorder adds the set to
 * `session.json` and levels it like a recorded one, so it stays the only writer of new
 * sets. Requests for a session that hasn't ended wait until it has.
 */
import { readdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import {
  importRequestSchema,
  readJsonFile,
  SESSION_FILE,
  UPLOADS_DIR,
  type ImportRequest,
  type Logger,
} from '@dsr/core';
import { SessionRecord } from '../capture/session-record.ts';

export interface PendingImport {
  /** Session folder name, relative to the recordings root. */
  sessionDir: string;
  /** The request file's absolute path. */
  requestFile: string;
}

/** Every import request waiting in any session's `uploads/` folder. */
export async function findImports(recordingsDir: string): Promise<PendingImport[]> {
  const pending: PendingImport[] = [];
  let entries;
  try {
    entries = await readdir(recordingsDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return pending;
    throw error;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name.startsWith('_')) continue;
    const uploads = path.join(recordingsDir, entry.name, UPLOADS_DIR);
    const names = await readdir(uploads).catch(() => []);
    // Hidden files are uploads still arriving.
    const requests = names.filter((name) => name.endsWith('.json') && !name.startsWith('.'));
    for (const name of requests.sort()) {
      pending.push({ sessionDir: entry.name, requestFile: path.join(uploads, name) });
    }
  }
  return pending;
}

/** Set a request aside as `.invalid` so it isn't retried, and say why. */
async function reject(pending: PendingImport, reason: string, logger: Logger): Promise<void> {
  logger.error({ request: pending.requestFile, reason }, 'import request rejected');
  await rename(pending.requestFile, `${pending.requestFile}.invalid`).catch(() => undefined);
}

/**
 * Add the requested set to its session: move the audio into `raw/`, add the set as
 * `processing`, and remove the request. Returns the session and the new set's ID for
 * post-processing, or undefined if there's nothing to process now.
 */
export async function importSet(
  recordingsDir: string,
  pending: PendingImport,
  logger: Logger,
): Promise<{ record: SessionRecord; setId: string } | undefined> {
  let request: ImportRequest | undefined;
  try {
    request = await readJsonFile(pending.requestFile, importRequestSchema);
  } catch (error) {
    await reject(pending, error instanceof Error ? error.message : String(error), logger);
    return undefined;
  }
  // Removed meanwhile (e.g. by an admin).
  if (!request) return undefined;

  let record: SessionRecord;
  try {
    record = await SessionRecord.open(recordingsDir, pending.sessionDir);
  } catch {
    await reject(pending, `no readable ${SESSION_FILE}`, logger);
    return undefined;
  }
  // The controller holds a recording session's session.json and would write over the set.
  if (record.session.endedAt === undefined) return undefined;

  const audio = path.join(path.dirname(pending.requestFile), request.file);
  const ext = path.extname(request.file).toLowerCase();
  const { setId, rawAudioPath } = await record.addImportedSet(
    request,
    new Date(request.startedAt),
    ext,
  );
  try {
    await rename(audio, rawAudioPath);
  } catch (error) {
    await record.failSet(setId, 'The uploaded file is missing.');
    await reject(pending, `can't move ${request.file}: ${String(error)}`, logger);
    return undefined;
  }
  await rm(pending.requestFile, { force: true });
  logger.info(
    { setId, dir: pending.sessionDir, displayName: request.displayName },
    'imported uploaded set',
  );
  return { record, setId };
}
