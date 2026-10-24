/**
 * The home page: hero, streamers, recent sessions, popular sets, and one searchable list
 * of every set. Sessions and streamers filter that list (`?session=`, `?streamer=`)
 * instead of having pages of their own; `/t/<uuid>` opens the list on one set.
 */
import type { AuthState } from '../auth/auth.ts';
import type { Page, SessionSummary, SetSummary, StreamerSummary } from '../catalog/catalog.ts';
import { gradient, initials } from './art.ts';
import { Downloads, mediaUrl } from './components.tsx';
import { formatDate, formatDuration, plural } from './format.ts';
import { Icon, Layout } from './layout.tsx';

export interface ListFilters {
  q?: string | undefined;
  sessionId?: string | undefined;
  userId?: string | undefined;
  page?: number | undefined;
}

export interface HomeData {
  sessions: { session: SessionSummary; sets: SetSummary[] }[];
  streamers: StreamerSummary[];
  popular: SetSummary[];
  list: Page<SetSummary>;
  filters: ListFilters;
  /** Names for the active filter chips. */
  filterLabels: { session?: string | undefined; streamer?: string | undefined };
  /** Opened from a shared `/t/<uuid>` link. */
  shared?: SetSummary | undefined;
}

/** `/?…` for a set of filters; `#sets` scrolls to the list. */
export function homeUrl(filters: ListFilters, hash = true): string {
  const params = new URLSearchParams();
  if (filters.q) params.set('q', filters.q);
  if (filters.sessionId) params.set('session', filters.sessionId);
  if (filters.userId) params.set('streamer', filters.userId);
  if (filters.page && filters.page > 1) params.set('page', String(filters.page));
  const query = params.toString();
  return `/${query ? `?${query}` : ''}${hash ? '#sets' : ''}`;
}

const totalSeconds = (sets: SetSummary[]): number =>
  sets.reduce((sum, set) => sum + (set.durationSeconds ?? 0), 0);

function Swatch({ seed, class: className }: { seed: string; class: string }) {
  return <div class={`art ${className}`} style={`background:${gradient(seed)}`} />;
}

/** A DJ's placeholder avatar: their gradient with initials. */
export function DjAvatar({
  userId,
  name,
  size = 'size-10',
}: {
  userId: string;
  name: string;
  size?: string;
}) {
  return (
    <div
      class={`${size} grid shrink-0 place-items-center rounded-full font-bold text-white/90 shadow`}
      style={`background:${gradient(userId)}`}
      title={name}
    >
      <span class="text-[0.7em] leading-none drop-shadow">{initials(name)}</span>
    </div>
  );
}

function Hero({ latest }: { latest: SessionSummary | undefined }) {
  return (
    <section class="relative overflow-hidden rounded-3xl bg-gradient-to-br from-teal-500 via-cyan-600 to-lime-300 p-6 text-white shadow-xl sm:p-10">
      <div class="absolute -top-16 -right-10 size-64 rounded-full bg-white/15 blur-2xl" />
      <div class="absolute -bottom-24 right-32 size-56 rounded-full bg-fuchsia-500/30 blur-3xl" />
      <div class="relative max-w-lg">
        <h1 class="text-3xl leading-tight font-extrabold sm:text-4xl">
          Every set from every disco, in one place.
        </h1>
        <p class="mt-3 text-white/85">
          Recordings of our Discord DJ sessions, levelled and ready to play. Search by DJ, session
          or title.
        </p>
        <div class="mt-6 flex flex-wrap gap-3">
          {latest && (
            <a
              class="btn rounded-xl border-0 bg-white/90 text-teal-900 hover:bg-white"
              href={homeUrl({ sessionId: latest.id })}
            >
              Latest session
            </a>
          )}
          <a
            class="btn btn-outline rounded-xl border-white/70 text-white hover:bg-white/15"
            href="#sets"
          >
            Browse all sets
          </a>
        </div>
      </div>
    </section>
  );
}

function StreamersRow({
  streamers,
  active,
}: {
  streamers: StreamerSummary[];
  active: string | undefined;
}) {
  if (streamers.length === 0) return null;
  return (
    <section class="mt-10">
      <h2 class="mb-4 text-xl font-bold">DJs</h2>
      <div class="flex gap-5 overflow-x-auto pb-2">
        {streamers.map((streamer) => (
          <a
            class="plain group flex w-20 shrink-0 flex-col items-center gap-2 text-center"
            href={homeUrl({ userId: streamer.userId })}
          >
            <div
              class={`rounded-full p-0.5 ${active === streamer.userId ? 'bg-primary' : 'group-hover:bg-base-content/30'}`}
            >
              <DjAvatar userId={streamer.userId} name={streamer.name} size="size-16 text-2xl" />
            </div>
            <span class="w-full truncate text-xs">{streamer.name}</span>
          </a>
        ))}
      </div>
    </section>
  );
}

