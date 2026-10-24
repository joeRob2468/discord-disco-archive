/** Test helpers: a temporary recordings volume with session.json files and media. */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SCHEMA_VERSION, writeJsonFileAtomic, type Session, type StreamSet } from '@dsr/core';

export const GUILD = '100000000000000001';
export const CHANNEL = '100000000000000002';
export const DJ_A = '200000000000000001';
export const DJ_B = '200000000000000002';

/** The start of a PNG file: enough for type detection. */
export const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);

export function makeSet(
  overrides: Partial<StreamSet> & Pick<StreamSet, 'id' | 'userId'>,
): StreamSet {
  return {
    displayName: 'DJ',
    startedAt: '2026-11-14T21:00:00.000Z',
    endedAt: '2026-11-14T22:00:00.000Z',
    partial: false,
    hidden: false,
    status: 'ready',
    files: {
      master: `leveled/${overrides.id}.flac`,
      mp3: `leveled/${overrides.id}.mp3`,
      m4a: `leveled/${overrides.id}.m4a`,
    },
    ...overrides,
  };
}

export function makeSession(overrides: Partial<Session> & Pick<Session, 'id' | 'sets'>): Session {
  return {
    schemaVersion: SCHEMA_VERSION,
    guildId: GUILD,
    channelId: CHANNEL,
    channelName: 'disco-room',
    startedAt: '2026-11-14T20:00:00.000Z',
    endedAt: '2026-11-15T01:00:00.000Z',
    startedBy: { userId: DJ_A, displayName: 'Host' },
    ...overrides,
  };
}

export interface RecordingsFixture {
  dir: string;
  write(dirName: string, session: Session, withMedia?: boolean): Promise<void>;
  remove(dirName: string): Promise<void>;
  cleanup(): Promise<void>;
}

export async function createRecordings(): Promise<RecordingsFixture> {
  const dir = await mkdtemp(path.join(tmpdir(), 'dsr-archive-'));
  return {
    dir,
    async write(dirName, session, withMedia = false) {
      const sessionDir = path.join(dir, dirName);
      await writeJsonFileAtomic(path.join(sessionDir, 'session.json'), session);
      if (!withMedia) return;
      for (const set of session.sets) {
        for (const file of Object.values(set.files)) {
          const target = path.join(sessionDir, file);
          await mkdir(path.dirname(target), { recursive: true });
          await writeFile(target, `media:${file}`);
        }
      }
    },
    async remove(dirName) {
      await rm(path.join(dir, dirName), { recursive: true, force: true });
    },
    async cleanup() {
      await rm(dir, { recursive: true, force: true });
    },
  };
}

/** Two sessions, three sets, two DJs. */
export async function standardFixture(recordings: RecordingsFixture): Promise<void> {
  await recordings.write(
    '2026-11-14_halloween-disco',
    makeSession({
      id: 'session-1',
      title: 'Halloween Disco',
      sets: [
        makeSet({ id: 'set-1', userId: DJ_A, displayName: 'Night Owl' }),
        makeSet({
          id: 'set-2',
          userId: DJ_B,
          displayName: 'Café Sunrise',
          startedAt: '2026-11-14T22:05:00.000Z',
          endedAt: '2026-11-14T23:35:30.000Z',
        }),
      ],
    }),
    true,
  );
  await recordings.write(
    '2026-11-21_disco-room',
    makeSession({
      id: 'session-2',
      startedAt: '2026-11-21T20:00:00.000Z',
      sets: [
        makeSet({
          id: 'set-3',
          userId: DJ_A,
          displayName: 'Night Owl II',
          startedAt: '2026-11-21T21:00:00.000Z',
          endedAt: '2026-11-21T22:00:00.000Z',
        }),
      ],
    }),
    true,
  );
}
