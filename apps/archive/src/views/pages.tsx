/**
 * Full pages. Each takes already-loaded data; routes do the loading.
 */
import type { AuthState } from '../auth/auth.ts';
import type {
  AuditEntry,
  Page,
  SessionSummary,
  SetSummary,
  StreamerSummary,
  TagCount,
} from '../catalog/catalog.ts';
import {
  Avatar,
  EditStreamerForm,
  Pager,
  SessionCard,
  SetRow,
  StreamerRow,
} from './components.tsx';
import { formatDateTime, plural } from './format.ts';
import { BareLayout, Layout } from './layout.tsx';

const withPage = (base: string, params: Record<string, string | undefined>) => (page: number) => {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) query.set(key, value);
  query.set('page', String(page));
  return `${base}?${query.toString()}`;
};

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

export function LoginPage(props: { next: string; error?: string | undefined }) {
  const { next, error } = props;
  return (
    <BareLayout title="Log in">
      <div class="w-full max-w-sm">
        <div class="card panel w-full rounded-3xl">
          <form class="ui card-body gap-4" method="post" action="/login">
            <div>
              <h1 class="card-title text-2xl">Stream Archive</h1>
              <p class="text-base-content/60 text-sm">Enter the password to continue.</p>
            </div>
            <input type="hidden" name="next" value={next} />
            <label class="input w-full">
              <svg
                class="size-4 opacity-60"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <rect x="4" y="11" width="16" height="10" rx="2" />
                <path d="M8 11V7a4 4 0 0 1 8 0v4" />
              </svg>
              <input
                class="grow"
                type="password"
                name="password"
                placeholder="Password"
                aria-label="Password"
                required
                autofocus
                autocomplete="current-password"
              />
            </label>
            {error && (
              <div role="alert" class="alert alert-error alert-soft text-sm">
                {error}
              </div>
            )}
            <button class="btn btn-primary w-full" type="submit">
              Log in
            </button>
          </form>
        </div>
      </div>
    </BareLayout>
  );
}

/** A short message with a way back, e.g. a failed upload. */
export function MessagePage(props: { auth: AuthState; title: string; message: string }) {
  return (
    <Layout title={props.title} auth={props.auth}>
      <div class="panel mx-auto max-w-md rounded-3xl p-6">
        <h1 class="text-xl font-bold">{props.title}</h1>
        <p class="text-base-content/70 mt-2">{props.message}</p>
        <button class="btn btn-ghost mt-4" type="button" onclick="history.back()">
          ← Back
        </button>
      </div>
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
