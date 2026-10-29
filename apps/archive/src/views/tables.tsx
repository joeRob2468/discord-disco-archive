/**
 * Stats tables: sessions and DJs, sortable by any column. Sorting is a plain link
 * (`?sort=&dir=`), swapped in by hx-boost. Admins also get edit buttons per row.
 */
import type { Child } from 'hono/jsx';
import type { AuthState } from '../auth/auth.ts';
import type {
  SessionSort,
  SessionStats,
  Sort,
  SortDir,
  StreamerSort,
  StreamerSummary,
} from '../catalog/catalog.ts';
import { Art, DjAvatar } from './cards.tsx';
import { EditButton, EditSessionDialog, EditStreamerDialog } from './edit.tsx';
import { formatDate, formatDuration, plural } from './format.ts';
import { Layout } from './layout.tsx';
import { searchUrl, sessionUrl } from './links.ts';

/** `base?key=value…`, leaving out empty values. */
export function withQuery(base: string, params: Record<string, string | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) query.set(key, value);
  const text = query.toString();
  return text ? `${base}?${text}` : base;
}

/** Text columns sort A→Z first; numbers and dates biggest or newest first. */
export const naturalDir =
  (textKeys: readonly string[]) =>
  (key: string): SortDir =>
    textKeys.includes(key) ? 'asc' : 'desc';

/**
 * A column header that sorts by `by`; clicking the active column flips the direction.
 * `href` builds the URL for a sort, keeping the page's other filters.
 */
export function SortHeader<K extends string>(props: {
  label: string;
  by: K;
  sort: Sort<K>;
  href: (sort: Sort<K>) => string;
  defaultDir: (key: K) => SortDir;
  class?: string;
}) {
  const { label, by, sort, href, defaultDir } = props;
  const active = sort.by === by;
  const dir: SortDir = active ? (sort.dir === 'asc' ? 'desc' : 'asc') : defaultDir(by);
  return (
    <th class={props.class} aria-sort={active ? `${sort.dir}ending` : undefined}>
      <a
        class="plain hover:text-base-content inline-flex items-center gap-1"
        href={href({ by, dir })}
      >
        {label}
        {active && <span aria-hidden="true">{sort.dir === 'asc' ? '▲' : '▼'}</span>}
      </a>
    </th>
  );
}

/** A table in a panel, scrolling sideways on narrow screens. */
export function TablePanel({ children }: { children?: Child }) {
  return (
    <div class="panel overflow-x-auto rounded-3xl">
      <table class="table">{children}</table>
    </div>
  );
}

const SESSION_TEXT = ['title'];
export const sessionDefaultDir = naturalDir(SESSION_TEXT);

