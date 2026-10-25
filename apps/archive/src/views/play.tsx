/**
 * Server side of the player: turn sets into `Track`s and render play buttons carrying a
 * queue for `client/player.ts`.
 */
import type { Track } from '../client/track.ts';
import type { SetSummary } from '../catalog/catalog.ts';
import { gradient, imageUrl, setArt } from './art.ts';
import { mediaUrl } from './components.tsx';
import { plural } from './format.ts';
import { setUrl } from './links.ts';

/** MP3 first (it sounds best), then AAC, then the raw capture; undefined if none exists. */
function audioFormat(set: SetSummary): 'mp3' | 'm4a' | 'raw' | undefined {
  if (set.files.mp3) return 'mp3';
  if (set.files.m4a) return 'm4a';
  if (set.files.rawAudio) return 'raw';
  return undefined;
}

export function trackOf(set: SetSummary): Track | undefined {
  const format = audioFormat(set);
  if (!format) return undefined;
  const art = setArt(set);
  return {
    uuid: set.uuid,
    title: set.title ?? set.name,
    artist: set.name,
    album: set.sessionTitle,
    src: mediaUrl(set.id, format),
    href: setUrl(set),
    art: art ? imageUrl(art) : undefined,
    gradient: gradient(set.uuid),
  };
}

/**
 * A set's play count ("3 plays", or just the number with `bare`). The player bumps every
 * count tagged with the set's UUID once it records a play, so the page needn't reload.
 */
export function PlayCount({ set, bare = false }: { set: SetSummary; bare?: boolean }) {
  return (
    <span data-play-count={set.uuid} data-plays={String(set.plays)} data-bare={bare || undefined}>
      {bare ? String(set.plays) : plural(set.plays, 'play')}
    </span>
  );
}

/** The playable sets of a list, as a queue. */
export const queueOf = (sets: SetSummary[]): Track[] =>
  sets.flatMap((set) => {
    const track = trackOf(set);
    return track ? [track] : [];
  });

const PLAY_ICON = 'M7 4.5v15l12-7.5z';

/**
 * Plays `queue` from the set `startUuid` (or the start). Renders nothing if there's
 * nothing playable.
 */
export function PlayButton({
  queue,
  startUuid,
  label = 'Play',
  class: className = 'btn btn-circle btn-primary btn-sm',
  text,
}: {
  queue: Track[];
  startUuid?: string | undefined;
  label?: string;
  class?: string;
  text?: string;
}) {
  const index = startUuid ? queue.findIndex((track) => track.uuid === startUuid) : 0;
  if (queue.length === 0 || index < 0) return null;
  return (
    <button
      type="button"
      class={className}
      data-queue={JSON.stringify(queue)}
      data-index={String(index)}
      aria-label={label}
      title={label}
    >
      <svg class="size-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d={PLAY_ICON} />
      </svg>
      {text}
    </button>
  );
}

const QUEUE_ICON = 'M3 5h13v2H3zM3 10h13v2H3zM3 15h8v2H3zM18 13v3h3v2h-3v3h-2v-3h-3v-2h3v-3z';

/** Adds `tracks` to the end of the player's queue. Renders nothing if none are playable. */
export function QueueButton({
  tracks,
  label = 'Add to queue',
  class: className = 'btn btn-ghost btn-circle btn-sm',
  text,
}: {
  tracks: Track[];
  label?: string;
  class?: string;
  text?: string;
}) {
  if (tracks.length === 0) return null;
  return (
    <button
      type="button"
      class={className}
      data-enqueue={JSON.stringify(tracks)}
      aria-label={label}
      title={label}
    >
      <svg class="size-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d={QUEUE_ICON} />
      </svg>
      {text}
    </button>
  );
}
