/**
 * Read-only pages. The home page holds the set list; the session, set and streamer pages
 * stay for admin edits until the admin panel replaces them.
 */
import { Hono } from 'hono';
import type { AuthEnv, AuthState } from '../auth/auth.ts';
import type { Catalog, SetSummary } from '../catalog/catalog.ts';
import { isUuid } from '../catalog/ids.ts';
import { HomePage, homeUrl, type HomeData, type ListFilters } from '../views/home.tsx';
import {
  NotFoundPage,
  SessionPage,
  SessionsPage,
  SetPage,
  StreamerPage,
  StreamersPage,
  TagsPage,
} from '../views/pages.tsx';
import { pageParam, snowflakeParam, textParam } from './params.ts';

const RECENT_SESSIONS = 4;
const POPULAR_SETS = 8;
const POPULAR_DAYS = 30;

export function browseRoutes(catalog: Catalog): Hono<AuthEnv> {
  const app = new Hono<AuthEnv>();

  function homeData(auth: AuthState, filters: ListFilters, shared?: SetSummary): HomeData {
    const all = auth.isAdmin;
    const session = filters.sessionId ? catalog.getSession(filters.sessionId, all) : undefined;
    const streamer = filters.userId ? catalog.getStreamer(filters.userId, all) : undefined;
    return {
      sessions: catalog
        .listSessions(1, all)
        .items.slice(0, RECENT_SESSIONS)
        .map((s) => ({ session: s, sets: catalog.listSessionSets(s.id, all) })),
      streamers: catalog.listStreamers(all),
      popular: catalog.popularSets(POPULAR_SETS, POPULAR_DAYS, all),
      list: catalog.search({ ...filters, sessionId: session?.id, userId: streamer?.userId }, all),
      filters,
      filterLabels: { session: session?.title, streamer: streamer?.name },
      shared,
    };
  }

  const listFilters = (query: (key: string) => string | undefined): ListFilters => {
    const session = textParam(query('session'), 64);
    return {
      q: textParam(query('q')),
      sessionId: session && isUuid(session) ? session : undefined,
      userId: snowflakeParam(query('streamer')),
      page: pageParam(query('page')),
    };
  };

  app.get('/', (c) => {
    const auth = c.var.auth;
    const filters = listFilters((key) => c.req.query(key));
    return c.html(<HomePage auth={auth} data={homeData(auth, filters)} />);
  });

  // A shared set: the home page with that set open at the top of the list.
  app.get('/t/:uuid', (c) => {
    const auth = c.var.auth;
    const uuid = c.req.param('uuid');
    const set = isUuid(uuid) ? catalog.getSetByUuid(uuid, auth.isAdmin) : undefined;
    if (!set) return c.html(<NotFoundPage auth={auth} />, 404);
    const filters = { sessionId: set.sessionId };
    return c.html(<HomePage auth={auth} data={homeData(auth, filters, set)} />);
  });

  app.get('/sessions', (c) => {
    const auth = c.var.auth;
    const page = catalog.listSessions(pageParam(c.req.query('page')), auth.isAdmin);
    return c.html(<SessionsPage auth={auth} page={page} />);
  });

  app.get('/sessions/:id', (c) => {
    const auth = c.var.auth;
    const session = catalog.getSession(c.req.param('id'), auth.isAdmin);
    if (!session) return c.html(<NotFoundPage auth={auth} />, 404);
    const sets = catalog.listSessionSets(session.id, auth.isAdmin);
    return c.html(<SessionPage auth={auth} session={session} sets={sets} />);
  });

  app.get('/sets/:id', (c) => {
    const auth = c.var.auth;
    const set = catalog.getSet(c.req.param('id'), auth.isAdmin);
    if (!set) return c.html(<NotFoundPage auth={auth} />, 404);
    const siblings = catalog.listSessionSets(set.sessionId, auth.isAdmin);
    const index = siblings.findIndex((s) => s.id === set.id);
    return c.html(
      <SetPage
        auth={auth}
        set={set}
        previous={index > 0 ? siblings[index - 1] : undefined}
        next={siblings[index + 1]}
      />,
    );
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

  // Search lives in the home page's set list now.
  app.get('/search', (c) => c.redirect(homeUrl(listFilters((key) => c.req.query(key))), 301));

  app.get('/tags', (c) => {
    const auth = c.var.auth;
    return c.html(<TagsPage auth={auth} tags={catalog.listTags(auth.isAdmin)} />);
  });

  return app;
}
