import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.ts';
import { Catalog } from './catalog/catalog.ts';
import { syncCatalog } from './catalog/sync.ts';
import { loadConfig } from './config.ts';
import { openMemoryDatabase, type Db } from './db/database.ts';
import {
  createRecordings,
  DJ_A,
  standardFixture,
  type RecordingsFixture,
} from './test/fixtures.ts';

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
      '/sets/set-1',
      '/streamers',
      `/streamers/${DJ_A}`,
      '/tags',
      '/search?q=owl',
    ])('renders %s', async (path) => {
      const response = await build().request(path);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toMatch(/text\/html/);
    });

    it('shows search results', async () => {
      const html = await (await build().request('/search?q=caf')).text();
      expect(html).toContain('Café Sunrise');
      expect(html).toContain('href="/sets/set-2"');
      expect(html).not.toContain('href="/sets/set-1"');
    });

    it('returns 404 for unknown sets and hides admin routes', async () => {
      const app = build({ ARCHIVE_ADMIN_PASSWORD: ADMIN_PASSWORD, ARCHIVE_SESSION_SECRET: SECRET });
      expect((await app.request('/sets/nope')).status).toBe(404);
      expect((await app.request('/admin/activity')).status).toBe(404);
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
      expect(edit.headers.get('location')).toBe('/sets/set-1');

      // Admin still sees it, with a badge; the public doesn't.
      const adminView = await (
        await app.request('/sets/set-1', { headers: { Cookie: cookie } })
      ).text();
      expect(adminView).toContain('Spooky Mix');
      expect(adminView).toContain('hidden');
      expect((await app.request('/sets/set-1')).status).toBe(404);

      const activity = await (
        await app.request('/admin/activity', { headers: { Cookie: cookie } })
      ).text();
      expect(activity).toContain('Spooky Mix');
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
        post('/login', { password: VIEWER_PASSWORD, next: '/sets/set-1' }),
      );
      expect(login.headers.get('location')).toBe('/sets/set-1');
      const cookie = cookieFrom(login);

      expect((await app.request('/sets/set-1', { headers: { Cookie: cookie } })).status).toBe(200);
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
