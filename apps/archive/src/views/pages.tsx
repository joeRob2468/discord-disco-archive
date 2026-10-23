/**
 * Full pages. Each takes already-loaded data; routes do the loading.
 */
import type { AuthState } from '../auth/auth.ts';
import type {
  AuditEntry,
  Page,
  SearchParams,
  SessionSummary,
  SetSummary,
  StreamerSummary,
  TagCount,
} from '../catalog/catalog.ts';
import {
  Avatar,
  Downloads,
  EditSessionForm,
  EditSetForm,
  EditStreamerForm,
  Pager,
  Player,
  SessionCard,
  SetBadges,
  SetRow,
  StreamerRow,
  Tags,
} from './components.tsx';
import { formatDateTime, formatDuration, plural } from './format.ts';
import { Layout } from './layout.tsx';

const withPage = (base: string, params: Record<string, string | undefined>) => (page: number) => {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) query.set(key, value);
  query.set('page', String(page));
  return `${base}?${query.toString()}`;
};

export function HomePage(props: {
  auth: AuthState;
  sessions: SessionSummary[];
  recent: SetSummary[];
  tags: TagCount[];
}) {
  const { auth, sessions, recent, tags } = props;
  return (
    <Layout title="Home" auth={auth}>
      <h1>Stream Archive</h1>
      <p class="muted">Recorded DJ sets from our Discord sessions.</p>

      <h2>Latest sessions</h2>
      {sessions.length === 0 ? (
        <p class="muted">Nothing recorded yet.</p>
      ) : (
        <div class="cards">
          {sessions.map((session) => (
            <SessionCard session={session} />
          ))}
        </div>
      )}
      <p>
        <a href="/sessions">All sessions →</a>
      </p>

      {recent.length > 0 && (
        <>
          <h2>Recent sets</h2>
          <div class="rows">
            {recent.map((set) => (
              <SetRow set={set} auth={auth} />
            ))}
          </div>
        </>
      )}

      {tags.length > 0 && (
        <>
          <h2>Tags</h2>
          <Tags tags={tags.slice(0, 30).map((t) => t.tag)} />
        </>
      )}
    </Layout>
  );
}

export function SessionsPage({ auth, page }: { auth: AuthState; page: Page<SessionSummary> }) {
  return (
    <Layout title="Sessions" auth={auth}>
      <h1>Sessions</h1>
      <p class="muted">{plural(page.total, 'session')}</p>
      <div class="cards">
        {page.items.map((session) => (
          <SessionCard session={session} />
        ))}
      </div>
      <Pager page={page} href={withPage('/sessions', {})} />
    </Layout>
  );
}

export function SessionPage(props: {
  auth: AuthState;
  session: SessionSummary;
  sets: SetSummary[];
}) {
  const { auth, session, sets } = props;
  return (
    <Layout title={session.title} auth={auth}>
      <h1>
        {session.title}
        {session.hidden && <span class="badge warn">hidden</span>}
        {session.missing && <span class="badge warn">missing on disk</span>}
      </h1>
      <p class="muted">
        {formatDateTime(session.startedAt)} · #{session.channelName} · {plural(sets.length, 'set')}
      </p>
      {session.description && <p style="white-space: pre-line">{session.description}</p>}

      <div class="rows">
        {sets.map((set) => (
          <SetRow set={set} auth={auth} showSession={false} />
        ))}
      </div>
      {sets.length === 0 && <p class="muted">No sets to show.</p>}

      {auth.isAdmin && <EditSessionForm session={session} />}
    </Layout>
  );
}

export function SetPage(props: {
  auth: AuthState;
  set: SetSummary;
  previous: SetSummary | undefined;
  next: SetSummary | undefined;
}) {
  const { auth, set, previous, next } = props;
  return (
    <Layout title={`${set.name}${set.title ? ` · ${set.title}` : ''}`} auth={auth}>
      <div class="row" style="border: none; background: none; padding: 0">
        <Avatar url={set.avatarUrl} large />
        <div class="grow">
          <h1>
            <a href={`/streamers/${encodeURIComponent(set.userId)}`}>{set.name}</a>
            <SetBadges set={set} />
          </h1>
          {set.title && <div>{set.title}</div>}
          <div class="muted small">
            <a href={`/sessions/${encodeURIComponent(set.sessionId)}`}>{set.sessionTitle}</a> ·{' '}
            {formatDateTime(set.startedAt)}
            {set.durationSeconds !== undefined && ` · ${formatDuration(set.durationSeconds)}`}
          </div>
          <Tags tags={set.tags} />
        </div>
      </div>

      <Player set={set} />
      <Downloads set={set} />

      {set.description && (
        <>
          <h2>Notes</h2>
          <p style="white-space: pre-line">{set.description}</p>
        </>
      )}

      <nav class="pager" aria-label="Sets in this session">
        {previous ? (
          <a href={`/sets/${encodeURIComponent(previous.id)}`}>← {previous.name}</a>
        ) : (
          <span />
        )}
        {next ? <a href={`/sets/${encodeURIComponent(next.id)}`}>{next.name} →</a> : <span />}
      </nav>

      {auth.isAdmin && <EditSetForm set={set} />}
    </Layout>
  );
}

export function StreamersPage({
  auth,
  streamers,
}: {
  auth: AuthState;
  streamers: StreamerSummary[];
}) {
  return (
    <Layout title="Streamers" auth={auth}>
      <h1>Streamers</h1>
      <p class="muted">{plural(streamers.length, 'streamer')}</p>
      <div class="rows">
        {streamers.map((streamer) => (
          <StreamerRow streamer={streamer} />
        ))}
      </div>
    </Layout>
  );
}

