import type { AuthState } from '../auth/auth.ts';
import type { Page, SessionSummary, SetSummary, StreamerSummary } from '../catalog/catalog.ts';
import { formatDate, formatDuration, plural } from './format.ts';

export const mediaUrl = (setId: string, format: string, download = false): string =>
  `/media/${encodeURIComponent(setId)}/${format}${download ? '?download=1' : ''}`;

export function Avatar({ url, large }: { url: string | undefined; large?: boolean }) {
  const cls = large ? 'avatar large' : 'avatar';
  return url ? <img class={cls} src={url} alt="" loading="lazy" /> : <span class={cls} />;
}

export function Tags({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null;
  return (
    <div class="tags">
      {tags.map((tag) => (
        <a class="tag" href={`/search?tag=${encodeURIComponent(tag)}`}>
          {tag}
        </a>
      ))}
    </div>
  );
}

/** Status badges; hidden/missing badges only matter to admins, who are the only ones who see them. */
export function SetBadges({ set }: { set: SetSummary }) {
  return (
    <>
      {set.partial && <span class="badge">partial</span>}
      {set.status === 'recording' && <span class="badge warn">live</span>}
      {set.status === 'processing' && <span class="badge">processing</span>}
      {set.status === 'failed' && <span class="badge warn">failed</span>}
      {set.hidden && <span class="badge warn">hidden</span>}
      {set.unlisted && !set.hidden && <span class="badge warn">unlisted</span>}
    </>
  );
}

export function SetRow({
  set,
  auth,
  showSession = true,
}: {
  set: SetSummary;
  auth: AuthState;
  showSession?: boolean;
}) {
  return (
    <div class="row">
      <Avatar url={set.avatarUrl} />
      <div class="grow">
        <div>
          <a href={`/sets/${encodeURIComponent(set.id)}`}>
            <strong>{set.name}</strong>
            {set.title && ` · ${set.title}`}
          </a>
          <SetBadges set={set} />
        </div>
        <div class="muted small">
          {showSession && (
            <>
              <a href={`/sessions/${encodeURIComponent(set.sessionId)}`}>{set.sessionTitle}</a>
              {' · '}
            </>
          )}
          {formatDate(set.sessionStartedAt)}
          {set.durationSeconds !== undefined && ` · ${formatDuration(set.durationSeconds)}`}
        </div>
        <Tags tags={set.tags} />
      </div>
      {auth.isAdmin && <QuickHide set={set} />}
    </div>
  );
}

function QuickHide({ set }: { set: SetSummary }) {
  return (
    <form class="inline" method="post" action={`/sets/${encodeURIComponent(set.id)}/edit`}>
      <input type="hidden" name="hidden" value={set.hidden ? 'visible' : 'hidden'} />
      <button class="secondary" type="submit">
        {set.hidden ? 'Unhide' : 'Hide'}
      </button>
    </form>
  );
}

export function SessionCard({ session }: { session: SessionSummary }) {
  return (
    <a class="card" href={`/sessions/${encodeURIComponent(session.id)}`}>
      <strong>{session.title}</strong>
      {session.hidden && <span class="badge warn">hidden</span>}
      {session.missing && <span class="badge warn">missing</span>}
      <div class="muted small">
        {formatDate(session.startedAt)} · {plural(session.visibleSets, 'set')}
      </div>
    </a>
  );
}

export function StreamerRow({ streamer }: { streamer: StreamerSummary }) {
  return (
    <a class="row" href={`/streamers/${encodeURIComponent(streamer.userId)}`}>
      <Avatar url={streamer.avatarUrl} />
      <div class="grow">
        <strong>{streamer.name}</strong>
        <div class="muted small">
          {plural(streamer.setCount, 'set')}
          {streamer.lastPlayedAt && ` · last played ${formatDate(streamer.lastPlayedAt)}`}
        </div>
      </div>
    </a>
  );
}

export function Player({ set }: { set: SetSummary }) {
  if (set.files.mp4) {
    return <video controls preload="metadata" src={mediaUrl(set.id, 'mp4')} />;
  }
  // MP3 first: LAME at 320 kbps sounds better than ffmpeg's built-in AAC encoder.
  if (set.files.mp3) {
    return <audio controls preload="metadata" src={mediaUrl(set.id, 'mp3')} />;
  }
  if (set.files.m4a) {
    return <audio controls preload="metadata" src={mediaUrl(set.id, 'm4a')} />;
  }
  if (set.files.rawAudio) {
    // Not leveled yet (or leveling failed): play the capture itself, so it's never locked away.
    return (
      <>
        <audio controls preload="metadata" src={mediaUrl(set.id, 'raw')} />
        <p class="muted small">
          {set.status === 'recording'
            ? 'Still recording: this is the raw capture so far.'
            : set.status === 'failed'
              ? 'Processing failed; this is the raw capture, not leveled.'
              : 'Raw capture, not leveled yet; the leveled version replaces it once processing finishes.'}
        </p>
      </>
    );
  }
  return (
    <p class="muted">
      {set.status === 'failed' ? 'Processing failed; no playable file.' : 'Not ready to play yet.'}
    </p>
  );
}

export function Downloads({ set }: { set: SetSummary }) {
  const formats = [
    ['mp3', 'MP3'],
    ['master', 'FLAC'],
    ['m4a', 'AAC'],
    ['mp4', 'Video (MP4)'],
    ['rawAudio', 'WAV (raw)'],
  ] as const;
  const available = formats.filter(([key]) => set.files[key] !== undefined);
  if (available.length === 0) return null;
  return (
    <div class="actions">
      {available.map(([key, label]) => (
        <a class="button" href={mediaUrl(set.id, key === 'rawAudio' ? 'raw' : key, true)}>
          Download {label}
        </a>
      ))}
    </div>
  );
}

export function Pager<T>({ page, href }: { page: Page<T>; href: (page: number) => string }) {
  if (page.pages <= 1) return null;
  return (
    <nav class="pager" aria-label="Pages">
      {page.page > 1 ? <a href={href(page.page - 1)}>← Newer</a> : <span />}
      <span class="muted small">
        Page {page.page} of {page.pages}
      </span>
      {page.page < page.pages ? <a href={href(page.page + 1)}>Older →</a> : <span />}
    </nav>
  );
}

// --- Admin edit forms -------------------------------------------------------------------

export function EditSessionForm({ session }: { session: SessionSummary }) {
  return (
    <details class="edit">
      <summary>Edit session</summary>
      <form class="stack" method="post" action={`/sessions/${encodeURIComponent(session.id)}/edit`}>
        <label>
          Title <span class="muted">(blank = {session.recordedTitle ?? session.channelName})</span>
          <input name="title" value={session.editedTitle ?? ''} maxlength={120} />
        </label>
        <label>
          Description
          <textarea name="description" maxlength={5000}>
            {session.description ?? ''}
          </textarea>
        </label>
        <label>
          Visibility
          <select name="hidden">
            <option value="visible" selected={!session.hidden}>
              Visible
            </option>
            <option value="hidden" selected={session.hidden}>
              Hidden
            </option>
          </select>
        </label>
        <div>
          <button type="submit">Save</button>
        </div>
      </form>
    </details>
  );
}

export function EditSetForm({ set }: { set: SetSummary }) {
  return (
    <details class="edit">
      <summary>Edit set</summary>
      <form class="stack" method="post" action={`/sets/${encodeURIComponent(set.id)}/edit`}>
        <label>
          DJ name for this set <span class="muted">(blank = streamer's name)</span>
          <input name="displayName" value={set.editedName ?? ''} maxlength={80} />
        </label>
        <label>
          Set title
          <input name="title" value={set.title ?? ''} maxlength={120} />
        </label>
        <label>
          Description / tracklist
          <textarea name="description" maxlength={5000}>
            {set.description ?? ''}
          </textarea>
        </label>
        <label>
          Tags <span class="muted">(comma-separated)</span>
          <input name="tags" value={set.tags.join(', ')} />
        </label>
        <label>
          Visibility
          <select name="hidden">
            <option value="default" selected={set.hiddenOverride === undefined}>
              Default (as recorded)
            </option>
            <option value="visible" selected={set.hiddenOverride === false}>
              Visible
            </option>
            <option value="hidden" selected={set.hiddenOverride === true}>
              Hidden
            </option>
          </select>
        </label>
        <div>
          <button type="submit">Save</button>
        </div>
      </form>
    </details>
  );
}

export function EditStreamerForm({ streamer }: { streamer: StreamerSummary }) {
  return (
    <details class="edit">
      <summary>Edit streamer</summary>
      <form
        class="stack"
        method="post"
        action={`/streamers/${encodeURIComponent(streamer.userId)}/edit`}
      >
        <label>
          Display name <span class="muted">(blank = {streamer.recordedName})</span>
          <input name="displayName" value={streamer.editedName ?? ''} maxlength={80} />
        </label>
        <label>
          Bio
          <textarea name="bio" maxlength={2000}>
            {streamer.bio ?? ''}
          </textarea>
        </label>
        <label>
          Links <span class="muted">(one per line, http/https)</span>
          <textarea name="links">{streamer.links.join('\n')}</textarea>
        </label>
        <div>
          <button type="submit">Save</button>
        </div>
      </form>
    </details>
  );
}
