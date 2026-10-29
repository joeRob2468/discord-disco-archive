import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createLogger, readJsonFile, sessionSchema } from '@dsr/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SessionRecord } from '../capture/session-record.ts';
import { fillAvatar } from './avatars.ts';

const AVATAR = 'https://cdn.discordapp.com/guilds/1/users/2/avatars/abc.png?size=256';
const logger = createLogger('test');

describe('fillAvatar', () => {
  let dir: string;
  let record: SessionRecord;
  let setId: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'dsr-avatars-'));
    record = await SessionRecord.create(dir, {
      guildId: '500000000000000001',
      channelId: '300000000000000001',
      channelName: 'Disco',
      title: undefined,
      startedAt: new Date(2026, 9, 31, 20),
      startedBy: { userId: '400000000000000009', displayName: 'Host' },
    });
    ({ setId } = await record.startSet(
      { userId: '400000000000000001', displayName: 'DJ' },
      new Date(2026, 9, 31, 21),
      false,
    ));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const saved = async () =>
    (await readJsonFile(record.paths.sessionFile, sessionSchema))?.sets[0]?.avatarUrl;

  it("saves the DJ's avatar, and keeps the first one", async () => {
    expect(await fillAvatar(record, setId, () => Promise.resolve(AVATAR), logger)).toBe(true);
    expect(await saved()).toBe(AVATAR);
    expect(await fillAvatar(record, setId, () => Promise.resolve(`${AVATAR}&new`), logger)).toBe(
      false,
    );
    expect(await saved()).toBe(AVATAR);
  });

  it('leaves the set alone without an avatar, or when the lookup fails', async () => {
    expect(await fillAvatar(record, setId, () => Promise.resolve(undefined), logger)).toBe(false);
    expect(
      await fillAvatar(record, setId, () => Promise.reject(new Error('rate limited')), logger),
    ).toBe(false);
    expect(await saved()).toBeUndefined();
  });
});