export function StreamerPage(props: {
  auth: AuthState;
  streamer: StreamerSummary;
  sets: Page<SetSummary>;
}) {
  const { auth, streamer, sets } = props;
  return (
    <Layout title={streamer.name} auth={auth}>
      <div class="row" style="border: none; background: none; padding: 0">
        <Avatar url={streamer.avatarUrl} large />
        <div class="grow">
          <h1>{streamer.name}</h1>
          <div class="muted small">{plural(streamer.setCount, 'set')}</div>
        </div>
      </div>
      {streamer.bio && <p style="white-space: pre-line">{streamer.bio}</p>}
      {streamer.links.length > 0 && (
        <div class="actions">
          {streamer.links.map((link) => (
            <a href={link} rel="nofollow noopener" target="_blank">
              {new URL(link).hostname}
            </a>
          ))}
        </div>
      )}

      <h2>Sets</h2>
      <div class="rows">
        {sets.items.map((set) => (
          <SetRow set={set} auth={auth} />
        ))}
      </div>
      <Pager page={sets} href={withPage(`/streamers/${encodeURIComponent(streamer.userId)}`, {})} />

      {auth.isAdmin && <EditStreamerForm streamer={streamer} />}
    </Layout>
  );
}

export function SearchPage(props: {
  auth: AuthState;
  params: SearchParams;
  results: Page<SetSummary>;
  streamers: StreamerSummary[];
  tags: TagCount[];
}) {
  const { auth, params, results, streamers, tags } = props;
  const filters = {
    q: params.q,
    tag: params.tag,
    streamer: params.userId,
    from: params.from,
    to: params.to,
  };
  return (
    <Layout title="Search" auth={auth} query={params.q}>
      <h1>Search</h1>
      <form class="filters" action="/search" method="get">
        <label>
          Words
          <input type="search" name="q" value={params.q ?? ''} placeholder="DJ, title, notes…" />
        </label>
        <label>
          Streamer
          <select name="streamer">
            <option value="">Anyone</option>
            {streamers.map((s) => (
              <option value={s.userId} selected={s.userId === params.userId}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Tag
          <select name="tag">
            <option value="">Any</option>
            {tags.map((t) => (
              <option value={t.tag} selected={t.tag === params.tag}>
                {t.tag} ({t.count})
              </option>
            ))}
          </select>
        </label>
        <label>
          From
          <input type="date" name="from" value={params.from ?? ''} />
        </label>
        <label>
          To
          <input type="date" name="to" value={params.to ?? ''} />
        </label>
        <div>
          <button type="submit">Search</button>
        </div>
      </form>

      <p class="muted">{plural(results.total, 'result')}</p>
      <div class="rows">
        {results.items.map((set) => (
          <SetRow set={set} auth={auth} />
        ))}
      </div>
      <Pager page={results} href={withPage('/search', filters)} />
    </Layout>
  );
}

export function TagsPage({ auth, tags }: { auth: AuthState; tags: TagCount[] }) {
  return (
    <Layout title="Tags" auth={auth}>
      <h1>Tags</h1>
      {tags.length === 0 ? (
        <p class="muted">No tags yet.</p>
      ) : (
        <div class="tags">
          {tags.map((t) => (
            <a class="tag" href={`/search?tag=${encodeURIComponent(t.tag)}`}>
              {t.tag} <span class="muted">{t.count}</span>
            </a>
          ))}
        </div>
      )}
    </Layout>
  );
}

export function ActivityPage({ auth, entries }: { auth: AuthState; entries: AuditEntry[] }) {
  const link = (entry: AuditEntry): string =>
    `/${entry.entity === 'streamer' ? 'streamers' : `${entry.entity}s`}/${encodeURIComponent(entry.entityId)}`;
  return (
    <Layout title="Activity" auth={auth}>
      <h1>Edit activity</h1>
      <table>
        <thead>
          <tr>
            <th>When</th>
            <th>What</th>
            <th>Changes</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr>
              <td>{formatDateTime(entry.at)}</td>
              <td>
                <a href={link(entry)}>{entry.entity}</a>
              </td>
              <td>
                {Object.entries(entry.changes).map(([field, change]) => (
                  <div>
                    <strong>{field}</strong>: <code>{JSON.stringify(change.from)}</code> →{' '}
                    <code>{JSON.stringify(change.to)}</code>
                  </div>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {entries.length === 0 && <p class="muted">No edits yet.</p>}
    </Layout>
  );
}

export function LoginPage(props: { auth: AuthState; next: string; error?: string | undefined }) {
  const { auth, next, error } = props;
  return (
    <Layout title="Log in" auth={auth}>
      <h1>Log in</h1>
      <form class="stack" method="post" action="/login">
        <input type="hidden" name="next" value={next} />
        <label>
          Password
          <input
            type="password"
            name="password"
            required
            autofocus
            autocomplete="current-password"
          />
        </label>
        {error && <p class="error">{error}</p>}
        <div>
          <button type="submit">Log in</button>
        </div>
      </form>
    </Layout>
  );
}

export function NotFoundPage({ auth }: { auth: AuthState }) {
  return (
    <Layout title="Not found" auth={auth}>
      <h1>Not found</h1>
      <p>
        <a href="/">Back to the archive</a>
      </p>
    </Layout>
  );
}
