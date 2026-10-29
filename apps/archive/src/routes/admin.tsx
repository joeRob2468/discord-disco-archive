/**
 * The admin panel and the admin-only edit endpoints (HTML form posts). Fields missing
 * from a form are left unchanged, so a one-field form (e.g. the quick Hide button) only
 * touches that field. Edit forms may also carry an image (`image` upload, or
 * `removeImage=1`), applied in the same save. Sets uploaded from a file come in as raw
 * request bodies in pieces instead (see `uploads.ts`), since they can be gigabytes.
 */
import { Hono, type Context, type Handler, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { setStatusSchema, type Logger } from '@dsr/core';
import { safeNext, type AuthEnv } from '../auth/auth.ts';
import { SET_SORTS, type Catalog, type ImageEntity } from '../catalog/catalog.ts';
import { deleteImage, IMAGE_MAX_BYTES, ImageError, saveImage } from '../images.ts';
import { DeleteError, deleteSessionFolder, deleteSetFiles } from '../recordings.ts';
import {
  CHUNK_BYTES,
  receiveChunk,
  startUpload,
  UploadError,
  UploadInterruptedError,
  UploadOffsetError,
  uploadProgress,
} from '../uploads.ts';
import {
  ActivityPage,
  AdminSetsPage,
  OverviewPage,
  setDefaultDir,
  type AdminSetFilters,
} from '../views/admin.tsx';
import { MessagePage, NotFoundPage } from '../views/pages.tsx';
import { formField, pageParam, sortParam, splitList, textParam } from './params.ts';
import { searchUrl, sessionUrl, setUrl } from '../views/links.ts';

const ACTOR = 'admin';
/** The tag standing for a set's partial flag in its tag field. */
const PARTIAL_TAG = 'partial';

const visibility = (value: string | undefined): boolean | null | undefined => {
  if (value === 'hidden') return true;
  if (value === 'visible') return false;
  if (value === 'default') return null;
  return undefined;
};

type FormBody = Awaited<ReturnType<Context['req']['parseBody']>>;

/**
 * Back to the page the form was on: its `next` field (browsers send no Referer here,
 * see Referrer-Policy), else a same-host Referer, else `fallback`.
 */
function redirectBack(c: Context, body: FormBody, fallback: string): Response {
  const next = formField(body, 'next');
  if (next !== undefined) return c.redirect(safeNext(next), 303);
  const referer = c.req.header('referer');
  if (referer) {
    const url = new URL(referer);
    if (url.host === new URL(c.req.url).host) return c.redirect(url.pathname + url.search, 303);
  }
  return c.redirect(fallback, 303);
}

/** Non-admins get a plain 404, so admin URLs aren't advertised. */
const requireAdmin: MiddlewareHandler<AuthEnv> = async (c, next) => {
  if (!c.var.auth.isAdmin) return c.html(<NotFoundPage auth={c.var.auth} />, 404);
  await next();
};

// Room for the multipart wrapping around a maximum-size image.
const editBodyLimit = bodyLimit({
  maxSize: IMAGE_MAX_BYTES + 64 * 1024,
  onError: (c) => c.text('Images must be 5 MB or smaller.', 413),
});

/** Form fields that aren't edits: where to go next, and the image controls. */
const NON_EDIT_FIELDS = new Set(['next', 'image', 'removeImage']);

/** What an edit form asks for its image: a new upload, removal, or no change. */
type ImageChange = { image: string | undefined } | undefined;

/**
 * Mounted at the root; every route carries `requireAdmin` itself, because a sub-app's
 * `use()` would apply to the parent's routes too. Unknown IDs throw `NotFoundError`,
 * which the app's error handler turns into a 404.
 */
export function adminRoutes(
  catalog: Catalog,
  imagesDir: string,
  recordingsDir: string,
  logger?: Logger,
): Hono<AuthEnv> {
  const app = new Hono<AuthEnv>();

  /** Store an uploaded image (validated first, so a bad file changes nothing). */
  async function imageChange(body: FormBody): Promise<ImageChange> {
    const file = body['image'];
    // Browsers send an empty file part when nothing was chosen.
    if (file instanceof File && file.size > 0) {
      return { image: await saveImage(imagesDir, new Uint8Array(await file.arrayBuffer())) };
    }
    return formField(body, 'removeImage') === '1' ? { image: undefined } : undefined;
  }

  async function applyImage(entity: ImageEntity, id: string, change: ImageChange): Promise<void> {
    if (!change) return;
    const previous = catalog.setImage(entity, id, change.image, ACTOR);
    // Content-named files can be shared, so only delete one nothing uses any more.
    if (previous && previous !== change.image && !catalog.imageInUse(previous)) {
      await deleteImage(imagesDir, previous);
    }
  }

  /**
   * An edit route for `entity`: parses the form, stores any image, applies the text
   * edits (`edit`) and the image, then redirects back.
   */
  const editRoute =
    (
      entity: ImageEntity,
      edit: (id: string, body: FormBody) => void,
      fallback: (id: string) => string,
    ): Handler<AuthEnv> =>
    async (c) => {
      const id = c.req.param('id') ?? '';
      const body = await c.req.parseBody();
      let image: ImageChange;
      try {
        image = await imageChange(body);
      } catch (error) {
        if (!(error instanceof ImageError)) throw error;
        logger?.warn({ entity, id, reason: error.message }, 'image rejected; edit not saved');
        return c.html(
          <MessagePage auth={c.var.auth} title="Not saved" message={error.message} />,
          400,
        );
      }
      edit(id, body);
      await applyImage(entity, id, image);
      // Field names only; the values are in the activity log.
      const fields = Object.keys(body).filter((key) => !NON_EDIT_FIELDS.has(key));
      const imageNote = image && (image.image ? 'uploaded' : 'removed');
      logger?.info({ entity, id, fields, ...(imageNote && { image: imageNote }) }, 'edited');
      return redirectBack(c, body, fallback(id));
    };

  app.post(
    '/sessions/:id/edit',
    requireAdmin,
    editBodyLimit,
    editRoute(
      'session',
      (id, body) => {
        const hidden = visibility(formField(body, 'hidden'));
        const title = formField(body, 'title');
        const description = formField(body, 'description');
        catalog.updateSession(
          id,
          {
            ...(title !== undefined && { title }),
            ...(description !== undefined && { description }),
            // Sessions have no recorder-side hidden flag, so "default" means visible.
            ...(hidden !== undefined && { hidden: hidden === true }),
          },
          ACTOR,
        );
      },
      (id) => sessionUrl(id),
    ),
  );

  /** Run a permanent delete; a refusal (still recording) becomes a message page. */
  async function deleting(
    c: Context<AuthEnv>,
    context: Record<string, unknown>,
    run: () => Promise<void>,
  ): Promise<Response | undefined> {
    try {
      await run();
      return undefined;
    } catch (error) {
      if (!(error instanceof DeleteError)) throw error;
      logger?.warn({ ...context, reason: error.message }, 'delete refused');
      return c.html(
        <MessagePage auth={c.var.auth} title="Not deleted" message={error.message} />,
        409,
      );
    }
  }

  app.post('/sets/:id/delete', requireAdmin, async (c) => {
    const set = catalog.getSet(c.req.param('id'), true);
    if (!set) return c.html(<NotFoundPage auth={c.var.auth} />, 404);
    const body = await c.req.parseBody();
    const force = formField(body, 'force') === '1';
    // Permanent deletes are logged as well as audited, so they show in the container logs.
    const context = {
      setId: set.id,
      sessionId: set.sessionId,
      dir: set.sessionDir,
      name: set.title ?? set.name,
      force,
    };
    const refused = await deleting(c, context, () =>
      deleteSetFiles(recordingsDir, set.sessionDir, set.id, force),
    );
    if (refused) return refused;
    const images = catalog.deleteSet(set.id, ACTOR);
    for (const image of images) await deleteImage(imagesDir, image);
    logger?.info({ ...context, files: Object.values(set.files), images }, 'set deleted');
    return redirectBack(c, body, sessionUrl(set.sessionId));
  });

  app.post('/sessions/:id/delete', requireAdmin, async (c) => {
    const session = catalog.getSession(c.req.param('id'), true);
    if (!session) return c.html(<NotFoundPage auth={c.var.auth} />, 404);
    const body = await c.req.parseBody();
    const force = formField(body, 'force') === '1';
    const context = {
      sessionId: session.id,
      dir: session.dir,
      title: session.title,
      sets: session.totalSets,
      force,
    };
    const refused = await deleting(c, context, () =>
      deleteSessionFolder(recordingsDir, session.dir, session.endedAt !== undefined, force),
    );
    if (refused) return refused;
    const images = catalog.deleteSession(session.id, ACTOR);
    for (const image of images) await deleteImage(imagesDir, image);
    logger?.info({ ...context, images }, 'session deleted');
    return redirectBack(c, body, '/sessions');
  });

  // Add a set from a file, in pieces (see `uploads.ts`): start it with its details,
  // send each piece at its offset, and ask how much has arrived to resume after a drop.
  // JSON in and out, for the upload dialog's script.
  const endedSession = (c: Context<AuthEnv>) => {
    const session = catalog.getSession(c.req.param('id') ?? '', true);
    if (!session) return { error: c.json({ error: 'No such session.' }, 404) };
    if (session.endedAt === undefined) {
      return {
        error: c.json(
          { error: 'This session is still recording. Add sets once it has ended.' },
          409,
        ),
      };
    }
    return { session };
  };

  app.post('/sessions/:id/uploads', requireAdmin, async (c) => {
    const { session, error } = endedSession(c);
    if (!session) return error;
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const text = (key: string): string => (typeof body[key] === 'string' ? body[key] : '');
    const upload = {
      fileName: text('name'),
      size: typeof body['size'] === 'number' ? body['size'] : 0,
      userId: text('userId'),
      displayName: text('displayName'),
      startedAt: new Date(text('startedAt')),
    };
    const context = { sessionId: session.id, dir: session.dir, ...upload };
    try {
      const id = await startUpload(recordingsDir, session.dir, upload);
      logger?.info({ ...context, uploadId: id }, 'upload started');
      return c.json({ id, chunkBytes: CHUNK_BYTES }, 201);
    } catch (refused) {
      if (!(refused instanceof UploadError)) throw refused;
      logger?.warn({ ...context, reason: refused.message }, 'upload refused');
      return c.json({ error: refused.message }, 400);
    }
  });

  app.get('/sessions/:id/uploads/:upload', requireAdmin, async (c) => {
    const { session, error } = endedSession(c);
    if (!session) return error;
    const progress = await uploadProgress(recordingsDir, session.dir, c.req.param('upload'));
    return progress ? c.json(progress) : c.json({ error: 'No such upload.' }, 404);
  });

  app.put('/sessions/:id/uploads/:upload', requireAdmin, async (c) => {
    const { session, error } = endedSession(c);
    if (!session) return error;
    const body = c.req.raw.body;
    if (!body || c.req.header('content-type') !== 'application/octet-stream') {
      return c.json({ error: 'Send the piece as the request body.' }, 400);
    }
    const id = c.req.param('upload');
    const length = Number(c.req.header('content-length'));
    const context = { sessionId: session.id, dir: session.dir, uploadId: id };
    try {
      const progress = await receiveChunk(
        recordingsDir,
        session.dir,
        id,
        Number(c.req.query('offset')),
        Number.isSafeInteger(length) ? length : undefined,
        body,
      );
      if (progress.done) logger?.info({ ...context, bytes: progress.size }, 'set uploaded');
      return c.json(progress);
    } catch (refused) {
      if (refused instanceof UploadOffsetError) {
        return c.json({ error: refused.message, received: refused.received }, 409);
      }
      if (!(refused instanceof UploadError)) throw refused;
      // The partial piece is dropped; the client retries it, or may not be there to hear.
      logger?.warn(
        { ...context, reason: refused.message },
        refused instanceof UploadInterruptedError ? 'upload piece interrupted' : 'upload refused',
      );
      return c.json({ error: refused.message }, 400);
    }
  });

  // Reorder an album: `move=up|down` with `set=<id>`, or `move=reset`.
  app.post('/sessions/:id/order', requireAdmin, async (c) => {
    const id = c.req.param('id');
    const body = await c.req.parseBody();
    const move = formField(body, 'move');
    const setId = formField(body, 'set');
    if (move === 'reset') catalog.resetSetOrder(id, ACTOR);
    else if ((move === 'up' || move === 'down') && setId) {
      catalog.moveSet(id, setId, move === 'up' ? -1 : 1, ACTOR);
    }
    logger?.info({ sessionId: id, move, setId }, 'album reordered');
    return redirectBack(c, body, sessionUrl(id));
  });

  app.post(
    '/sets/:id/edit',
    requireAdmin,
    editBodyLimit,
    editRoute(
      'set',
      (id, body) => {
        const text = (name: string) => {
          const value = formField(body, name);
          return value === undefined ? {} : { [name]: value };
        };
        // The tag field also carries "partial", the recorder's flag, which can be removed.
        const tagField = formField(body, 'tags');
        const tags = tagField === undefined ? undefined : splitList(tagField, /,/);
        const hidden = visibility(formField(body, 'hidden'));
        catalog.updateSet(
          id,
          {
            ...text('title'),
            ...text('displayName'),
            ...text('description'),
            ...(tags !== undefined && {
              tags: tags.filter((tag) => tag.toLowerCase() !== PARTIAL_TAG),
              partial: tags.some((tag) => tag.toLowerCase() === PARTIAL_TAG),
            }),
            ...(hidden !== undefined && { hidden }),
          },
          ACTOR,
        );
      },
      (id) => {
        const set = catalog.getSet(id, true);
        return set ? setUrl(set) : '/';
      },
    ),
  );

  app.post(
    '/streamers/:id/edit',
    requireAdmin,
    editBodyLimit,
    editRoute(
      'streamer',
      (userId, body) => {
        const displayName = formField(body, 'displayName');
        const bio = formField(body, 'bio');
        const links = formField(body, 'links');
        catalog.updateStreamer(
          userId,
          {
            ...(displayName !== undefined && { displayName }),
            ...(bio !== undefined && { bio }),
            ...(links !== undefined && { links: splitList(links, /\r?\n/) }),
          },
          ACTOR,
        );
      },
      (userId) => searchUrl({ userId }),
    ),
  );

  app.get('/admin', requireAdmin, (c) =>
    c.html(
      <OverviewPage
        auth={c.var.auth}
        overview={catalog.overview()}
        unfinished={catalog.unfinishedSets()}
      />,
    ),
  );

  app.get('/admin/sets', requireAdmin, (c) => {
    const status = setStatusSchema.safeParse(c.req.query('status'));
    const visibility = c.req.query('visibility');
    const filters: AdminSetFilters = {
      q: textParam(c.req.query('q')),
      status: status.success ? status.data : undefined,
      hidden: visibility === 'archived' ? true : visibility === 'visible' ? false : undefined,
      sort: sortParam(SET_SORTS, c.req.query('sort'), c.req.query('dir'), 'date', setDefaultDir),
      page: pageParam(c.req.query('page')),
    };
    const list = catalog.search(filters, true);
    return c.html(<AdminSetsPage auth={c.var.auth} list={list} filters={filters} />);
  });

  app.get('/admin/activity', requireAdmin, (c) => {
    const actor = c.req.query('actor');
    const filter = actor === 'admin' || actor === 'recorder' ? actor : undefined;
    return c.html(
      <ActivityPage auth={c.var.auth} entries={catalog.recentAudit(200, filter)} actor={filter} />,
    );
  });

  return app;
}
