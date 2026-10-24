/**
 * Album and set pages. A session is presented as an album: cover, DJs and a numbered
 * tracklist of its sets. Each set has its own page under its session.
 */
import type { AuthState } from '../auth/auth.ts';
import type { SetSummary, StreamerSummary } from '../catalog/catalog.ts';
import { setArt } from './art.ts';
import { Art, DjAvatar, SetListRow, StatusBadges } from './cards.tsx';
import { Downloads } from './components.tsx';
import { EditButton, EditSessionDialog, EditSetDialog, EditStreamerDialog } from './edit.tsx';
import { formatDate, formatDateTime, formatDuration, plural } from './format.ts';
import { djsOf, totalSeconds, type Album } from './home.tsx';
import { Layout } from './layout.tsx';
import { PlayButton, queueOf } from './play.tsx';
import { searchUrl, sessionUrl, setUrl } from './links.ts';

export function AlbumPage({ album, auth }: { album: Album; auth: AuthState }) {
  const { session, sets } = album;
  const djs = djsOf(sets);
  const queue = queueOf(sets);
  return (
    <Layout title={session.title} auth={auth}>
      <section class="panel flex flex-col gap-6 rounded-3xl p-5 sm:flex-row sm:items-end sm:p-6">
        <Art
          seed={session.id}
          image={session.image}
          class="aspect-square w-full shrink-0 rounded-2xl shadow-2xl sm:w-56"
        />
        <div class="min-w-0">
          <p class="text-base-content/60 text-xs font-semibold tracking-widest uppercase">
            Session
          </p>
          <h1 class="mt-1 text-3xl font-extrabold break-words sm:text-4xl">
            {session.title}
            {session.hidden && (
              <span class="badge badge-error badge-sm ml-2 align-middle">hidden</span>
            )}
          </h1>
          <div class="mt-3 flex flex-wrap items-center gap-3">
            <div class="flex -space-x-2">
              {djs.slice(0, 6).map((set) => (
                <div class="ring-base-200 rounded-full ring-2">
                  <DjAvatar
                    userId={set.userId}
                    name={set.name}
                    image={set.streamerImage}
                    size="size-8 text-xs"
                  />
                </div>
              ))}
            </div>
            <p class="text-base-content/70 text-sm">{djs.map((set) => set.name).join(', ')}</p>
          </div>
          <p class="text-base-content/60 mt-2 text-sm">
            {formatDate(session.startedAt)} · {plural(sets.length, 'set')} ·{' '}
            {formatDuration(totalSeconds(sets))}
          </p>
          {session.description && (
            <p class="mt-3 max-w-prose whitespace-pre-line">{session.description}</p>
          )}
          <div class="mt-5 flex flex-wrap gap-2">
            <PlayButton
              queue={queue}
              label="Play all"
              text="Play all"
              class="btn btn-primary rounded-xl"
            />
            <button
              class="btn btn-ghost rounded-xl"
              type="button"
              data-copy={sessionUrl(session.id)}
            >
              Copy link
            </button>
            {auth.isAdmin && (
              <EditButton kind="session" id={session.id} class="btn btn-ghost rounded-xl" />
            )}
          </div>
        </div>
      </section>

      <section class="mt-8">
        <h2 class="mb-3 text-xl font-bold">Sets</h2>
        <div class="flex flex-col gap-2">
          {sets.map((set, index) => (
            <SetListRow set={set} queue={queue} number={index + 1} />
          ))}
        </div>
      </section>

      {auth.isAdmin && <EditSessionDialog session={session} next={sessionUrl(session.id)} />}
    </Layout>
  );
}

export function SetDetailPage(props: {
  auth: AuthState;
  set: SetSummary;
  /** Every set in the album, in order: playing continues through them. */
  albumSets: SetSummary[];
  previous: SetSummary | undefined;
  next: SetSummary | undefined;
  /** The set's DJ, for admins' Edit DJ dialog. */
  streamer?: StreamerSummary | undefined;
}) {
  const { auth, set, albumSets, previous, next, streamer } = props;
  const queue = queueOf(albumSets);
  const playable = queue.some((track) => track.uuid === set.uuid);
  const raw = !set.files.mp3 && !set.files.m4a && set.files.rawAudio !== undefined;
  return (
    <Layout title={`${set.title ?? set.name} · ${set.sessionTitle}`} auth={auth}>
      <section class="panel flex flex-col gap-6 rounded-3xl p-5 sm:flex-row sm:items-end sm:p-6">
        <Art
          seed={set.uuid}
          image={setArt(set)}
          class="aspect-square w-full shrink-0 rounded-2xl shadow-2xl sm:w-56"
        />
        <div class="min-w-0 flex-1">
          <p class="text-base-content/60 text-xs font-semibold tracking-widest uppercase">
            Set{' '}
            <a class="normal-case" href={sessionUrl(set.sessionId)}>
              from {set.sessionTitle}
            </a>
          </p>
          <h1 class="mt-1 text-3xl font-extrabold break-words sm:text-4xl">
            {set.title ?? set.name}
            <StatusBadges set={set} />
          </h1>
          <a class="plain mt-3 flex items-center gap-2" href={searchUrl({ userId: set.userId })}>
            <DjAvatar
              userId={set.userId}
              name={set.name}
              image={set.streamerImage}
              size="size-8 text-xs"
            />
            <span class="font-semibold">{set.name}</span>
          </a>
          <p class="text-base-content/60 mt-2 text-sm">
            {formatDateTime(set.startedAt)} · {formatDuration(set.durationSeconds)} ·{' '}
            {plural(set.plays, 'play')}
          </p>
          <div class="mt-4 flex flex-wrap items-center gap-2">
            {playable ? (
              <PlayButton
                queue={queue}
                startUuid={set.uuid}
                label="Play"
                text="Play"
                class="btn btn-primary rounded-xl"
              />
            ) : (
              <p class="text-base-content/60 text-sm">Nothing to play yet.</p>
            )}
            <button class="btn btn-ghost btn-sm" type="button" data-copy={setUrl(set)}>
              Copy link
            </button>
            {auth.isAdmin && (
              <>
                <EditButton kind="set" id={set.id} label="Edit set" />
                {streamer && <EditButton kind="streamer" id={set.userId} label="Edit DJ" />}
              </>
            )}
          </div>
          {raw && <p class="text-base-content/60 mt-2 text-xs">Raw capture, not leveled yet.</p>}
          <div class="mt-3">
            <Downloads set={set} />
          </div>
        </div>
      </section>

      {set.description && <p class="mt-6 max-w-prose whitespace-pre-line">{set.description}</p>}

      <nav class="mt-6 grid gap-2 sm:grid-cols-2" aria-label="Other sets in this session">
        {previous ? (
          <a class="plain panel rounded-2xl p-3 text-sm" href={setUrl(previous)}>
            ← Previous: <strong>{previous.title ?? previous.name}</strong>
          </a>
        ) : (
          <span />
        )}
        {next && (
          <a class="plain panel rounded-2xl p-3 text-right text-sm" href={setUrl(next)}>
            Next: <strong>{next.title ?? next.name}</strong> →
          </a>
        )}
      </nav>

      {auth.isAdmin && <EditSetDialog set={set} next={setUrl(set)} />}
      {auth.isAdmin && streamer && <EditStreamerDialog streamer={streamer} next={setUrl(set)} />}
    </Layout>
  );
}
