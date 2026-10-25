/**
 * Permanent deletes on the recordings volume. The archive's only other writes there are
 * uploaded sets (`uploads.ts`).
 * A set's files go and its entry is removed from `session.json`, so a rebuilt database
 * doesn't bring it back; a session goes as its whole folder. Both are refused while the
 * recorder may still be writing (the session hasn't ended, or the set is recording)
 * unless forced, because the recorder would rewrite `session.json` from memory.
 */
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { readJsonFile, sessionPaths, sessionSchema, writeJsonFileAtomic } from '@dsr/core';

export class DeleteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeleteError';
  }
}

/** `<root>/<dir>`, refusing anything that isn't a plain folder name directly under root. */
function sessionFolder(recordingsDir: string, sessionDir: string): string {
  const root = path.resolve(recordingsDir);
  const folder = path.resolve(root, sessionDir);
  if (path.dirname(folder) !== root || sessionDir.startsWith('.')) {
    throw new DeleteError(`Refusing to delete outside the recordings folder: ${sessionDir}`);
  }
  return folder;
}

export async function deleteSetFiles(
  recordingsDir: string,
  sessionDir: string,
  setId: string,
  force: boolean,
): Promise<void> {
  const folder = sessionFolder(recordingsDir, sessionDir);
  const file = sessionPaths(recordingsDir, sessionDir).sessionFile;
  const session = await readJsonFile(file, sessionSchema);
  const set = session?.sets.find((s) => s.id === setId);
  if (!session || !set) {
    // Already gone from disk: forcing just drops it from the catalog.
    if (force) return;
    throw new DeleteError(
      'This set is no longer in its session.json. Tick “Force delete” to remove it from the archive.',
    );
  }
  if (!force && (session.endedAt === undefined || set.status === 'recording')) {
    throw new DeleteError(
      'This session is still recording, so the recorder may write the set back. Stop the recording first, or tick “Force delete”.',
    );
  }

  // Entry first: if a file delete then fails, the set is already out of session.json, so
  // the next sync flags it missing rather than bringing it back.
  await writeJsonFileAtomic(file, {
    ...session,
    sets: session.sets.filter((s) => s.id !== setId),
  });
  for (const relative of Object.values(set.files)) {
    const target = path.resolve(folder, relative);
    // Paths come from session.json; never follow one out of the session folder.
    if (!target.startsWith(folder + path.sep)) continue;
    await rm(target, { force: true });
  }
}

export async function deleteSessionFolder(
  recordingsDir: string,
  sessionDir: string,
  ended: boolean,
  force: boolean,
): Promise<void> {
  if (!ended && !force) {
    throw new DeleteError(
      'This session is still recording. Stop the recording first, or tick “Force delete”.',
    );
  }
  await rm(sessionFolder(recordingsDir, sessionDir), { recursive: true, force: true });
}
