import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.ts';
import { Catalog } from './catalog/catalog.ts';
import { syncCatalog } from './catalog/sync.ts';
import { loadConfig } from './config.ts';
import { openMemoryDatabase, type Db } from './db/database.ts';
import {
  createRecordings,
  DJ_A,
  PNG,
  makeSession,
  makeSet,
  standardFixture,
  type RecordingsFixture,
} from './test/fixtures.ts';
import { setUuid } from './catalog/ids.ts';

const setPage = (sessionId: string, setId: string): string =>
  `/sessions/${sessionId}/sets/${setUuid(sessionId, setId)}`;

const ORIGIN = 'http://localhost:3000';
const SECRET = 'x'.repeat(32);
const ADMIN_PASSWORD = 'admin-password-123';
const VIEWER_PASSWORD = 'viewer-pass';

describe('archive app', () => {
  let recordings: RecordingsFixture;
  let db: Db;

  beforeEach(async () => {
    recordings = await createRecordings();
    await standardFixture(recordings);
    db = openMemoryDatabase();
    await syncCatalog(db, recordings.dir);
  });

  afterEach(async () => {
    db.close();
    await recordings.cleanup();
  });

  const build = (env: Record<string, string> = {}) =>
    createApp({
      config: loadConfig({ RECORDINGS_DIR: recordings.dir, ARCHIVE_PUBLIC_URL: ORIGIN, ...env }),
      catalog: new Catalog(db),
    });

  const post = (path: string, form: Record<string, string>, cookie?: string) =>
    new Request(`${ORIGIN}${path}`, {
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        'Content-Type': 'application/x-www-form-urlencoded',
        ...(cookie && { Cookie: cookie }),
      },
      body: new URLSearchParams(form),
    });

  const cookieFrom = (response: Response): string =>
    (response.headers.get('set-cookie') ?? '').split(';')[0] ?? '';

  describe('public archive', () => {
    it('answers health checks', async () => {
      const response = await build().request('/healthz');
      expect(await response.json()).toEqual({ ok: true });
    });

    it.each([
      '/',
      '/sessions',
      '/sessions/session-1',
      setPage('session-1', 'set-1'),
      '/search?q=owl',
      `/search?streamer=${DJ_A}`,
      '/djs',
      '/djs?sort=name&dir=asc',
      '/sessions?sort=downloads&dir=asc',
      '/sessions?sort=nope',
      '/search?session=00000000-0000-4000-8000-000000000000',
    ])('renders %s', async (path) => {
      const response = await build().request(path);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toMatch(/text\/html/);
    });

    it("links each home section's heading to its full list", async () => {
      const home = await (await build().request('/')).text();
      for (const [href, title] of [
        ['/djs', 'DJs'],
        ['/sessions', 'Recent sessions'],
        ['/search', 'Popular sets'],
      ]) {
        expect(home).toMatch(new RegExp(`<h2[^>]*><a[^>]*href="${href}">${title}`));
      }
    });

    it('shows session and DJ stats, sorted by any column', async () => {
      const app = build();
      const djs = await (await app.request('/djs?sort=name&dir=asc')).text();
      expect(djs.indexOf('Café Sunrise')).toBeLessThan(djs.indexOf('Night Owl II'));
      // DJ A: two one-hour sets.
      expect(djs).toContain('2:00:00');
      const reversed = await (await app.request('/djs?sort=name&dir=desc')).text();
      expect(reversed.indexOf('Night Owl II')).toBeLessThan(reversed.indexOf('Café Sunrise'));

      const sessions = await (await app.request('/sessions?sort=title&dir=asc')).text();
      expect(sessions.indexOf('disco-room')).toBeLessThan(sessions.indexOf('Halloween Disco'));
      expect(sessions).not.toContain('edit-session-');
    });

    it('shows the DJ above their sets', async () => {
      new Catalog(db).updateStreamer(
        DJ_A,
        { bio: 'Spins at night.', links: ['https://example.com/owl'] },
        'test',
      );
      const html = await (await build().request(`/search?streamer=${DJ_A}`)).text();
      expect(html).toContain('Spins at night.');
      expect(html).toContain('href="https://example.com/owl"');
    });

    it('shows the session on a set page, and expands sets inline', async () => {
      const app = build();
      const page = await (await app.request(setPage('session-1', 'set-2'))).text();
      expect(page).toContain('From the session');
      expect(page).toContain('Set 2 of 2');
      expect(page).toContain(`href="${setPage('session-1', 'set-1')}"`);

      const inline = await app.request(`${setPage('session-1', 'set-2')}/inline`);
      expect(inline.status).toBe(200);
      const html = await inline.text();
      expect(html).not.toContain('<html');
      expect(html).toContain('Open set page');
      expect(html).toContain('data-enqueue=');
      expect((await app.request(`${setPage('session-2', 'set-2')}/inline`)).status).toBe(404);
    });

    it('no longer serves the old streamer and tag pages', async () => {
      const app = build();
      for (const old of ['/streamers', `/streamers/${DJ_A}`, '/tags']) {
        expect((await app.request(old)).status).toBe(404);
      }
    });

    it('has a link preview on the home page only', async () => {
      const app = build();
      expect(await (await app.request('/')).text()).toContain('property="og:image"');
      expect(await (await app.request('/djs')).text()).not.toContain('property="og:image"');
    });

    it('filters the set list by search text', async () => {
      const html = await (await build().request('/search?q=caf')).text();
      const list = html.slice(html.indexOf('id="set-list"'));
      expect(list).toContain('Café Sunrise');
      expect(list).toContain(`href="${setPage('session-1', 'set-2')}"`);
      expect(list).not.toContain(`href="${setPage('session-1', 'set-1')}"`);
    });

    it('counts plays reported by the player', async () => {
      const app = build();
      const play = (uuid: string) =>
        app.request(
          new Request(`${ORIGIN}/api/plays/${uuid}`, {
            method: 'POST',
            headers: { Origin: ORIGIN },
          }),
        );
      expect((await play(setUuid('session-1', 'set-1'))).status).toBe(204);
      expect((await play('00000000-0000-5000-8000-000000000000')).status).toBe(404);
      expect((await play('not-a-uuid')).status).toBe(404);
      // Kept for ranking popular sets, but not shown.
      expect(new Catalog(db).getSet('set-1', false)?.plays).toBe(1);
      const page = await (await app.request(setPage('session-1', 'set-1'))).text();
      expect(page).not.toContain('1 play');
    });

    it('serves sets under their session and redirects older set links there', async () => {
      const app = build();
      for (const old of ['/sets/set-1', `/t/${setUuid('session-1', 'set-1')}`]) {
        const response = await app.request(old);
        expect(response.status).toBe(301);
        expect(response.headers.get('location')).toBe(setPage('session-1', 'set-1'));
      }
      // A set's UUID only resolves under its own session.
      expect((await app.request(setPage('session-2', 'set-1'))).status).toBe(404);
      expect((await app.request('/t/not-a-uuid')).status).toBe(404);
    });

    it('returns 404 for unknown sets and hides admin routes', async () => {
      const app = build({ ARCHIVE_ADMIN_PASSWORD: ADMIN_PASSWORD, ARCHIVE_SESSION_SECRET: SECRET });
      expect((await app.request('/sets/nope')).status).toBe(404);
      for (const page of ['/admin', '/admin/sets', '/admin/activity']) {
        expect((await app.request(page)).status).toBe(404);
      }
      expect((await app.request(post('/sets/set-1/edit', { title: 'x' }))).status).toBe(404);
    });
  });

  describe('media', () => {
    it('serves files with range support', async () => {
      const response = await build().request('/media/set-1/m4a', {
        headers: { Range: 'bytes=0-4' },
      });
      expect(response.status).toBe(206);
      expect(response.headers.get('content-type')).toBe('audio/mp4');
      expect(await response.text()).toBe('media');
    });

    it('counts a download once, from its first byte', async () => {
      const app = build();
      const get = (path: string, range?: string) =>
        app.request(path, range === undefined ? {} : { headers: { Range: range } });
      // A whole download, a download manager's first piece, and one counting nothing:
      // a later piece (or a resume), playback, and a HEAD.
      expect((await get('/media/set-2/mp3?download=1')).status).toBe(200);
      expect((await get('/media/set-2/mp3?download=1', 'bytes=0-2')).status).toBe(206);
      expect((await get('/media/set-2/mp3?download=1', 'bytes=2-')).status).toBe(206);
      expect((await get('/media/set-2/mp3')).status).toBe(200);
      expect((await app.request('/media/set-2/mp3?download=1', { method: 'HEAD' })).status).toBe(
        200,
      );
      expect(new Catalog(db).getSet('set-2', false)?.downloads).toBe(2);
      const page = await (await app.request(setPage('session-1', 'set-2'))).text();
      expect(page).toContain('2 downloads');
    });

    it('sets a friendly download filename', async () => {
      const response = await build().request('/media/set-2/mp3?download=1');
      expect(response.headers.get('content-disposition')).toContain(
        "filename*=UTF-8''Caf%C3%A9%20Sunrise%20-%20Halloween%20Disco%20(Nov%2014%2C%202026).mp3",
      );
    });

    it('plays and offers the raw capture until the leveled files exist', async () => {
      await recordings.write(
        'raw-only',
        makeSession({
          id: 'session-raw',
          sets: [
            makeSet({
              id: 'set-raw',
              userId: DJ_A,
              status: 'processing',
              files: { rawAudio: 'raw/set-raw.wav' },
            }),
          ],
        }),
        true,
      );
      await syncCatalog(db, recordings.dir);
      const app = build();
      const page = await (await app.request(setPage('session-raw', 'set-raw'))).text();
      // The player queue on the play button points at the raw capture.
      expect(page).toContain('data-queue=');
      expect(page).toContain('/media/set-raw/raw');
      expect(page).toContain('not leveled yet');
      expect(page).toContain('href="/media/set-raw/raw?download=1"');
      const media = await app.request('/media/set-raw/raw');
      expect(media.headers.get('content-type')).toBe('audio/wav');
    });

    it('404s for unknown formats and hidden sets', async () => {
      const app = build();
      expect((await app.request('/media/set-1/exe')).status).toBe(404);
      new Catalog(db).updateSet('set-1', { hidden: true }, 'test');
      expect((await app.request('/media/set-1/m4a')).status).toBe(404);
    });
  });

  describe('admin', () => {
    const adminEnv = { ARCHIVE_ADMIN_PASSWORD: ADMIN_PASSWORD, ARCHIVE_SESSION_SECRET: SECRET };

    const loginAsAdmin = async (app: ReturnType<typeof build>) => {
      const response = await app.request(post('/login', { password: ADMIN_PASSWORD, next: '/' }));
      expect(response.status).toBe(303);
      return cookieFrom(response);
    };

    it('saves album covers, set art and DJ pictures with the edit form', async () => {
      const dataDir = await mkdtemp(path.join(tmpdir(), 'dsr-data-'));
      try {
        const app = build({ ...adminEnv, ARCHIVE_DATA_DIR: dataDir });
        const cookie = await loginAsAdmin(app);
        const edit = (route: string, body: FormData) =>
          app.request(
            new Request(`${ORIGIN}${route}`, {
              method: 'POST',
              headers: { Origin: ORIGIN, Cookie: cookie },
              body,
            }),
          );
        const form = (fields: Record<string, string>, image?: Uint8Array | string) => {
          const body = new FormData();
          for (const [key, value] of Object.entries(fields)) body.set(key, value);
          // Like a browser with no file chosen: an empty file part.
          body.set(
            'image',
            new File([image ?? ''], image ? 'cover.png' : '', { type: 'image/png' }),
          );
          return body;
        };

        const saved = await edit(
          '/sessions/session-1/edit',
          form({ title: 'Covered', next: '/sessions/session-1' }, PNG),
        );
        expect(saved.status).toBe(303);
        expect(saved.headers.get('location')).toBe('/sessions/session-1');
        const album = await (
          await app.request('/sessions/session-1', { headers: { Cookie: cookie } })
        ).text();
        expect(album).toContain('Covered');
        const src = /src="(\/images\/[0-9a-f]{32}\.png)"/.exec(album)?.[1];
        expect(src).toBeDefined();
        const image = await app.request(src ?? '', { headers: { Cookie: cookie } });
        expect(image.headers.get('content-type')).toBe('image/png');

        // No file chosen: the text saves and the cover stays.
        expect((await edit('/sessions/session-1/edit', form({ title: 'Kept' }))).status).toBe(303);
        expect(await readdir(path.join(dataDir, 'images'))).toHaveLength(1);

        // Not an image: refused, whatever the browser says it is, and nothing is saved.
        const refused = await edit('/sets/set-1/edit', form({ title: 'Nope' }, '<svg/>'));
        expect(refused.status).toBe(400);
        expect(new Catalog(db).getSet('set-1', true)?.title).toBeUndefined();

        expect((await edit('/streamers/' + DJ_A + '/edit', form({}, PNG))).status).toBe(303);
        expect((await edit('/sessions/session-1/edit', form({ removeImage: '1' }))).status).toBe(
          303,
        );
        // The DJ picture is the same bytes, so the shared file stays until it's unused.
        expect(await readdir(path.join(dataDir, 'images'))).toHaveLength(1);
        expect(
          (await edit('/streamers/' + DJ_A + '/edit', form({ removeImage: '1' }))).status,
        ).toBe(303);
        expect(await readdir(path.join(dataDir, 'images'))).toEqual([]);
      } finally {
        await rm(dataDir, { recursive: true, force: true });
      }
    });

    it('rejects a wrong password', async () => {
      const response = await build(adminEnv).request(post('/login', { password: 'nope' }));
      expect(response.status).toBe(401);
    });

    it('blocks a client after too many logins, even with the right password', async () => {
      const app = build(adminEnv);
      const from = async (ip: string, password: string) => {
        const request = post('/login', { password });
        request.headers.set('X-Forwarded-For', ip);
        return await app.request(request);
      };
      const failed = await Promise.all(
        Array.from({ length: 10 }, () => from('203.0.113.7', 'nope')),
      );
      expect(failed.map((response) => response.status)).toEqual(Array(10).fill(401));
      const blocked = await from('203.0.113.7', ADMIN_PASSWORD);
      expect(blocked.status).toBe(429);
      expect(blocked.headers.get('retry-after')).toMatch(/^\d+$/);
      expect(blocked.headers.get('set-cookie')).toBeNull();
      expect((await from('198.51.100.1', ADMIN_PASSWORD)).status).toBe(303);
    });

    it('refuses an oversized login body', async () => {
      const response = await build(adminEnv).request(
        post('/login', { password: 'x'.repeat(32 * 1024) }),
      );
      expect(response.status).toBe(413);
    });

    it('edits and hides a set, and logs it', async () => {
      const app = build(adminEnv);
      const cookie = await loginAsAdmin(app);

      const edit = await app.request(
        post(
          '/sets/set-1/edit',
          { title: 'Spooky Mix', tags: 'house, disco', hidden: 'hidden' },
          cookie,
        ),
      );
      expect(edit.status).toBe(303);
      expect(edit.headers.get('location')).toBe(setPage('session-1', 'set-1'));

      // Admin still sees it, with a badge; the public doesn't.
      const adminView = await (
        await app.request(setPage('session-1', 'set-1'), { headers: { Cookie: cookie } })
      ).text();
      expect(adminView).toContain('Spooky Mix');
      expect(adminView).toContain('hidden');
      expect((await app.request(setPage('session-1', 'set-1'))).status).toBe(404);

      const activity = await (
        await app.request('/admin/activity', { headers: { Cookie: cookie } })
      ).text();
      expect(activity).toContain('Spooky Mix');
    });

    it('shows totals, storage use and sets that need attention', async () => {
      await recordings.write(
        'failed',
        makeSession({
          id: 'session-failed',
          sets: [
            makeSet({
              id: 'set-failed',
              userId: DJ_A,
              status: 'failed',
              error: 'loudnorm measurement failed',
              files: { rawAudio: 'raw/set-failed.wav' },
            }),
          ],
        }),
        true,
      );
      await syncCatalog(db, recordings.dir);
      const app = build(adminEnv);
      const cookie = await loginAsAdmin(app);
      const html = await (await app.request('/admin', { headers: { Cookie: cookie } })).text();
      expect(html).toContain('loudnorm measurement failed');
      // Fixture files are tiny text files: `media:raw/set-failed.wav` is 24 bytes.
      expect(html).toContain('24 B');
    });

    it('lists every set for admins, filtered and sorted, with quick hide', async () => {
      const app = build(adminEnv);
      const cookie = await loginAsAdmin(app);
      const get = async (path: string) =>
        (await app.request(path, { headers: { Cookie: cookie } })).text();

      const byLength = await get('/admin/sets?sort=length&dir=desc');
      expect(byLength.indexOf('Café Sunrise')).toBeLessThan(byLength.indexOf('Night Owl II'));

      const next = '/admin/sets?visibility=archived';
      const hide = await app.request(post('/sets/set-2/edit', { hidden: 'hidden', next }, cookie));
      expect(hide.status).toBe(303);
      expect(hide.headers.get('location')).toBe(next);

      const hidden = await get(next);
      const table = hidden.slice(hidden.indexOf('id="admin-sets"'));
      expect(table).toContain('Café Sunrise');
      expect(table).not.toContain('Night Owl');
      expect(table).toContain('Unarchive');
      expect(await get('/admin/sets?status=failed')).toContain('No sets match.');
    });

    it('opens edit dialogs from the album and set pages', async () => {
      const app = build(adminEnv);
      const cookie = await loginAsAdmin(app);
      const page = await (
        await app.request(setPage('session-1', 'set-1'), { headers: { Cookie: cookie } })
      ).text();
      expect(page).toContain('data-dialog="edit-set-set-1"');
      expect(page).toContain('<dialog id="edit-set-set-1"');
      expect(page).toContain(`<dialog id="edit-streamer-${DJ_A}"`);
    });

    it('reorders an album', async () => {
      const app = build(adminEnv);
      const cookie = await loginAsAdmin(app);
      const move = await app.request(
        post(
          '/sessions/session-1/order',
          { set: 'set-2', move: 'up', next: '/sessions/session-1' },
          cookie,
        ),
      );
      expect(move.headers.get('location')).toBe('/sessions/session-1');
      const album = await (
        await app.request('/sessions/session-1', { headers: { Cookie: cookie } })
      ).text();
      expect(album.indexOf('Café Sunrise')).toBeLessThan(album.indexOf('Night Owl'));
      expect(album).toContain('Back to recorded order');
      expect((await app.request(post('/sessions/session-1/order', { move: 'reset' }))).status).toBe(
        404,
      );
    });

    it('deletes a set: files, session.json entry and catalog row', async () => {
      const app = build(adminEnv);
      const cookie = await loginAsAdmin(app);
      const sessionDir = path.join(recordings.dir, '2026-11-14_halloween-disco');
      const deleted = await app.request(
        post('/sets/set-2/delete', { next: '/sessions/session-1' }, cookie),
      );
      expect(deleted.status).toBe(303);
      expect(deleted.headers.get('location')).toBe('/sessions/session-1');
      expect(await readdir(path.join(sessionDir, 'leveled'))).toEqual([
        'set-1.flac',
        'set-1.m4a',
        'set-1.mp3',
      ]);
      const json = JSON.parse(await readFile(path.join(sessionDir, 'session.json'), 'utf8')) as {
        sets: { id: string }[];
      };
      expect(json.sets.map((set) => set.id)).toEqual(['set-1']);
      expect(new Catalog(db).getSet('set-2', true)).toBeUndefined();
      // A resync doesn't bring it back.
      await syncCatalog(db, recordings.dir);
      expect(new Catalog(db).getSet('set-2', true)).toBeUndefined();
      expect(
        await (await app.request('/admin/activity', { headers: { Cookie: cookie } })).text(),
      ).toContain('Deleted permanently');
      // The feed filters by who made the change.
      const recorderOnly = await (
        await app.request('/admin/activity?actor=recorder', { headers: { Cookie: cookie } })
      ).text();
      expect(recorderOnly).toContain('Recorded');
      expect(recorderOnly).not.toContain('Deleted permanently');
    });

    it('refuses to delete while recording, unless forced', async () => {
      await recordings.write(
        'live',
        makeSession({
          id: 'session-live',
          endedAt: undefined,
          sets: [
            makeSet({ id: 'set-live', userId: DJ_A, status: 'recording', endedAt: undefined }),
          ],
        }),
        true,
      );
      await syncCatalog(db, recordings.dir);
      const app = build(adminEnv);
      const cookie = await loginAsAdmin(app);
      expect((await app.request(post('/sets/set-live/delete', {}, cookie))).status).toBe(409);
      expect((await app.request(post('/sessions/session-live/delete', {}, cookie))).status).toBe(
        409,
      );
      expect(await readdir(recordings.dir)).toContain('live');

      const forced = await app.request(
        post('/sessions/session-live/delete', { force: '1' }, cookie),
      );
      expect(forced.status).toBe(303);
      expect(forced.headers.get('location')).toBe('/sessions');
      expect(await readdir(recordings.dir)).not.toContain('live');
      expect(new Catalog(db).getSession('session-live', true)).toBeUndefined();
    });

    describe('adding a set from a file', () => {
      const base = `${ORIGIN}/sessions/session-1/uploads`;
      const start = (cookie: string | undefined, details: Record<string, unknown>) =>
        new Request(base, {
          method: 'POST',
          headers: {
            Origin: ORIGIN,
            'Content-Type': 'application/json',
            ...(cookie && { Cookie: cookie }),
          },
          body: JSON.stringify(details),
        });
      const piece = (cookie: string, id: string, offset: number, text: string) =>
        new Request(`${base}/${id}?offset=${String(offset)}`, {
          method: 'PUT',
          headers: {
            Origin: ORIGIN,
            'Content-Type': 'application/octet-stream',
            'Content-Length': String(text.length),
            Cookie: cookie,
          },
          body: text,
        });
      const details = {
        name: 'Afterglow set.mp3',
        size: 10,
        userId: DJ_A,
        displayName: 'Afterglow',
        startedAt: '2026-11-14T23:00:00.000Z',
      };
      const uploadsDir = () => path.join(recordings.dir, '2026-11-14_halloween-disco', 'uploads');

      it('takes the file in pieces, then leaves an import request for the recorder', async () => {
        const app = build(adminEnv);
        const cookie = await loginAsAdmin(app);
        const started = await app.request(start(cookie, details));
        expect(started.status).toBe(201);
        const { id } = (await started.json()) as { id: string };

        expect(await (await app.request(piece(cookie, id, 0, '01234'))).json()).toEqual({
          received: 5,
          size: 10,
          done: false,
        });
        // Resuming: the client asks where to carry on.
        const progress = await app.request(`${base}/${id}`, { headers: { Cookie: cookie } });
        expect(await progress.json()).toMatchObject({ received: 5 });
        // A repeated piece is refused with where the upload stands.
        const repeat = await app.request(piece(cookie, id, 0, '01234'));
        expect(repeat.status).toBe(409);
        expect(await repeat.json()).toMatchObject({ received: 5 });

        const last = await app.request(piece(cookie, id, 5, '56789'));
        expect(await last.json()).toMatchObject({ done: true });
        const visible = (await readdir(uploadsDir())).filter((name) => !name.startsWith('.'));
        expect(visible.sort()).toEqual([`${id}.json`, `${id}.mp3`]);
        expect(await readFile(path.join(uploadsDir(), `${id}.mp3`), 'utf8')).toBe('0123456789');
        expect(JSON.parse(await readFile(path.join(uploadsDir(), `${id}.json`), 'utf8'))).toEqual({
          schemaVersion: 1,
          file: `${id}.mp3`,
          userId: DJ_A,
          displayName: 'Afterglow',
          startedAt: details.startedAt,
        });
      });

      it('refuses other file types and missing details, writing nothing', async () => {
        const app = build(adminEnv);
        const cookie = await loginAsAdmin(app);
        const exe = await app.request(start(cookie, { ...details, name: 'set.exe' }));
        expect(exe.status).toBe(400);
        expect(((await exe.json()) as { error: string }).error).toContain("Can't use a .exe file");
        expect((await app.request(start(cookie, { ...details, userId: '' }))).status).toBe(400);
        await expect(readdir(uploadsDir())).rejects.toThrow();
      });

      it('refuses while the session is still recording', async () => {
        await recordings.write(
          '2026-11-14_halloween-disco',
          makeSession({
            id: 'session-1',
            endedAt: undefined,
            sets: [makeSet({ id: 'set-1', userId: DJ_A })],
          }),
        );
        await syncCatalog(db, recordings.dir);
        const app = build(adminEnv);
        const response = await app.request(start(await loginAsAdmin(app), details));
        expect(response.status).toBe(409);
      });

      it('is admin-only', async () => {
        const app = build(adminEnv);
        expect((await app.request(start(undefined, details))).status).toBe(404);
      });
    });

    it('only lets admins delete', async () => {
      const app = build(adminEnv);
      expect((await app.request(post('/sets/set-1/delete', {}))).status).toBe(404);
      expect((await app.request(post('/sessions/session-1/delete', {}))).status).toBe(404);
      expect(await readdir(recordings.dir)).toContain('2026-11-14_halloween-disco');
    });

    it('rejects cross-site form posts', async () => {
      const app = build(adminEnv);
      const cookie = await loginAsAdmin(app);
      const request = post('/sets/set-1/edit', { title: 'x' }, cookie);
      request.headers.set('Origin', 'https://evil.example');
      expect((await app.request(request)).status).toBe(403);
    });

    it('ignores a forged cookie', async () => {
      const app = build(adminEnv);
      const forged = `dsr_session=${encodeURIComponent('{"role":"admin","exp":9999999999999}')}.bad`;
      expect((await app.request('/admin/activity', { headers: { Cookie: forged } })).status).toBe(
        404,
      );
    });
  });

  describe('viewer password', () => {
    const env = { ARCHIVE_PASSWORD: VIEWER_PASSWORD, ARCHIVE_SESSION_SECRET: SECRET };

    it('redirects to login, keeping the target page', async () => {
      const response = await build(env).request('/sets/set-1?t=1');
      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toBe('/login?next=%2Fsets%2Fset-1%3Ft%3D1');
    });

    it('protects media too', async () => {
      expect((await build(env).request('/media/set-1/m4a')).status).toBe(303);
    });

    it('lets viewers in after login, but not into admin', async () => {
      const app = build({ ...env, ARCHIVE_ADMIN_PASSWORD: ADMIN_PASSWORD });
      const login = await app.request(
        post('/login', { password: VIEWER_PASSWORD, next: '/search' }),
      );
      expect(login.headers.get('location')).toBe('/search');
      const cookie = cookieFrom(login);

      const page = setPage('session-1', 'set-1');
      expect((await app.request(page, { headers: { Cookie: cookie } })).status).toBe(200);
      expect((await app.request('/admin/activity', { headers: { Cookie: cookie } })).status).toBe(
        404,
      );
    });

    it('gives crawlers a link preview on the login page, with a public image', async () => {
      const app = build(env);
      const home = await app.request('/');
      expect(home.headers.get('location')).toBe('/login?next=%2F');
      const login = await (await app.request('/login?next=%2F')).text();
      expect(login).toContain('<meta property="og:title" content="Stream Archive"');
      expect(login).toContain(`<meta property="og:image" content="${ORIGIN}/assets/og.png"`);
      expect(login).toContain(`<meta property="og:url" content="${ORIGIN}/"`);
      for (const [path, type] of [
        ['/assets/og.png', 'image/png'],
        ['/assets/apple-touch-icon.png', 'image/png'],
        ['/favicon.svg', 'image/svg+xml'],
      ] as const) {
        const response = await app.request(path);
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe(type);
      }
    });

    it('links versioned scripts, cached for good, and caches unversioned ones briefly', async () => {
      const app = build(env);
      const login = await (await app.request('/login')).text();
      const htmx = /\/assets\/htmx\.min\.js\?v=\w+/.exec(login)?.[0];
      expect(htmx).toBeDefined();
      expect((await app.request(htmx ?? '')).headers.get('cache-control')).toBe(
        'public, max-age=31536000, immutable',
      );
      expect((await app.request('/assets/htmx.min.js')).headers.get('cache-control')).toBe(
        'public, max-age=300',
      );
    });

    it('refuses open redirects after login', async () => {
      const login = await build(env).request(
        post('/login', { password: VIEWER_PASSWORD, next: '//evil.example' }),
      );
      expect(login.headers.get('location')).toBe('/');
    });
  });
});
