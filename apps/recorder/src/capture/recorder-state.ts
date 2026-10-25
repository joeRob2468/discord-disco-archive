/**
 * `state.json` at the recordings root: the session being recorded, so that after a
 * restart mid-session (crash, deploy, reboot) the recorder can carry on with it
 * (docs/design.md, "When things go wrong").
 */
import {
  readJsonFile,
  recorderStateSchema,
  SCHEMA_VERSION,
  statePath,
  writeJsonFileAtomic,
  type RecorderState,
} from '@dsr/core';

export type ActiveSession = NonNullable<RecorderState['activeSession']>;

/** The session recorded when the recorder last stopped, if it didn't end it. */
export async function readActiveSession(recordingsDir: string): Promise<ActiveSession | undefined> {
  const state = await readJsonFile(statePath(recordingsDir), recorderStateSchema);
  return state?.activeSession ?? undefined;
}

/** Record the active session, or none. Keeps `resumedAt` while it's the same session. */
export async function writeActiveSession(
  recordingsDir: string,
  active: ActiveSession | null,
): Promise<void> {
  let next = active;
  if (active && active.resumedAt === undefined) {
    const current = await readActiveSession(recordingsDir).catch(() => undefined);
    if (current?.sessionId === active.sessionId && current.resumedAt !== undefined) {
      next = { ...active, resumedAt: current.resumedAt };
    }
  }
  await writeJsonFileAtomic(statePath(recordingsDir), {
    schemaVersion: SCHEMA_VERSION,
    activeSession: next,
  } satisfies RecorderState);
}
