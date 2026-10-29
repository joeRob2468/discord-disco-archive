import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createLogger } from '@dsr/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { copyAvatars } from './avatars.ts';
import { Catalog } from './catalog/catalog.ts';
import { syncCatalog } from './catalog/sync.ts';
import { openMemoryDatabase, type Db } from './db/database.ts';
import {
  createRecordings,
  DJ_A,
  DJ_B,
  makeSession,
  makeSet,
  PNG,
  type RecordingsFixture,
} from './test/fixtures.ts';

const logger = createLogger('test');
const AVATAR_A = 'https://cdn.discordapp.com/guilds/1/users/2/avatars/aaa.png?size=256';

describe('copyAvatars', () => {
  let recordings: RecordingsFixture;
  let db: Db;
  let catalog: Catalog;
  let images: string;
  let fetched: string[];

  /** Answers like Discord's CDN: `body` (a PNG by default) or a status. */
  const cdn =
    (answer: Uint8Array | number = PNG): typeof fetch =>
    (input) => {
      fetched.push(
        input instanceof URL ? input.href : typeof input === 'string' ? input : input.url,
      );
      return Promise.resolve(
        typeof answer === 'number'
          ? new Response(null, { status: answer })
          : new Response(answer, { headers: { 'content-type': 'image/png' } }),
      );
    };

  const record = async (avatars: Record<string, string>) => {
    await recordings.write(
      '2026-11-14_disco',
      makeSession({
        id: 'session-1',
        sets: [
          makeSet({ id: 'set-1', userId: DJ_A, avatarUrl: avatars[DJ_A] }),
          makeSet({ id: 'set-2', userId: DJ_B, avatarUrl: avatars[DJ_B] }),
        ],
      }),
      true,
    );
    await syncCatalog(db, recordings.dir);
  };
  const avatarOf = (userId: string) =>
    catalog.listStreamers(false).find((s) => s.userId === userId)?.avatarImage;

  beforeEach(async () => {
    recordings = await createRecordings();
    db = openMemoryDatabase();
    catalog = new Catalog(db);
    images = await mkdtemp(path.join(tmpdir(), 'dsr-avatars-'));
    fetched = [];
  });
  afterEach(async () => {
    db.close();
    await recordings.cleanup();
    await rm(images, { recursive: true, force: true });
  });

  it('copies each avatar once and keeps the first', async () => {
    await record({ [DJ_A]: AVATAR_A });
    await copyAvatars(catalog, images, logger, cdn());
    const copied = avatarOf(DJ_A);
    expect(copied).toMatch(/^[0-9a-f]{32}\.png$/);
    expect(await readdir(images)).toEqual([copied]);
    expect(catalog.getSet('set-1', false)?.streamerImage).toBe(copied);

    // A new avatar later on doesn't replace it.
    await record({ [DJ_A]: `${AVATAR_A}&v=2` });
    await copyAvatars(catalog, images, logger, cdn());
    expect(fetched).toEqual([AVATAR_A]);
    expect(avatarOf(DJ_A)).toBe(copied);
  });

  it('tries a failed avatar again only for a new URL', async () => {
    await record({ [DJ_A]: AVATAR_A });
    await copyAvatars(catalog, images, logger, cdn(404));
    await copyAvatars(catalog, images, logger, cdn());
    expect(fetched).toHaveLength(1);
    expect(avatarOf(DJ_A)).toBeUndefined();

    await record({ [DJ_A]: `${AVATAR_A}&v=2` });
    await copyAvatars(catalog, images, logger, cdn());
    expect(avatarOf(DJ_A)).toBeDefined();
  });

  it('fetches only from Discord, and stores only images', async () => {
    await record({ [DJ_A]: 'https://example.com/avatar.png', [DJ_B]: AVATAR_A });
    await copyAvatars(catalog, images, logger, cdn(new TextEncoder().encode('<html>')));
    expect(fetched).toEqual([AVATAR_A]);
    expect(avatarOf(DJ_A)).toBeUndefined();
    expect(avatarOf(DJ_B)).toBeUndefined();
    expect(await readdir(images).catch(() => [])).toEqual([]);
  });

  it("shows an admin's picture ahead of the avatar, and keeps the avatar's file", async () => {
    await record({ [DJ_A]: AVATAR_A });
    await copyAvatars(catalog, images, logger, cdn());
    const avatar = avatarOf(DJ_A) ?? '';
    catalog.setImage('streamer', DJ_A, 'f'.repeat(32) + '.png', 'admin');
    expect(catalog.getSet('set-1', false)?.streamerImage).toBe('f'.repeat(32) + '.png');
    // The same bytes uploaded as a picture, then removed: the avatar still uses the file.
    catalog.setImage('streamer', DJ_A, avatar, 'admin');
    catalog.setImage('streamer', DJ_A, undefined, 'admin');
    expect(catalog.imageInUse(avatar)).toBe(true);
    expect(catalog.getSet('set-1', false)?.streamerImage).toBe(avatar);
  });
});
