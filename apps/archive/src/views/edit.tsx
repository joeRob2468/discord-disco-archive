/**
 * Admin edit dialogs for sets, sessions and DJs. Each is a daisyUI modal opened by an
 * `EditButton` (see `data-dialog` in layout.tsx). The forms are boosted multipart posts
 * carrying the text fields and the image together, so nothing changes until Save; the
 * route redirects to `next`, which swaps in the updated page and drops the dialog.
 * `AddSetDialog` is the exception: it uploads a file with a progress bar (layout.tsx).
 */
import type { Child } from 'hono/jsx';
import type { SessionSummary, SetSummary, StreamerSummary } from '../catalog/catalog.ts';
import { UPLOAD_EXTENSIONS } from '../uploads.ts';
import { imageUrl } from './art.ts';
import { formatBytes } from './format.ts';
import { sessionUrl, setUrl } from './links.ts';

const dialogId = (kind: string, id: string): string => `edit-${kind}-${id.replace(/[^\w-]/g, '_')}`;

export function EditButton({
  kind,
  id,
  label = 'Edit',
  class: className = 'btn btn-ghost btn-sm',
}: {
  kind: 'set' | 'session' | 'streamer' | 'add-set';
  id: string;
  label?: string;
  class?: string;
}) {
  return (
    <button class={className} type="button" data-dialog={dialogId(kind, id)}>
      {label}
    </button>
  );
}

/** A daisyUI modal with a title and a close button. */
function Modal(props: { id: string; title: string; children?: Child }) {
  return (
    <dialog id={props.id} class="modal">
      <div class="modal-box bg-base-200 max-w-xl rounded-3xl">
        <div class="mb-4 flex items-center justify-between gap-3">
          <h2 class="text-xl font-bold">{props.title}</h2>
          <form method="dialog" hx-boost="false">
            <button class="btn btn-ghost btn-sm btn-circle" aria-label="Close">
              ✕
            </button>
          </form>
        </div>
        {props.children}
      </div>
      <form method="dialog" class="modal-backdrop" hx-boost="false">
        <button>Close</button>
      </form>
    </dialog>
  );
}

