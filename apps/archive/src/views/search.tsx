/**
 * `/search`: every set in one list, filtered by text, DJ (`?streamer=`) and session
 * (`?session=`). Typing re-fetches the page and htmx swaps in just the list.
 */
import type { AuthState } from '../auth/auth.ts';
import type { Page, SetSummary } from '../catalog/catalog.ts';
import { SetListRow } from './cards.tsx';
import { plural } from './format.ts';
import { Icon, Layout } from './layout.tsx';
import { searchUrl, type SearchFilters } from './links.ts';

export interface SearchData {
  list: Page<SetSummary>;
  filters: SearchFilters;
  /** Names for the active filter chips. */
  labels: { session?: string | undefined; streamer?: string | undefined };
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
          <SetListRow set={set} />
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
          class="ui w-full sm:w-80"
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
      <SetList data={data} />
    </Layout>
  );
}
