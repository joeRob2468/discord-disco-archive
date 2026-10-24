/**
 * Album and set pages. A session is presented as an album: cover, DJs and a numbered
 * tracklist of its sets. Each set has its own page under its session.
 */
import type { AuthState } from '../auth/auth.ts';
import type { Child } from 'hono/jsx';
import type { SessionSummary, SetSummary, StreamerSummary } from '../catalog/catalog.ts';
import type { Track } from '../client/track.ts';
import { setArt } from './art.ts';
import { Art, DjAvatar, SetListRow, StatusBadges } from './cards.tsx';
import { Downloads } from './components.tsx';
import { EditButton, EditSessionDialog, EditSetDialog, EditStreamerDialog } from './edit.tsx';
import { formatDate, formatDateTime, formatDuration, plural } from './format.ts';
import { djsOf, totalSeconds, type Album } from './home.tsx';
import { Layout } from './layout.tsx';
import { PlayButton, QueueButton, queueOf } from './play.tsx';
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

/** The set's album as a card: cover, title, DJs and its tracklist, with this set marked. */
function SessionCard(props: {
  session: SessionSummary;
  sets: SetSummary[];
  queue: Track[];
  currentUuid: string;
}) {
  const { session, sets, queue, currentUuid } = props;
  const djs = djsOf(sets);
  return (
    <section class="panel mt-8 rounded-3xl p-4 sm:p-5">
      <div class="flex flex-wrap items-center gap-4">
        <a class="plain" href={sessionUrl(session.id)}>
          <Art seed={session.id} image={session.image} class="size-20 rounded-2xl shadow-lg" />
        </a>
        <div class="min-w-0 flex-1">
          <p class="text-base-content/60 text-xs font-semibold tracking-widest uppercase">
            From the session
          </p>
          <a class="plain text-xl font-bold hover:underline" href={sessionUrl(session.id)}>
            {session.title}
          </a>
          <p class="text-base-content/60 text-sm">
            {formatDate(session.startedAt)} · {plural(sets.length, 'set')} ·{' '}
            {formatDuration(totalSeconds(sets))} · {djs.map((set) => set.name).join(', ')}
          </p>
        </div>
        <div class="flex gap-2">
          <PlayButton
            queue={queue}
            label="Play all"
            text="Play all"
            class="btn btn-primary btn-sm rounded-xl"
          />
          <QueueButton
            tracks={queue}
            label="Add all to queue"
            class="btn btn-ghost btn-sm rounded-xl"
            text="Queue all"
          />
        </div>
      </div>
      <div class="mt-4 flex flex-col gap-2">
        {sets.map((other, index) => (
          <SetListRow
            set={other}
            queue={queue}
            number={index + 1}
            current={other.uuid === currentUuid}
          />
        ))}
      </div>
    </section>
  );
}

/** Play, queue, copy and download buttons for one set, shared by its page and inline view. */
function SetActions(props: { set: SetSummary; queue: Track[]; children?: Child }) {
  const { set, queue } = props;
  const track = queue.find((t) => t.uuid === set.uuid);
  const raw = !set.files.mp3 && !set.files.m4a && set.files.rawAudio !== undefined;
  return (
    <>
      <div class="flex flex-wrap items-center gap-2">
        {track ? (
          <>
            <PlayButton
              queue={queue}
              startUuid={set.uuid}
              label="Play"
              text="Play"
              class="btn btn-primary rounded-xl"
            />
            <QueueButton tracks={[track]} class="btn btn-ghost rounded-xl" text="Add to queue" />
          </>
        ) : (
          <p class="text-base-content/60 text-sm">Nothing to play yet.</p>
        )}
        <button class="btn btn-ghost btn-sm" type="button" data-copy={setUrl(set)}>
          Copy link
        </button>
        {props.children}
      </div>
      {raw && <p class="text-base-content/60 mt-2 text-xs">Raw capture, not leveled yet.</p>}
      <div class="mt-3">
        <Downloads set={set} />
      </div>
    </>
  );
}

