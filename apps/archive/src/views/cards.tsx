/** Building blocks shared by the home, search, album and set pages. */
import type { SetSummary } from '../catalog/catalog.ts';
import type { Track } from '../client/track.ts';
import { gradient, imageUrl, initials, setArt } from './art.ts';
import { formatDate, formatDuration } from './format.ts';
import { setUrl } from './links.ts';
import { DownloadCount } from './components.tsx';
import { PlayButton, QueueButton } from './play.tsx';

/** Artwork: the uploaded image if there is one, else a gradient seeded by `seed`. */
export function Art({
  seed,
  image,
  class: className,
}: {
  seed: string;
  image?: string | undefined;
  class: string;
}) {
  if (image) {
    return (
      <img class={`art object-cover ${className}`} src={imageUrl(image)} alt="" loading="lazy" />
    );
  }
  return <div class={`art ${className}`} style={`background:${gradient(seed)}`} />;
}

/** A DJ's avatar: their gradient with initials. */
export function DjAvatar({
  userId,
  name,
  image,
  size = 'size-10',
}: {
  userId: string;
  name: string;
  image?: string | undefined;
  size?: string;
}) {
  if (image) {
    return (
      <img
        class={`${size} shrink-0 rounded-full object-cover shadow`}
        src={imageUrl(image)}
        alt={name}
        title={name}
        loading="lazy"
      />
    );
  }
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

export function StatusBadges({ set }: { set: SetSummary }) {
  return (
    <>
      {set.status !== 'ready' && (
        <span class="badge badge-warning badge-sm ml-2">{set.status}</span>
      )}
      {set.partial && <span class="badge badge-ghost badge-sm ml-2">partial</span>}
      {set.unlisted && <span class="badge badge-error badge-sm ml-2">archived</span>}
    </>
  );
}

function MoveButtons(props: { set: SetSummary; first: boolean; last: boolean; next: string }) {
  const { set, first, last, next } = props;
  const button = (move: 'up' | 'down', disabled: boolean) => (
    <form method="post" action={`/sessions/${encodeURIComponent(set.sessionId)}/order`}>
      <input type="hidden" name="set" value={set.id} />
      <input type="hidden" name="move" value={move} />
      <input type="hidden" name="next" value={next} />
      <button
        class="btn btn-ghost btn-xs btn-square"
        type="submit"
        disabled={disabled}
        aria-label={move === 'up' ? 'Move earlier' : 'Move later'}
        title={move === 'up' ? 'Move earlier' : 'Move later'}
      >
        {move === 'up' ? '↑' : '↓'}
      </button>
    </form>
  );
  return (
    <div class="flex flex-col">
      {button('up', first)}
      {button('down', last)}
    </div>
  );
}

/**
 * One set as a list row: a play button (playing `queue` from this set), the set's title,
 * which expands the row into an inline set page (a real link, so it also opens in a new
 * tab), and an "Add to queue" button. In an album the row shows its track number, which
 * turns into the play button on hover (touchscreens always show the button), and leaves out
 * the session it belongs to.
 */
export function SetListRow({
  set,
  queue,
  number,
  current = false,
  reorder,
}: {
  set: SetSummary;
  queue: Track[];
  number?: number;
  /** The set whose page this is: highlighted. */
  current?: boolean;
  /** Admins on the album page: move buttons, disabled at the ends. */
  reorder?: { first: boolean; last: boolean; next: string } | undefined;
}) {
  const track = queue.find((t) => t.uuid === set.uuid);
  return (
    <div
      class={`panel rounded-2xl ${current ? 'ring-primary/50 ring-1' : ''}`}
      data-track-uuid={set.uuid}
      data-set-row
    >
      <div class="group hover:bg-base-100 flex items-center gap-2 rounded-2xl p-2 transition sm:gap-3 sm:pr-4">
        <div class="grid w-8 shrink-0 place-items-center">
          {number !== undefined && (
            <span class="text-base-content/50 pointer-coarse:hidden text-sm tabular-nums group-hover:hidden">
              {number}
            </span>
          )}
          <PlayButton
            queue={queue}
            startUuid={set.uuid}
            label={`Play ${set.title ?? set.name}`}
            class={`btn btn-circle btn-primary btn-sm ${number !== undefined ? 'pointer-coarse:inline-flex hidden group-hover:inline-flex' : ''}`}
          />
        </div>
        <a
          class="plain flex min-w-0 flex-1 items-center gap-3"
          href={setUrl(set)}
          hx-boost="false"
          data-expand={`${setUrl(set)}/inline`}
          aria-expanded="false"
        >
          <Art seed={set.uuid} image={setArt(set)} class="size-10 shrink-0 rounded-xl sm:size-12" />
          <div class="min-w-0 flex-1">
            <p class="playing-title truncate font-semibold">
              {set.title ?? set.name}
              {set.title && <span class="text-base-content/60 font-normal"> · {set.name}</span>}
              <StatusBadges set={set} />
            </p>
            {/* On phones the length moves here, leaving the title the row's width. */}
            {number === undefined ? (
              <p class="text-base-content/60 truncate text-sm">
                {set.sessionTitle} · {formatDate(set.sessionStartedAt)}
                <span class="sm:hidden"> · {formatDuration(set.durationSeconds)}</span>
              </p>
            ) : (
              <p class="text-base-content/60 truncate text-sm tabular-nums sm:hidden">
                {formatDuration(set.durationSeconds)} · <DownloadCount set={set} />
              </p>
            )}
          </div>
        </a>
        <span class="text-base-content/60 hidden text-sm tabular-nums sm:block">
          <DownloadCount set={set} />
        </span>
        <span class="hidden w-14 text-right text-sm tabular-nums sm:block">
          {formatDuration(set.durationSeconds)}
        </span>
        {track && <QueueButton tracks={[track]} />}
        {reorder && <MoveButtons set={set} {...reorder} />}
      </div>
      <div data-set-inline hidden />
    </div>
  );
}