function SessionCards({ sessions }: { sessions: HomeData['sessions'] }) {
  if (sessions.length === 0) return null;
  return (
    <section class="mt-10">
      <h2 class="mb-4 text-xl font-bold">Recent sessions</h2>
      <div class="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
        {sessions.map(({ session, sets }) => {
          const djs = [...new Map(sets.map((set) => [set.userId, set])).values()];
          return (
            <a
              class="plain panel group rounded-3xl p-3 transition hover:-translate-y-0.5"
              href={homeUrl({ sessionId: session.id })}
            >
              <div class="relative">
                <Swatch seed={session.id} class="h-32 rounded-2xl" />
                <span class="badge badge-sm absolute top-3 left-3 border-0 bg-black/40 text-white backdrop-blur">
                  {formatDate(session.startedAt)}
                </span>
              </div>
              <div class="px-2 pt-3 pb-1">
                <p class="truncate text-lg font-semibold">{session.title}</p>
                <div class="mt-2 flex items-center justify-between gap-2">
                  <div class="flex -space-x-2">
                    {djs.slice(0, 5).map((set) => (
                      <div class="ring-base-200 rounded-full ring-2">
                        <DjAvatar userId={set.userId} name={set.name} size="size-7 text-xs" />
                      </div>
                    ))}
                  </div>
                  <span class="text-base-content/60 text-sm">
                    {plural(session.visibleSets, 'set')} · {formatDuration(totalSeconds(sets))}
                  </span>
                </div>
              </div>
            </a>
          );
        })}
      </div>
    </section>
  );
}

function PopularSets({ sets }: { sets: SetSummary[] }) {
  if (sets.length === 0) return null;
  return (
    <section class="mt-10">
      <h2 class="mb-4 text-xl font-bold">Popular sets</h2>
      <div class="grid grid-cols-2 gap-4 md:grid-cols-4">
        {sets.map((set) => (
          <a
            class="plain panel rounded-3xl p-3 transition hover:-translate-y-0.5"
            href={`/t/${set.uuid}`}
          >
            <div class="relative">
              <Swatch seed={set.uuid} class="aspect-[4/3] rounded-2xl" />
              <span class="badge badge-sm absolute top-2 left-2 border-0 bg-black/40 text-white backdrop-blur">
                {plural(set.plays, 'play')}
              </span>
            </div>
            <div class="mt-3 flex items-center gap-2 px-1">
              <DjAvatar userId={set.userId} name={set.name} size="size-8 text-sm" />
              <div class="min-w-0">
                <p class="truncate font-semibold">{set.title ?? set.name}</p>
                <p class="text-base-content/60 truncate text-xs">
                  {set.sessionTitle} · {formatDuration(set.durationSeconds)}
                </p>
              </div>
            </div>
          </a>
        ))}
      </div>
    </section>
  );
}

/** One set in the list: a row that expands to play and download it. */
export function SetItem({
  set,
  auth,
  open = false,
}: {
  set: SetSummary;
  auth: AuthState;
  open?: boolean;
}) {
  const playable = set.files.mp3 ?? set.files.m4a ?? set.files.rawAudio;
  const format = set.files.mp3 ? 'mp3' : set.files.m4a ? 'm4a' : 'raw';
  return (
    <details class="panel group rounded-2xl" id={`set-${set.uuid}`} open={open}>
      <summary class="flex cursor-pointer list-none items-center gap-3 p-3">
        <Swatch seed={set.uuid} class="size-12 shrink-0 rounded-xl" />
        <div class="min-w-0 flex-1">
          <p class="truncate font-semibold">
            {set.title ?? set.name}
            {set.title && <span class="text-base-content/60 font-normal"> · {set.name}</span>}
            {set.status !== 'ready' && (
              <span class="badge badge-warning badge-sm ml-2">{set.status}</span>
            )}
            {set.partial && <span class="badge badge-ghost badge-sm ml-2">partial</span>}
            {set.unlisted && <span class="badge badge-error badge-sm ml-2">hidden</span>}
          </p>
          <p class="text-base-content/60 truncate text-sm">
            {set.sessionTitle} · {formatDate(set.sessionStartedAt)}
          </p>
        </div>
        <span class="text-base-content/60 hidden text-sm tabular-nums sm:block">
          {plural(set.plays, 'play')}
        </span>
        <span class="w-16 text-right text-sm tabular-nums">
          {formatDuration(set.durationSeconds)}
        </span>
      </summary>
      <div class="border-base-content/5 border-t p-3">
        {playable ? (
          <audio class="w-full" controls preload="none" src={mediaUrl(set.id, format)} />
        ) : (
          <p class="text-base-content/60 text-sm">Nothing to play yet.</p>
        )}
        {format === 'raw' && playable && (
          <p class="text-base-content/60 mt-1 text-xs">Raw capture, not levelled yet.</p>
        )}
        <div class="mt-2 flex flex-wrap items-center gap-2">
          <Downloads set={set} />
          <button type="button" class="btn btn-ghost btn-sm" data-copy={`/t/${set.uuid}`}>
            Copy link
          </button>
          {auth.isAdmin && (
            <a class="btn btn-ghost btn-sm" href={`/sets/${encodeURIComponent(set.id)}`}>
              Edit
            </a>
          )}
        </div>
      </div>
    </details>
  );
}