/** An edit form in a modal. `remove` opens the item's delete confirmation, if any. */
function Dialog(props: {
  id: string;
  title: string;
  action: string;
  remove?: { dialog: string; label: string };
  children?: Child;
}) {
  return (
    <Modal id={props.id} title={props.title}>
      <form
        class="flex flex-col gap-3"
        method="post"
        action={props.action}
        enctype="multipart/form-data"
      >
        {props.children}
        <div class="modal-action mt-2 justify-between">
          {props.remove ? (
            <button
              class="btn btn-ghost text-error"
              type="button"
              data-dialog={props.remove.dialog}
            >
              {props.remove.label}
            </button>
          ) : (
            <span />
          )}
          <button class="btn btn-primary" type="submit">
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Confirm a permanent delete. The server refuses while the session is still recording
 * unless "Force delete" is ticked.
 */
function DeleteDialog(props: {
  id: string;
  title: string;
  action: string;
  next: string;
  children?: Child;
}) {
  return (
    <Modal id={props.id} title={props.title}>
      <form class="flex flex-col gap-3 text-sm" method="post" action={props.action}>
        <input type="hidden" name="next" value={props.next} />
        {props.children}
        <p class="text-error font-semibold">
          This can't be undone. To keep it but take it off the site, archive it instead.
        </p>
        <label class="flex items-center gap-2">
          <input class="checkbox checkbox-sm" type="checkbox" name="force" value="1" />
          Force delete, even if the recorder says the session is still recording
        </label>
        <div class="modal-action mt-2">
          <button class="btn btn-error" type="submit">
            Delete permanently
          </button>
        </div>
      </form>
    </Modal>
  );
}

const FILE_LABELS: Record<string, string> = {
  rawAudio: 'Raw capture or uploaded original',
  master: 'Master (FLAC)',
  mp3: 'MP3',
  m4a: 'AAC (M4A)',
};

export function DeleteSetDialog({ set, next }: { set: SetSummary; next: string }) {
  const files = Object.entries(set.files);
  return (
    <DeleteDialog
      id={dialogId('delete-set', set.id)}
      title="Delete set?"
      action={`/sets/${encodeURIComponent(set.id)}/delete`}
      next={next}
    >
      <p>
        <strong>{set.title ?? set.name}</strong> from {set.sessionTitle}: its files are deleted and
        it's removed from the session's <code>session.json</code>.
      </p>
      {files.length > 0 && (
        <ul class="text-base-content/70 list-disc pl-5">
          {files.map(([key, file]) => {
            const bytes = set.fileSizes[key as keyof SetSummary['files']];
            return (
              <li>
                {FILE_LABELS[key] ?? key}: <code class="break-all">{file}</code>
                {bytes !== undefined && ` (${formatBytes(bytes)})`}
              </li>
            );
          })}
        </ul>
      )}
    </DeleteDialog>
  );
}

export function DeleteSessionDialog({ session, next }: { session: SessionSummary; next: string }) {
  return (
    <DeleteDialog
      id={dialogId('delete-session', session.id)}
      title="Delete session?"
      action={`/sessions/${encodeURIComponent(session.id)}/delete`}
      next={next}
    >
      <p>
        <strong>{session.title}</strong>: the whole folder{' '}
        <code class="break-all">{session.dir}</code> is deleted, with all {session.totalSets} of its
        sets and their files.
      </p>
    </DeleteDialog>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children?: Child }) {
  return (
    <label class="flex flex-col gap-1 text-sm">
      <span class="font-semibold">
        {label} {hint && <span class="text-base-content/60 font-normal">({hint})</span>}
      </span>
      {children}
    </label>
  );
}

/** The image field: current image, a file to replace it, and a remove box. */
function ImageField(props: { label: string; current: string | undefined; hint?: string }) {
  const { label, current, hint } = props;
  return (
    <div class="border-base-content/10 flex flex-col gap-2 border-t pt-3 text-sm">
      <span class="font-semibold">{label}</span>
      <div class="flex items-center gap-3">
        {current && (
          <img class="size-14 shrink-0 rounded-lg object-cover" src={imageUrl(current)} alt="" />
        )}
        <input
          class="file-input file-input-sm w-full"
          type="file"
          name="image"
          accept="image/png,image/jpeg,image/webp"
        />
      </div>
      {current && (
        <label class="flex items-center gap-2">
          <input class="checkbox checkbox-sm" type="checkbox" name="removeImage" value="1" />
          Remove the current image
        </label>
      )}
      <p class="text-base-content/60 text-xs">
        PNG, JPEG or WebP, up to 5 MB. Applied when you save.{hint && ` ${hint}`}
      </p>
    </div>
  );
}

export function EditSetDialog({ set, next }: { set: SetSummary; next: string }) {
  // After deleting from the set's own page, land on its album instead.
  const afterDelete = next === setUrl(set) ? sessionUrl(set.sessionId) : next;
  return (
    <>
      <DeleteSetDialog set={set} next={afterDelete} />
      <Dialog
        id={dialogId('set', set.id)}
        title="Edit set"
        remove={{ dialog: dialogId('delete-set', set.id), label: 'Delete set…' }}
        action={`/sets/${encodeURIComponent(set.id)}/edit`}
      >
        <input type="hidden" name="next" value={next} />
        <Field label="Set title">
          <input class="input w-full" name="title" value={set.title ?? ''} maxlength={120} />
        </Field>
        <Field label="DJ name for this set" hint={`blank = ${set.recordedName}`}>
          <input
            class="input w-full"
            name="displayName"
            value={set.editedName ?? ''}
            maxlength={80}
          />
        </Field>
        <Field label="Description / tracklist">
          <textarea class="textarea min-h-28 w-full" name="description" maxlength={5000}>
            {set.description ?? ''}
          </textarea>
        </Field>
        <Field label="Tags" hint="comma-separated">
          <input class="input w-full" name="tags" value={set.tags.join(', ')} />
        </Field>
        <Field label="Visibility">
          <select class="select w-full" name="hidden">
            <option value="default" selected={set.hiddenOverride === undefined}>
              As recorded
            </option>
            <option value="visible" selected={set.hiddenOverride === false}>
              Visible
            </option>
            <option value="hidden" selected={set.hiddenOverride === true}>
              Archived
            </option>
          </select>
        </Field>
        <ImageField
          label="Set art"
          current={set.image}
          hint="Without its own art, a set uses its album cover."
        />
      </Dialog>
    </>
  );
}

export function EditSessionDialog({ session, next }: { session: SessionSummary; next: string }) {
  const afterDelete = next === sessionUrl(session.id) ? '/sessions' : next;
  return (
    <>
      <DeleteSessionDialog session={session} next={afterDelete} />
      <Dialog
        id={dialogId('session', session.id)}
        title="Edit session"
        remove={{ dialog: dialogId('delete-session', session.id), label: 'Delete session…' }}
        action={`/sessions/${encodeURIComponent(session.id)}/edit`}
      >
        <input type="hidden" name="next" value={next} />
        <Field label="Title" hint={`blank = ${session.recordedTitle ?? session.channelName}`}>
          <input
            class="input w-full"
            name="title"
            value={session.editedTitle ?? ''}
            maxlength={120}
          />
        </Field>
        <Field label="Description">
          <textarea class="textarea min-h-28 w-full" name="description" maxlength={5000}>
            {session.description ?? ''}
          </textarea>
        </Field>
        <Field label="Visibility">
          <select class="select w-full" name="hidden">
            <option value="visible" selected={!session.hidden}>
              Visible
            </option>
            <option value="hidden" selected={session.hidden}>
              Archived (archives every set in it)
            </option>
          </select>
        </Field>
        <ImageField label="Album cover" current={session.image} />
      </Dialog>
    </>
  );
}

export function EditStreamerDialog({
  streamer,
  next,
}: {
  streamer: StreamerSummary;
  next: string;
}) {
  return (
    <Dialog
      id={dialogId('streamer', streamer.userId)}
      title="Edit DJ"
      action={`/streamers/${encodeURIComponent(streamer.userId)}/edit`}
    >
      <input type="hidden" name="next" value={next} />
      <Field label="Name" hint={`blank = ${streamer.recordedName}`}>
        <input
          class="input w-full"
          name="displayName"
          value={streamer.editedName ?? ''}
          maxlength={80}
        />
      </Field>
      <Field label="Bio">
        <textarea class="textarea min-h-24 w-full" name="bio" maxlength={2000}>
          {streamer.bio ?? ''}
        </textarea>
      </Field>
      <Field label="Links" hint="one per line, http or https">
        <textarea class="textarea min-h-20 w-full" name="links">
          {streamer.links.join('\n')}
        </textarea>
      </Field>
      <ImageField label="Picture" current={streamer.image} />
    </Dialog>
  );
}

/**
 * Add a set to a finished session from a file. The page script sends the file in
 * resumable pieces with a progress bar (`data-upload`); the recorder then imports and
 * levels it, so it shows up a few seconds later.
 */
export function AddSetDialog({
  session,
  djs,
}: {
  session: SessionSummary;
  djs: readonly StreamerSummary[];
}) {
  const accept = UPLOAD_EXTENSIONS.map((ext) => `.${ext}`).join(',');
  return (
    <Modal id={dialogId('add-set', session.id)} title="Add a set">
      {session.endedAt === undefined ? (
        <p class="text-sm">This session is still recording. Add sets once it has ended.</p>
      ) : (
        <form
          class="flex flex-col gap-3"
          action={`/sessions/${encodeURIComponent(session.id)}/uploads`}
          hx-boost="false"
          data-upload
        >
          <p class="text-base-content/60 text-sm">
            For a set that wasn't recorded, e.g. the DJ's own copy. It's leveled like a recorded
            set; a lossless file (WAV, FLAC) sounds best.
          </p>
          <Field label="Audio file" hint={UPLOAD_EXTENSIONS.join(', ')}>
            <input class="file-input w-full" type="file" name="file" accept={accept} required />
          </Field>
          <Field label="DJ" hint="who it's filed under; the name below is what's shown">
            <select class="select w-full" name="userId" required>
              <option value="">Choose…</option>
              {djs.map((dj) => (
                <option value={dj.userId}>{dj.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Name">
            <input class="input w-full" name="displayName" required maxlength={100} />
          </Field>
          <Field label="Started at" hint="sets are listed in start order">
            <input class="input w-full" type="datetime-local" name="startedAt" required />
          </Field>
          <progress class="progress progress-primary w-full" value="0" max="1" hidden />
          <p class="text-sm" data-upload-status role="status" />
          <div class="modal-action mt-2">
            <button class="btn btn-primary" type="submit">
              Upload
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
