/**
 * Album and set pages. A session is presented as an album: cover, DJs and a numbered
 * tracklist of its sets. Each set has its own page under its session.
 */
import type { AuthState } from '../auth/auth.ts';
import type { SetSummary } from '../catalog/catalog.ts';
import { Art, DjAvatar, SetListRow, StatusBadges } from './cards.tsx';
import { Downloads, EditSessionForm, EditSetForm, mediaUrl } from './components.tsx';
import { formatDate, formatDateTime, formatDuration, plural } from './format.ts';
import { djsOf, totalSeconds, type Album } from './home.tsx';
import { Layout } from './layout.tsx';
import { searchUrl, sessionUrl, setUrl } from './links.ts';

export function AlbumPage({ album, auth }: { album: Album; auth: AuthState }) {
  const { session, sets } = album;
  const djs = djsOf(sets);
  return (
    <Layout title={session.title} auth={auth}>
      <section class="panel flex flex-col gap-6 rounded-3xl p-5 sm:flex-row sm:items-end sm:p-6">
        <Art
          seed={session.id}
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
                  <DjAvatar userId={set.userId} name={set.name} size="size-8 text-xs" />
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
            {/* Wired to the queue when the player lands (stage 3). */}
            <button
              class="btn btn-primary rounded-xl"
              type="button"
              disabled
              title="Coming with the player"
            >
              ▶ Play all
            </button>
            <button
              class="btn btn-ghost rounded-xl"
              type="button"
              data-copy={sessionUrl(session.id)}
            >
              Copy link
            </button>
          </div>
        </div>
      </section>

      <section class="mt-8">
        <h2 class="mb-3 text-xl font-bold">Sets</h2>
        <div class="flex flex-col gap-2">
          {sets.map((set, index) => (
            <SetListRow set={set} number={index + 1} />
          ))}
        </div>
      </section>

      {auth.isAdmin && <EditSessionForm session={session} />}
    </Layout>
  );
}

export function SetDetailPage(props: {
  auth: AuthState;
  set: SetSummary;
  previous: SetSummary | undefined;
  next: SetSummary | undefined;
}) {
  const { auth, set, previous, next } = props;
  const format = set.files.mp3
    ? 'mp3'
    : set.files.m4a
      ? 'm4a'
      : set.files.rawAudio
        ? 'raw'
        : undefined;
  return (
    <Layout title={`${set.title ?? set.name} · ${set.sessionTitle}`} auth={auth}>
      <section class="panel flex flex-col gap-6 rounded-3xl p-5 sm:flex-row sm:items-end sm:p-6">
        <Art seed={set.uuid} class="aspect-square w-full shrink-0 rounded-2xl shadow-2xl sm:w-56" />
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
            <DjAvatar userId={set.userId} name={set.name} size="size-8 text-xs" />
            <span class="font-semibold">{set.name}</span>
          </a>
          <p class="text-base-content/60 mt-2 text-sm">
            {formatDateTime(set.startedAt)} · {formatDuration(set.durationSeconds)} ·{' '}
            {plural(set.plays, 'play')}
          </p>
          {format ? (
            <audio class="mt-4 w-full" controls preload="none" src={mediaUrl(set.id, format)} />
          ) : (
            <p class="text-base-content/60 mt-4 text-sm">Nothing to play yet.</p>
          )}
          {format === 'raw' && (
            <p class="text-base-content/60 mt-1 text-xs">Raw capture, not leveled yet.</p>
          )}
          <div class="mt-3 flex flex-wrap items-center gap-2">
            <Downloads set={set} />
            <button class="btn btn-ghost btn-sm" type="button" data-copy={setUrl(set)}>
              Copy link
            </button>
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

      {auth.isAdmin && <EditSetForm set={set} />}
    </Layout>
  );
}
