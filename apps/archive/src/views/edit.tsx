/**
 * Admin edit dialogs for sets, sessions and DJs. Each is a daisyUI modal opened by an
 * `EditButton` (see `data-dialog` in layout.tsx). The forms are boosted posts; the route
 * redirects to `next`, which swaps in the updated page and drops the dialog with it.
 */
import type { Child } from 'hono/jsx';
import type { SessionSummary, SetSummary, StreamerSummary } from '../catalog/catalog.ts';
import { ImageForm } from './cards.tsx';

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

function Dialog({ id, title, children }: { id: string; title: string; children?: Child }) {
  return (
    <dialog id={id} class="modal">
      <div class="modal-box bg-base-200 max-w-xl rounded-3xl">
        <form method="dialog" hx-boost="false">
          <button class="btn btn-ghost btn-sm btn-circle absolute top-3 right-3" aria-label="Close">
            ✕
          </button>
        </form>
        <h2 class="mb-4 text-xl font-bold">{title}</h2>
        {children}
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

function SaveButton() {
  return (
    <div class="modal-action mt-2">
      <button class="btn btn-primary" type="submit">
        Save
      </button>
    </div>
  );
}

function Images({ children }: { children?: Child }) {
  return (
    <div class="border-base-content/10 mt-6 flex flex-col gap-3 border-t pt-4">
      <h3 class="font-semibold">Images</h3>
      {children}
      <p class="text-base-content/60 text-xs">PNG, JPEG or WebP, up to 5 MB.</p>
    </div>
  );
}

export function EditSetDialog({ set, next }: { set: SetSummary; next: string }) {
  return (
    <Dialog id={dialogId('set', set.id)} title="Edit set">
      <form
        class="flex flex-col gap-3"
        method="post"
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
        <SaveButton />
      </form>
      <Images>
        <ImageForm entity="set" id={set.id} label="Set art" current={set.image} back={next} />
        <p class="text-base-content/60 text-xs">Without its own art, a set uses its album cover.</p>
      </Images>
    </Dialog>
  );
}

export function EditSessionDialog({ session, next }: { session: SessionSummary; next: string }) {
  return (
    <Dialog id={dialogId('session', session.id)} title="Edit session">
      <form
        class="flex flex-col gap-3"
        method="post"
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
        <SaveButton />
      </form>
      <Images>
        <ImageForm
          entity="session"
          id={session.id}
          label="Album cover"
          current={session.image}
          back={next}
        />
      </Images>
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
    <Dialog id={dialogId('streamer', streamer.userId)} title="Edit DJ">
      <form
        class="flex flex-col gap-3"
        method="post"
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
        <SaveButton />
      </form>
      <Images>
        <ImageForm
          entity="streamer"
          id={streamer.userId}
          label="Picture"
          current={streamer.image}
          back={next}
        />
      </Images>
    </Dialog>
  );
}