export function SessionsPage(props: {
  auth: AuthState;
  sessions: SessionStats[];
  sort: Sort<SessionSort>;
}) {
  const { auth, sessions, sort } = props;
  const href = (s: Sort<SessionSort>) => withQuery('/sessions', { sort: s.by, dir: s.dir });
  const current = href(sort);
  const header = (label: string, by: SessionSort, className?: string) => (
    <SortHeader
      label={label}
      by={by}
      sort={sort}
      href={href}
      defaultDir={sessionDefaultDir}
      class={className}
    />
  );
  return (
    <Layout title="Sessions" auth={auth}>
      <div class="mb-4 flex items-baseline justify-between gap-3">
        <h1 class="text-2xl font-bold">Sessions</h1>
        <span class="text-base-content/60 text-sm">{plural(sessions.length, 'session')}</span>
      </div>
      <TablePanel>
        <thead>
          <tr>
            {header('Session', 'title')}
            {header('Date', 'date')}
            {header('DJs', 'djs', 'text-right')}
            {header('Sets', 'sets', 'text-right')}
            {header('Length', 'length', 'text-right')}
            {header('Downloads', 'downloads', 'text-right')}
            {auth.isAdmin && <th />}
          </tr>
        </thead>
        <tbody>
          {sessions.map(({ session, sets, djs, seconds, downloads }) => (
            <tr class="hover:bg-base-100/60">
              <td>
                <a class="plain flex items-center gap-3" href={sessionUrl(session.id)}>
                  <Art
                    seed={session.id}
                    image={session.image}
                    class="size-10 shrink-0 rounded-lg"
                  />
                  <span class="font-semibold">{session.title}</span>
                  {session.unlisted && <span class="badge badge-error badge-sm">archived</span>}
                </a>
              </td>
              <td class="whitespace-nowrap">{formatDate(session.startedAt)}</td>
              <td class="text-right tabular-nums">{djs}</td>
              <td class="text-right tabular-nums">{sets}</td>
              <td class="text-right tabular-nums">{formatDuration(seconds)}</td>
              <td class="text-right tabular-nums">{downloads}</td>
              {auth.isAdmin && (
                <td class="text-right">
                  <EditButton kind="session" id={session.id} />
                  <EditSessionDialog session={session} next={current} />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </TablePanel>
      {sessions.length === 0 && (
        <p class="text-base-content/60 py-8 text-center">No sessions yet.</p>
      )}
    </Layout>
  );
}

const STREAMER_TEXT = ['name'];
export const streamerDefaultDir = naturalDir(STREAMER_TEXT);

export function DjsPage(props: {
  auth: AuthState;
  streamers: StreamerSummary[];
  sort: Sort<StreamerSort>;
}) {
  const { auth, streamers, sort } = props;
  const href = (s: Sort<StreamerSort>) => withQuery('/djs', { sort: s.by, dir: s.dir });
  const current = href(sort);
  const header = (label: string, by: StreamerSort, className?: string) => (
    <SortHeader
      label={label}
      by={by}
      sort={sort}
      href={href}
      defaultDir={streamerDefaultDir}
      class={className}
    />
  );
  return (
    <Layout title="DJs" auth={auth}>
      <div class="mb-4 flex items-baseline justify-between gap-3">
        <h1 class="text-2xl font-bold">DJs</h1>
        <span class="text-base-content/60 text-sm">{plural(streamers.length, 'DJ')}</span>
      </div>
      <TablePanel>
        <thead>
          <tr>
            {header('DJ', 'name')}
            {header('Sets', 'sets', 'text-right')}
            {header('Time played', 'length', 'text-right')}
            {header('First set', 'first')}
            {header('Latest set', 'last')}
            {header('Downloads', 'downloads', 'text-right')}
            {auth.isAdmin && <th />}
          </tr>
        </thead>
        <tbody>
          {streamers.map((streamer) => (
            <tr class="hover:bg-base-100/60">
              <td>
                <a
                  class="plain flex items-center gap-3"
                  href={searchUrl({ userId: streamer.userId })}
                >
                  <DjAvatar
                    userId={streamer.userId}
                    name={streamer.name}
                    image={streamer.image ?? streamer.avatarImage}
                    size="size-10 text-sm"
                  />
                  <span class="font-semibold">{streamer.name}</span>
                </a>
              </td>
              <td class="text-right tabular-nums">{streamer.setCount}</td>
              <td class="text-right tabular-nums">{formatDuration(streamer.totalSeconds)}</td>
              <td class="whitespace-nowrap">
                {streamer.firstPlayedAt && formatDate(streamer.firstPlayedAt)}
              </td>
              <td class="whitespace-nowrap">
                {streamer.lastPlayedAt && formatDate(streamer.lastPlayedAt)}
              </td>
              <td class="text-right tabular-nums">{streamer.downloads}</td>
              {auth.isAdmin && (
                <td class="text-right">
                  <EditButton kind="streamer" id={streamer.userId} />
                  <EditStreamerDialog streamer={streamer} next={current} />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </TablePanel>
      {streamers.length === 0 && <p class="text-base-content/60 py-8 text-center">No DJs yet.</p>}
    </Layout>
  );
}
