/** Building blocks shared by the home, search, album and set pages. */
import type { SetSummary } from '../catalog/catalog.ts';
import { gradient, initials } from './art.ts';
import { formatDate, formatDuration, plural } from './format.ts';
import { setUrl } from './links.ts';

export const imageUrl = (name: string): string => `/images/${encodeURIComponent(name)}`;

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

/** A set's art: its own, else its album's cover, else its gradient. */
export const setArt = (set: SetSummary): string | undefined => set.image ?? set.sessionImage;

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
      <Art seed={set.uuid} image={setArt(set)} class="size-12 shrink-0 rounded-xl" />
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

/**
 * Admin form to upload or remove an image. A plain (non-htmx) multipart post; the
 * server redirects back to this page.
 */
export function ImageForm({
  entity,
  id,
  label,
  current,
  back,
}: {
  entity: 'streamer' | 'session' | 'set';
  id: string;
  label: string;
  current: string | undefined;
  /** Page to return to; browsers don't send a Referer here (Referrer-Policy: no-referrer). */
  back: string;
}) {
  const action = `/admin/images/${entity}/${encodeURIComponent(id)}`;
  return (
    <div class="flex flex-wrap items-center gap-2">
      <form
        class="ui flex flex-wrap items-center gap-2"
        method="post"
        action={action}
        enctype="multipart/form-data"
        hx-boost="false"
      >
        <input type="hidden" name="next" value={back} />
        <span class="w-28 text-sm font-semibold">{label}</span>
        <input
          class="file-input file-input-sm w-64"
          type="file"
          name="image"
          accept="image/png,image/jpeg,image/webp"
          required
        />
        <button class="btn btn-sm btn-primary" type="submit">
          Upload
        </button>
      </form>
      {current && (
        <form class="ui" method="post" action={action} hx-boost="false">
          <input type="hidden" name="next" value={back} />
          <input type="hidden" name="remove" value="1" />
          <button class="btn btn-sm btn-ghost" type="submit">
            Remove
          </button>
        </form>
      )}
    </div>
  );
}
