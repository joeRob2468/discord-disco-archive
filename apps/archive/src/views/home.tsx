/**
 * The home page: hero, DJs, recent sessions (albums) and popular sets. The full set list
 * and search live on `/search`; albums and sets have their own pages.
 */
import type { AuthState } from '../auth/auth.ts';
import type { SessionSummary, SetSummary, StreamerSummary } from '../catalog/catalog.ts';
import { setArt } from './art.ts';
import { Art, DjAvatar } from './cards.tsx';
import { formatDate, formatDuration, plural } from './format.ts';
import { Layout } from './layout.tsx';
import { searchUrl, sessionUrl, setUrl } from './links.ts';
import { PlayButton, queueOf } from './play.tsx';

export interface Album {
  session: SessionSummary;
  sets: SetSummary[];
}

export interface HomeData {
  albums: Album[];
  streamers: StreamerSummary[];
  popular: SetSummary[];
}

export const totalSeconds = (sets: SetSummary[]): number =>
  sets.reduce((sum, set) => sum + (set.durationSeconds ?? 0), 0);

/** Each DJ once, in order of first appearance. */
export const djsOf = (sets: SetSummary[]): SetSummary[] => [
  ...new Map(sets.map((set) => [set.userId, set])).values(),
];

function Hero({ latest }: { latest: SessionSummary | undefined }) {
  return (
    <section class="relative overflow-hidden rounded-3xl bg-gradient-to-br from-teal-500 via-cyan-600 to-lime-300 p-6 text-white shadow-xl sm:p-10">
      <div class="absolute -top-16 -right-10 size-64 rounded-full bg-white/15 blur-2xl" />
      <div class="absolute right-32 -bottom-24 size-56 rounded-full bg-fuchsia-500/30 blur-3xl" />
      <div class="relative max-w-lg">
        <h1 class="text-3xl leading-tight font-extrabold sm:text-4xl">
          Every set from every disco, in one place.
        </h1>
        <p class="mt-3 text-white/85">
          Recordings of our Discord DJ sessions, leveled and ready to play.
        </p>
        <div class="mt-6 flex flex-wrap gap-3">
          {latest && (
            <a
              class="btn rounded-xl border-0 bg-white/90 text-teal-900 hover:bg-white"
              href={sessionUrl(latest.id)}
            >
              Latest session
            </a>
          )}
          <a
            class="btn btn-outline rounded-xl border-white/70 text-white hover:bg-white/15"
            href="/search"
          >
            Browse all sets
          </a>
        </div>
      </div>
    </section>
  );
}

function StreamersRow({ streamers }: { streamers: StreamerSummary[] }) {
  if (streamers.length === 0) return null;
  return (
    <section class="mt-10">
      <h2 class="mb-4 text-xl font-bold">DJs</h2>
      <div class="flex gap-5 overflow-x-auto pb-2">
        {streamers.map((streamer) => (
          <a
            class="plain group flex w-20 shrink-0 flex-col items-center gap-2 text-center"
            href={searchUrl({ userId: streamer.userId })}
          >
            <div class="group-hover:bg-base-content/30 rounded-full p-0.5">
              <DjAvatar
                userId={streamer.userId}
                name={streamer.name}
                image={streamer.image}
                size="size-16 text-2xl"
              />
            </div>
            <span class="w-full truncate text-xs">{streamer.name}</span>
          </a>
        ))}
      </div>
    </section>
  );
}

export function AlbumCard({ album }: { album: Album }) {
  const { session, sets } = album;
  return (
    <a
      class="plain panel rounded-3xl p-3 transition hover:-translate-y-0.5"
      href={sessionUrl(session.id)}
    >
      <div class="relative">
        <Art seed={session.id} image={session.image} class="aspect-[16/9] rounded-2xl" />
        <span class="badge badge-sm absolute top-3 left-3 border-0 bg-black/40 text-white backdrop-blur">
          {formatDate(session.startedAt)}
        </span>
      </div>
      <div class="px-2 pt-3 pb-1">
        <p class="truncate text-lg font-semibold">{session.title}</p>
        <div class="mt-2 flex items-center justify-between gap-2">
          <div class="flex -space-x-2">
            {djsOf(sets)
              .slice(0, 5)
              .map((set) => (
                <div class="ring-base-200 rounded-full ring-2">
                  <DjAvatar
                    userId={set.userId}
                    name={set.name}
                    image={set.streamerImage}
                    size="size-7 text-xs"
                  />
                </div>
              ))}
          </div>
          <span class="text-base-content/60 text-sm">
            {plural(sets.length, 'set')} · {formatDuration(totalSeconds(sets))}
          </span>
        </div>
      </div>
    </a>
  );
}

function PopularSets({ sets }: { sets: SetSummary[] }) {
  if (sets.length === 0) return null;
  const queue = queueOf(sets);
  return (
    <section class="mt-10">
      <h2 class="mb-4 text-xl font-bold">Popular sets</h2>
      <div class="grid grid-cols-2 gap-4 md:grid-cols-4">
        {sets.map((set) => (
          // The play button sits beside the card's link, not in it (no buttons inside links).
          <div
            class="panel group relative rounded-3xl p-3 transition hover:-translate-y-0.5"
            data-track-uuid={set.uuid}
          >
            <a class="plain block" href={setUrl(set)}>
              <div class="relative">
                <Art seed={set.uuid} image={setArt(set)} class="aspect-[4/3] rounded-2xl" />
                <span class="badge badge-sm absolute top-2 left-2 border-0 bg-black/50 text-white">
                  {plural(set.plays, 'play')}
                </span>
              </div>
              <div class="mt-3 flex items-center gap-2 px-1">
                <DjAvatar
                  userId={set.userId}
                  name={set.name}
                  image={set.streamerImage}
                  size="size-8 text-sm"
                />
                <div class="min-w-0">
                  <p class="playing-title truncate font-semibold">{set.title ?? set.name}</p>
                  <p class="text-base-content/60 truncate text-xs">
                    {set.sessionTitle} · {formatDuration(set.durationSeconds)}
                  </p>
                </div>
              </div>
            </a>
            <div class="absolute top-5 right-5 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
              <PlayButton
                queue={queue}
                startUuid={set.uuid}
                label={`Play ${set.title ?? set.name}`}
                class="btn btn-circle btn-primary shadow-lg"
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function HomePage({ data, auth }: { data: HomeData; auth: AuthState }) {
  return (
    <Layout title="Home" auth={auth}>
      <Hero latest={data.albums[0]?.session} />
      <StreamersRow streamers={data.streamers} />
      {data.albums.length > 0 && (
        <section class="mt-10">
          <div class="mb-4 flex items-baseline justify-between">
            <h2 class="text-xl font-bold">Recent sessions</h2>
            <a class="text-sm" href="/sessions">
              All sessions →
            </a>
          </div>
          <div class="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
            {data.albums.map((album) => (
              <AlbumCard album={album} />
            ))}
          </div>
        </section>
      )}
      <PopularSets sets={data.popular} />
    </Layout>
  );
}
