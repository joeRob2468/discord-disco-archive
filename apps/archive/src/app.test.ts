import { mkdtemp, readdir, rm } from 'node:fs/promises';
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
      '/sessions?sort=plays&dir=asc',
      '/sessions?sort=nope',
      '/search?session=00000000-0000-4000-8000-000000000000',
    ])('renders %s', async (path) => {
      const response = await build().request(path);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toMatch(/text\/html/);
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

    it('no longer serves the old streamer and tag pages', async () => {
      const app = build();
      for (const old of ['/streamers', `/streamers/${DJ_A}`, '/tags']) {
        expect((await app.request(old)).status).toBe(404);
      }
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
      const page = await (await app.request(setPage('session-1', 'set-1'))).text();
      expect(page).toContain('1 play');
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

    it('uploads and removes album covers, set art and DJ pictures', async () => {
      const dataDir = await mkdtemp(path.join(tmpdir(), 'dsr-data-'));
      try {
        const app = build({ ...adminEnv, ARCHIVE_DATA_DIR: dataDir });
        const cookie = await loginAsAdmin(app);
        const upload = (entity: string, id: string, body: FormData) =>
          app.request(
            new Request(`${ORIGIN}/admin/images/${entity}/${id}`, {
              method: 'POST',
              headers: { Origin: ORIGIN, Cookie: cookie },
              body,
            }),
          );
        const form = (bytes: Uint8Array) => {
          const body = new FormData();
          body.set('image', new File([bytes], 'cover.png', { type: 'image/png' }));
          return body;
        };

        const cover = form(PNG);
        cover.set('next', '/sessions/session-1');
        const uploaded = await upload('session', 'session-1', cover);
        expect(uploaded.status).toBe(303);
        expect(uploaded.headers.get('location')).toBe('/sessions/session-1');
        const album = await (
          await app.request('/sessions/session-1', { headers: { Cookie: cookie } })
        ).text();
        const src = /src="(\/images\/[0-9a-f]{32}\.png)"/.exec(album)?.[1];
        expect(src).toBeDefined();
        const image = await app.request(src ?? '', { headers: { Cookie: cookie } });
        expect(image.headers.get('content-type')).toBe('image/png');

        // Not an image: refused, whatever the browser says it is.
        const fake = new FormData();
        fake.set('image', new File(['<svg/>'], 'x.png', { type: 'image/png' }));
        expect((await upload('set', 'set-1', fake)).status).toBe(400);
        expect((await upload('nope', 'set-1', form(PNG))).status).toBe(404);

        const remove = new FormData();
        remove.set('remove', '1');
        expect((await upload('session', 'session-1', remove)).status).toBe(303);
        expect(await readdir(path.join(dataDir, 'images'))).toEqual([]);
      } finally {
        await rm(dataDir, { recursive: true, force: true });
      }
    });

    it('rejects a wrong password', async () => {
      const response = await build(adminEnv).request(post('/login', { password: 'nope' }));
      expect(response.status).toBe(401);
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

      const next = '/admin/sets?visibility=hidden';
      const hide = await app.request(post('/sets/set-2/edit', { hidden: 'hidden', next }, cookie));
      expect(hide.status).toBe(303);
      expect(hide.headers.get('location')).toBe(next);

      const hidden = await get(next);
      const table = hidden.slice(hidden.indexOf('id="admin-sets"'));
      expect(table).toContain('Café Sunrise');
      expect(table).not.toContain('Night Owl');
      expect(table).toContain('Unhide');
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

    it('refuses open redirects after login', async () => {
      const login = await build(env).request(
        post('/login', { password: VIEWER_PASSWORD, next: '//evil.example' }),
      );
      expect(login.headers.get('location')).toBe('/');
    });
  });
});
