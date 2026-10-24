/**
 * Admin edit dialogs for sets, sessions and DJs. Each is a daisyUI modal opened by an
 * `EditButton` (see `data-dialog` in layout.tsx). The forms are boosted multipart posts
 * carrying the text fields and the image together, so nothing changes until Save; the
 * route redirects to `next`, which swaps in the updated page and drops the dialog.
 */
import type { Child } from 'hono/jsx';
import type { SessionSummary, SetSummary, StreamerSummary } from '../catalog/catalog.ts';
import { imageUrl } from './art.ts';

const dialogId = (kind: string, id: string): string => `edit-${kind}-${id.replace(/[^\w-]/g, '_')}`;

export function EditButton({
  kind,
  id,
  label = 'Edit',
  class: className = 'btn btn-ghost btn-sm',
}: {
  kind: 'set' | 'session' | 'streamer';
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

function Dialog(props: { id: string; title: string; action: string; children?: Child }) {
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
        <form
          class="flex flex-col gap-3"
          method="post"
          action={props.action}
          enctype="multipart/form-data"
        >
          {props.children}
          <div class="modal-action mt-2">
            <button class="btn btn-primary" type="submit">
              Save
            </button>
          </div>
        </form>
      </div>
      <form method="dialog" class="modal-backdrop" hx-boost="false">
        <button>Close</button>
      </form>
    </dialog>
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
  return (
    <Dialog
      id={dialogId('set', set.id)}
      title="Edit set"
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
            Hidden
          </option>
        </select>
      </Field>
      <ImageField
        label="Set art"
        current={set.image}
        hint="Without its own art, a set uses its album cover."
      />
    </Dialog>
  );
}

export function EditSessionDialog({ session, next }: { session: SessionSummary; next: string }) {
  return (
    <Dialog
      id={dialogId('session', session.id)}
      title="Edit session"
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
            Hidden (hides every set in it)
          </option>
        </select>
      </Field>
      <ImageField label="Album cover" current={session.image} />
    </Dialog>
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
