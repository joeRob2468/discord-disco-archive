/**
 * Read-only pages: home, search, sessions (as albums) and the sets inside them, DJs and
 * tags. Sets are addressed under their session by UUID; old set links redirect there.
 */
import { Hono } from 'hono';
import type { AuthEnv, AuthState } from '../auth/auth.ts';
import type { Catalog, SessionSummary } from '../catalog/catalog.ts';
import { isUuid } from '../catalog/ids.ts';
import { AlbumPage, SetDetailPage } from '../views/album.tsx';
import { HomePage, type Album } from '../views/home.tsx';
import { setUrl, type SearchFilters } from '../views/links.ts';
import {
  NotFoundPage,
  SessionsPage,
  StreamerPage,
  StreamersPage,
  TagsPage,
} from '../views/pages.tsx';
import { SearchPage } from '../views/search.tsx';
import { pageParam, snowflakeParam, textParam } from './params.ts';

const RECENT_SESSIONS = 4;
const POPULAR_SETS = 8;
const POPULAR_DAYS = 30;

/** A session is only worth showing with sets in it (an album without tracks is noise). */
const hasSets = (session: SessionSummary, auth: AuthState): boolean =>
  (auth.isAdmin ? session.totalSets : session.visibleSets) > 0;

export function browseRoutes(catalog: Catalog): Hono<AuthEnv> {
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
        data={{ list, filters, labels: { session: sessionInfo?.title, streamer: streamer?.name } }}
      />,
    );
  });

  app.get('/sessions', (c) => {
    const auth = c.var.auth;
    const page = catalog.listSessions(pageParam(c.req.query('page')), auth.isAdmin);
    const items = page.items.filter((s) => hasSets(s, auth));
    return c.html(<SessionsPage auth={auth} page={{ ...page, items }} />);
  });

  app.get('/sessions/:id', (c) => {
    const auth = c.var.auth;
    const session = catalog.getSession(c.req.param('id'), auth.isAdmin);
    if (!session || !hasSets(session, auth)) return c.html(<NotFoundPage auth={auth} />, 404);
    return c.html(<AlbumPage auth={auth} album={albumOf(session, auth)} />);
  });

  app.get('/sessions/:id/sets/:uuid', (c) => {
    const auth = c.var.auth;
    const uuid = c.req.param('uuid');
    const set = isUuid(uuid) ? catalog.getSetByUuid(uuid, auth.isAdmin) : undefined;
    if (set?.sessionId !== c.req.param('id')) {
      return c.html(<NotFoundPage auth={auth} />, 404);
    }
    const siblings = catalog.listSessionSets(set.sessionId, auth.isAdmin);
    const index = siblings.findIndex((s) => s.id === set.id);
    return c.html(
      <SetDetailPage
        auth={auth}
        set={set}
        previous={index > 0 ? siblings[index - 1] : undefined}
        next={siblings[index + 1]}
      />,
    );
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

  app.get('/streamers', (c) => {
    const auth = c.var.auth;
    return c.html(<StreamersPage auth={auth} streamers={catalog.listStreamers(auth.isAdmin)} />);
  });

  app.get('/streamers/:userId', (c) => {
    const auth = c.var.auth;
    const streamer = catalog.getStreamer(c.req.param('userId'), auth.isAdmin);
    if (!streamer) return c.html(<NotFoundPage auth={auth} />, 404);
    const sets = catalog.search(
      { userId: streamer.userId, page: pageParam(c.req.query('page')) },
      auth.isAdmin,
    );
    return c.html(<StreamerPage auth={auth} streamer={streamer} sets={sets} />);
  });

  app.get('/tags', (c) => {
    const auth = c.var.auth;
    return c.html(<TagsPage auth={auth} tags={catalog.listTags(auth.isAdmin)} />);
  });

  return app;
}