export function SetDetailPage(props: {
  auth: AuthState;
  set: SetSummary;
  session: SessionSummary;
  /** Every set in the album, in order: playing continues through them. */
  albumSets: SetSummary[];
  previous: SetSummary | undefined;
  next: SetSummary | undefined;
  /** The set's DJ, for admins' Edit DJ dialog. */
  streamer?: StreamerSummary | undefined;
}) {
  const { auth, set, session, albumSets, previous, next, streamer } = props;
  const queue = queueOf(albumSets);
  return (
    <Layout title={`${set.title ?? set.name} · ${set.sessionTitle}`} auth={auth}>
      <section class="panel flex flex-col gap-6 rounded-3xl p-5 sm:flex-row sm:items-end sm:p-6">
        <Art
          seed={set.uuid}
          image={setArt(set)}
          class="aspect-square w-full shrink-0 rounded-2xl shadow-2xl sm:w-56"
        />
        <div class="min-w-0 flex-1">
          <div class="flex items-center justify-between gap-2">
            <p class="text-base-content/60 text-xs font-semibold tracking-widest uppercase">
              Set {albumSets.findIndex((s) => s.id === set.id) + 1} of {albumSets.length}{' '}
              <a class="normal-case" href={sessionUrl(set.sessionId)}>
                from {set.sessionTitle}
              </a>
            </p>
            <div class="join">
              {previous ? (
                <a
                  class="btn btn-ghost btn-sm join-item"
                  href={setUrl(previous)}
                  title={`Previous: ${previous.title ?? previous.name}`}
                >
                  ←
                </a>
              ) : (
                <span class="btn btn-ghost btn-sm join-item btn-disabled">←</span>
              )}
              {next ? (
                <a
                  class="btn btn-ghost btn-sm join-item"
                  href={setUrl(next)}
                  title={`Next: ${next.title ?? next.name}`}
                >
                  →
                </a>
              ) : (
                <span class="btn btn-ghost btn-sm join-item btn-disabled">→</span>
              )}
            </div>
          </div>
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
          <p class="text-base-content/60 mt-2 mb-4 text-sm">
            {formatDateTime(set.startedAt)} · {formatDuration(set.durationSeconds)} ·{' '}
            {plural(set.plays, 'play')}
          </p>
          <SetActions set={set} queue={queue}>
            {auth.isAdmin && (
              <>
                <EditButton kind="set" id={set.id} label="Edit set" />
                {streamer && <EditButton kind="streamer" id={set.userId} label="Edit DJ" />}
              </>
            )}
          </SetActions>
        </div>
      </section>

      {set.description && <p class="mt-6 max-w-prose whitespace-pre-line">{set.description}</p>}

      <SessionCard session={session} sets={albumSets} queue={queue} currentUuid={set.uuid} />

      {auth.isAdmin && <EditSetDialog set={set} next={setUrl(set)} />}
      {auth.isAdmin && streamer && <EditStreamerDialog streamer={streamer} next={setUrl(set)} />}
    </Layout>
  );
}

/**
 * A set's page, inline: what a list row expands into (see `data-expand` in layout.tsx).
 * The row already shows the art, title and DJ, so this is the rest of the page.
 */
export function SetInline({ set, albumSets }: { set: SetSummary; albumSets: SetSummary[] }) {
  const queue = queueOf(albumSets);
  return (
    <div class="flex flex-col gap-3 px-3 pt-1 pb-4 sm:pl-14">
      <p class="text-base-content/60 text-sm">
        {formatDateTime(set.startedAt)} · {formatDuration(set.durationSeconds)} ·{' '}
        {plural(set.plays, 'play')} · Set {albumSets.findIndex((s) => s.id === set.id) + 1} of{' '}
        {albumSets.length} from <a href={sessionUrl(set.sessionId)}>{set.sessionTitle}</a>
      </p>
      {set.description && <p class="max-w-prose whitespace-pre-line">{set.description}</p>}
      <div>
        <SetActions set={set} queue={queue}>
          <a class="btn btn-ghost btn-sm" href={setUrl(set)}>
            Open set page →
          </a>
        </SetActions>
      </div>
    </div>
  );
}
