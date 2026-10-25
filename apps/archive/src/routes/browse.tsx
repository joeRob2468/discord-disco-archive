/**
 * Read-only pages: home, search, sessions (as albums) and the sets inside them, and the
 * session and DJ stats tables. Sets are addressed under their session by UUID; old set
 * links redirect there.
 */
import { Hono } from 'hono';
import type { AuthEnv, AuthState } from '../auth/auth.ts';
import {
  SESSION_SORTS,
  STREAMER_SORTS,
  type Catalog,
  type SessionSummary,
} from '../catalog/catalog.ts';
import { isUuid } from '../catalog/ids.ts';
import { AlbumPage, SetDetailPage, SetInline } from '../views/album.tsx';
import { HomePage, type Album } from '../views/home.tsx';
import { setUrl, type SearchFilters } from '../views/links.ts';
import { sitePreview } from '../views/layout.tsx';
import { NotFoundPage } from '../views/pages.tsx';
import { SearchPage } from '../views/search.tsx';
import { DjsPage, SessionsPage, sessionDefaultDir, streamerDefaultDir } from '../views/tables.tsx';
import { pageParam, snowflakeParam, sortParam, textParam } from './params.ts';

const RECENT_SESSIONS = 4;
const POPULAR_SETS = 8;
const POPULAR_DAYS = 30;

/** A session is only worth showing with sets in it (an album without tracks is noise). */
const hasSets = (session: SessionSummary, auth: AuthState): boolean =>
  (auth.isAdmin ? session.totalSets : session.visibleSets) > 0;

export function browseRoutes(catalog: Catalog, publicUrl: string): Hono<AuthEnv> {
  const app = new Hono<AuthEnv>();

  const albumOf = (session: SessionSummary, auth: AuthState): Album => ({
    session,
    sets: catalog.listSessionSets(session.id, auth.isAdmin),
  });

  app.get('/', (c) => {
    const auth = c.var.auth;
    const sessions = catalog.listSessions(1, auth.isAdmin).items.filter((s) => hasSets(s, auth));
    return c.html(
      <HomePage
        auth={auth}
        preview={sitePreview(publicUrl)}
        data={{
          albums: sessions.slice(0, RECENT_SESSIONS).map((s) => albumOf(s, auth)),
          streamers: catalog.listStreamers(auth.isAdmin),
          popular: catalog.popularSets(POPULAR_SETS, POPULAR_DAYS, auth.isAdmin),
        }}
      />,
    );
  });

  app.get('/search', (c) => {
    const auth = c.var.auth;
    const session = textParam(c.req.query('session'), 64);
    const filters: SearchFilters = {
      q: textParam(c.req.query('q')),
      sessionId: session && isUuid(session) ? session : undefined,
      userId: snowflakeParam(c.req.query('streamer')),
      page: pageParam(c.req.query('page')),
    };
    const sessionInfo = filters.sessionId
      ? catalog.getSession(filters.sessionId, auth.isAdmin)
      : undefined;
    const streamer = filters.userId ? catalog.getStreamer(filters.userId, auth.isAdmin) : undefined;
    const list = catalog.search(
      { ...filters, sessionId: sessionInfo?.id, userId: streamer?.userId },
      auth.isAdmin,
    );
    return c.html(
      <SearchPage
        auth={auth}
        data={{
          list,
          filters,
          labels: { session: sessionInfo?.title, streamer: streamer?.name },
          streamer,
        }}
      />,
    );
  });

  app.get('/sessions', (c) => {
    const auth = c.var.auth;
    const sort = sortParam(
      SESSION_SORTS,
      c.req.query('sort'),
      c.req.query('dir'),
      'date',
      sessionDefaultDir,
    );
    return c.html(
      <SessionsPage
        auth={auth}
        sessions={catalog.listSessionStats(auth.isAdmin, sort)}
        sort={sort}
      />,
    );
  });

  app.get('/djs', (c) => {
    const auth = c.var.auth;
    const sort = sortParam(
      STREAMER_SORTS,
      c.req.query('sort'),
      c.req.query('dir'),
      'last',
      streamerDefaultDir,
    );
    return c.html(
      <DjsPage auth={auth} streamers={catalog.listStreamers(auth.isAdmin, sort)} sort={sort} />,
    );
  });

  app.get('/sessions/:id', (c) => {
    const auth = c.var.auth;
    const session = catalog.getSession(c.req.param('id'), auth.isAdmin);
    if (!session || !hasSets(session, auth)) return c.html(<NotFoundPage auth={auth} />, 404);
    return c.html(<AlbumPage auth={auth} album={albumOf(session, auth)} />);
  });

  /** The set at `/sessions/:id/sets/:uuid`, if the viewer may see it there. */
  const setAt = (auth: AuthState, sessionId: string, uuid: string) => {
    const set = isUuid(uuid) ? catalog.getSetByUuid(uuid, auth.isAdmin) : undefined;
    const session = set && catalog.getSession(set.sessionId, auth.isAdmin);
    if (set?.sessionId !== sessionId || !session) return undefined;
    return { set, session, siblings: catalog.listSessionSets(set.sessionId, auth.isAdmin) };
  };

  app.get('/sessions/:id/sets/:uuid', (c) => {
    const auth = c.var.auth;
    const found = setAt(auth, c.req.param('id'), c.req.param('uuid'));
    if (!found) return c.html(<NotFoundPage auth={auth} />, 404);
    const { set, session, siblings } = found;
    const index = siblings.findIndex((s) => s.id === set.id);
    return c.html(
      <SetDetailPage
        auth={auth}
        set={set}
        session={session}
        albumSets={siblings}
        previous={index > 0 ? siblings[index - 1] : undefined}
        next={siblings[index + 1]}
        streamer={auth.isAdmin ? catalog.getStreamer(set.userId, true) : undefined}
      />,
    );
  });

  // The fragment a set row expands into.
  app.get('/sessions/:id/sets/:uuid/inline', (c) => {
    const found = setAt(c.var.auth, c.req.param('id'), c.req.param('uuid'));
    if (!found) return c.body(null, 404);
    return c.html(<SetInline set={found.set} albumSets={found.siblings} />);
  });

  // Older set links: by recorder set ID, and the short share link.
  app.get('/sets/:id', (c) => {
    const set = catalog.getSet(c.req.param('id'), c.var.auth.isAdmin);
    return set ? c.redirect(setUrl(set), 301) : c.html(<NotFoundPage auth={c.var.auth} />, 404);
  });
  app.get('/t/:uuid', (c) => {
    const uuid = c.req.param('uuid');
    const set = isUuid(uuid) ? catalog.getSetByUuid(uuid, c.var.auth.isAdmin) : undefined;
    return set ? c.redirect(setUrl(set), 301) : c.html(<NotFoundPage auth={c.var.auth} />, 404);
  });

  // Counted by the player when a set starts playing.
  app.post('/api/plays/:uuid', (c) => {
    const uuid = c.req.param('uuid');
    if (!isUuid(uuid) || !catalog.recordPlay(uuid)) return c.body(null, 404);
    return c.body(null, 204);
  });

  return app;
}
