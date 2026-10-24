/** Building blocks shared by the home, search, album and set pages. */
import type { SetSummary } from '../catalog/catalog.ts';
import { gradient, initials } from './art.ts';
import { formatDate, formatDuration, plural } from './format.ts';
import { setUrl } from './links.ts';

/** Artwork: a placeholder gradient seeded by `seed` (uploaded images come later). */
export function Art({ seed, class: className }: { seed: string; class: string }) {
  return <div class={`art ${className}`} style={`background:${gradient(seed)}`} />;
}

/** A DJ's avatar: their gradient with initials. */
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

export function StatusBadges({ set }: { set: SetSummary }) {
  return (
    <>
      {set.status !== 'ready' && (
        <span class="badge badge-warning badge-sm ml-2">{set.status}</span>
      )}
      {set.partial && <span class="badge badge-ghost badge-sm ml-2">partial</span>}
      {set.unlisted && <span class="badge badge-error badge-sm ml-2">hidden</span>}
    </>
  );
}

/**
 * One set as a list row linking to its page. In an album the row shows its track number
 * and leaves out the session it belongs to.
 */
export function SetListRow({ set, number }: { set: SetSummary; number?: number }) {
  return (
    <a
      class="plain panel hover:bg-base-100/60 flex items-center gap-3 rounded-2xl p-3 transition"
      href={setUrl(set)}
    >
      {number !== undefined && (
        <span class="text-base-content/50 w-6 text-right text-sm tabular-nums">{number}</span>
      )}
      <Art seed={set.uuid} class="size-12 shrink-0 rounded-xl" />
      <div class="min-w-0 flex-1">
        <p class="truncate font-semibold">
          {set.title ?? set.name}
          {set.title && <span class="text-base-content/60 font-normal"> · {set.name}</span>}
          <StatusBadges set={set} />
        </p>
        {number === undefined && (
          <p class="text-base-content/60 truncate text-sm">
            {set.sessionTitle} · {formatDate(set.sessionStartedAt)}
          </p>
        )}
      </div>
      <span class="text-base-content/60 hidden text-sm tabular-nums sm:block">
        {plural(set.plays, 'play')}
      </span>
      <span class="w-16 text-right text-sm tabular-nums">
        {formatDuration(set.durationSeconds)}
      </span>
    </a>
  );
}
