/** Read-only pages: home, sessions, sets, streamers, search, tags. */
import { Hono } from 'hono';
import type { AuthEnv } from '../auth/auth.ts';
import type { Catalog } from '../catalog/catalog.ts';
import {
  HomePage,
  NotFoundPage,
  SearchPage,
  SessionPage,
  SessionsPage,
  SetPage,
  StreamerPage,
  StreamersPage,
  TagsPage,
} from '../views/pages.tsx';
import { dateParam, pageParam, snowflakeParam, textParam } from './params.ts';

export function browseRoutes(catalog: Catalog): Hono<AuthEnv> {
  const app = new Hono<AuthEnv>();

  app.get('/', (c) => {
    const auth = c.var.auth;
    return c.html(
      <HomePage
        auth={auth}
        sessions={catalog.listSessions(1, auth.isAdmin).items.slice(0, 6)}
        recent={catalog.recentSets(8, auth.isAdmin)}
        tags={catalog.listTags(auth.isAdmin)}
      />,
    );
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

  app.get('/search', (c) => {
    const auth = c.var.auth;
    const params = {
      q: textParam(c.req.query('q')),
      tag: textParam(c.req.query('tag'), 32),
      userId: snowflakeParam(c.req.query('streamer')),
      from: dateParam(c.req.query('from')),
      to: dateParam(c.req.query('to')),
      page: pageParam(c.req.query('page')),
    };
    return c.html(
      <SearchPage
        auth={auth}
        params={params}
        results={catalog.search(params, auth.isAdmin)}
        streamers={catalog.listStreamers(auth.isAdmin)}
        tags={catalog.listTags(auth.isAdmin)}
      />,
    );
  });

  app.get('/tags', (c) => {
    const auth = c.var.auth;
    return c.html(<TagsPage auth={auth} tags={catalog.listTags(auth.isAdmin)} />);
  });

  return app;
}