function FilterChip({ label, href }: { label: string; href: string }) {
  return (
    <a
      class="plain badge badge-primary badge-soft gap-1"
      href={href}
      aria-label={`Remove filter ${label}`}
    >
      {label} ✕
    </a>
  );
}

/** The searchable list; also returned alone for htmx updates (`HX-Target: set-list`). */
export function SetList({
  data,
  auth,
}: {
  data: Pick<HomeData, 'list' | 'filters' | 'filterLabels'>;
  auth: AuthState;
}) {
  const { list, filters, filterLabels } = data;
  const page = list.page;
  return (
    <div id="set-list">
      {(filterLabels.session ?? filterLabels.streamer ?? filters.q) !== undefined && (
        <div class="mb-3 flex flex-wrap items-center gap-2 text-sm">
          <span class="text-base-content/60">Showing</span>
          {filterLabels.session && (
            <FilterChip
              label={filterLabels.session}
              href={homeUrl({ ...filters, sessionId: undefined, page: 1 })}
            />
          )}
          {filterLabels.streamer && (
            <FilterChip
              label={filterLabels.streamer}
              href={homeUrl({ ...filters, userId: undefined, page: 1 })}
            />
          )}
          {filters.q && (
            <FilterChip
              label={`“${filters.q}”`}
              href={homeUrl({ ...filters, q: undefined, page: 1 })}
            />
          )}
        </div>
      )}
      <p class="text-base-content/60 mb-3 text-sm">{plural(list.total, 'set')}</p>
      <div class="flex flex-col gap-2">
        {list.items.map((set) => (
          <SetItem set={set} auth={auth} />
        ))}
      </div>
      {list.pages > 1 && (
        <div class="join mt-6 flex justify-center">
          {page > 1 && (
            <a class="btn join-item" href={homeUrl({ ...filters, page: page - 1 })}>
              « Newer
            </a>
          )}
          <span class="btn join-item btn-disabled">
            Page {page} of {list.pages}
          </span>
          {page < list.pages && (
            <a class="btn join-item" href={homeUrl({ ...filters, page: page + 1 })}>
              Older »
            </a>
          )}
        </div>
      )}
    </div>
  );
}

export function HomePage({ data, auth }: { data: HomeData; auth: AuthState }) {
  const { filters } = data;
  return (
    <Layout title="Home" auth={auth} query={filters.q}>
      <Hero latest={data.sessions[0]?.session} />
      <StreamersRow streamers={data.streamers} active={filters.userId} />
      <SessionCards sessions={data.sessions} />
      <PopularSets sets={data.popular} />
      <section class="mt-10 scroll-mt-6" id="sets">
        {data.shared && (
          <div class="mb-8">
            <h2 class="mb-4 text-xl font-bold">Shared with you</h2>
            <SetItem set={data.shared} auth={auth} open />
          </div>
        )}
        <div class="mb-4 flex flex-wrap items-end justify-between gap-3">
          <h2 class="text-xl font-bold">All sets</h2>
          <form
            class="ui w-full sm:w-72"
            action="/"
            method="get"
            hx-get="/"
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
                placeholder="Filter sets…"
                aria-label="Filter sets"
              />
            </label>
          </form>
        </div>
        <SetList data={data} auth={auth} />
      </section>
    </Layout>
  );
}
