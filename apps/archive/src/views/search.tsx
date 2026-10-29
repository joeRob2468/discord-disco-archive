/**
 * `/search`: every set in one list, filtered by text, DJ (`?streamer=`) and session
 * (`?session=`). Typing re-fetches the page and htmx swaps in just the list.
 */
import type { AuthState } from '../auth/auth.ts';
import type { Page, SetSummary, StreamerSummary } from '../catalog/catalog.ts';
import { DjAvatar, SetListRow } from './cards.tsx';
import { EditButton, EditStreamerDialog } from './edit.tsx';
import { formatDate, formatDuration, plural } from './format.ts';
import { Icon, Layout } from './layout.tsx';
import { searchUrl, type SearchFilters } from './links.ts';
import { queueOf } from './play.tsx';

export interface SearchData {
  list: Page<SetSummary>;
  filters: SearchFilters;
  /** Names for the active filter chips. */
  labels: { session?: string | undefined; streamer?: string | undefined };
  /** The DJ filtered on, shown above the list. */
  streamer?: StreamerSummary | undefined;
}

/** A DJ's picture, bio, links and totals, when the list is filtered to them. */
function DjHeader(props: { streamer: StreamerSummary; auth: AuthState; next: string }) {
  const { streamer, auth, next } = props;
  return (
    <section class="panel mb-6 flex flex-col gap-4 rounded-3xl p-5 sm:flex-row sm:items-center">
      <DjAvatar
        userId={streamer.userId}
        name={streamer.name}
        image={streamer.image ?? streamer.avatarImage}
        size="size-24 text-3xl"
      />
      <div class="min-w-0 flex-1">
        <p class="text-base-content/60 text-xs font-semibold tracking-widest uppercase">DJ</p>
        <h2 class="text-2xl font-extrabold break-words">{streamer.name}</h2>
        <p class="text-base-content/60 mt-1 text-sm">
          {plural(streamer.setCount, 'set')} · {formatDuration(streamer.totalSeconds)} played
          {streamer.firstPlayedAt && ` · since ${formatDate(streamer.firstPlayedAt)}`}
        </p>
        {streamer.bio && <p class="mt-2 max-w-prose whitespace-pre-line">{streamer.bio}</p>}
        {streamer.links.length > 0 && (
          <div class="mt-2 flex flex-wrap gap-2">
            {streamer.links.map((link) => (
              <a
                class="btn btn-soft btn-xs"
                href={link}
                rel="nofollow noopener noreferrer"
                target="_blank"
                hx-boost="false"
              >
                {new URL(link).hostname}
              </a>
            ))}
          </div>
        )}
      </div>
      {auth.isAdmin && (
        <>
          <EditButton kind="streamer" id={streamer.userId} />
          <EditStreamerDialog streamer={streamer} next={next} />
        </>
      )}
    </section>
  );
}

function FilterChip({ label, href }: { label: string; href: string }) {
  return (
    <a
      class="plain badge badge-primary badge-soft gap-1"
      href={href}
      aria-label={`Remove ${label}`}
    >
      {label} ✕
    </a>
  );
}

function SetList({ data }: { data: SearchData }) {
  const { list, filters, labels } = data;
  const queue = queueOf(list.items);
  return (
    <div id="set-list">
      <div class="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <span class="text-base-content/60">{plural(list.total, 'set')}</span>
        {labels.session && (
          <FilterChip
            label={labels.session}
            href={searchUrl({ ...filters, sessionId: undefined, page: 1 })}
          />
        )}
        {labels.streamer && (
          <FilterChip
            label={labels.streamer}
            href={searchUrl({ ...filters, userId: undefined, page: 1 })}
          />
        )}
      </div>
      <div class="flex flex-col gap-2">
        {list.items.map((set) => (
          <SetListRow set={set} queue={queue} />
        ))}
      </div>
      {list.total === 0 && <p class="text-base-content/60 py-8 text-center">No sets match.</p>}
      {list.pages > 1 && (
        <div class="join mt-6 flex justify-center">
          {list.page > 1 && (
            <a class="btn join-item" href={searchUrl({ ...filters, page: list.page - 1 })}>
              « Newer
            </a>
          )}
          <span class="btn join-item btn-disabled">
            Page {list.page} of {list.pages}
          </span>
          {list.page < list.pages && (
            <a class="btn join-item" href={searchUrl({ ...filters, page: list.page + 1 })}>
              Older »
            </a>
          )}
        </div>
      )}
    </div>
  );
}

export function SearchPage({ data, auth }: { data: SearchData; auth: AuthState }) {
  const { filters } = data;
  return (
    <Layout title="All sets" auth={auth} query={filters.q}>
      <div class="mb-6 flex flex-wrap items-end justify-between gap-3">
        <h1 class="text-2xl font-bold">All sets</h1>
        <form
          class="w-full sm:w-80"
          action="/search"
          method="get"
          hx-get="/search"
          hx-target="#set-list"
          hx-select="#set-list"
          hx-swap="outerHTML"
          hx-push-url="true"
          hx-trigger="input changed delay:300ms from:find input[type=search], submit"
        >
          {filters.sessionId && <input type="hidden" name="session" value={filters.sessionId} />}
          {filters.userId && <input type="hidden" name="streamer" value={filters.userId} />}
          <label class="input panel w-full rounded-xl border-0">
            <Icon name="search" class="size-4 opacity-60" />
            <input
              class="grow"
              type="search"
              name="q"
              value={filters.q ?? ''}
              placeholder="Filter by DJ, title, session…"
              aria-label="Filter sets"
            />
          </label>
        </form>
      </div>
      {data.streamer && <DjHeader streamer={data.streamer} auth={auth} next={searchUrl(filters)} />}
      <SetList data={data} />
    </Layout>
  );
}
