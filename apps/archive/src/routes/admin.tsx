/**
 * Admin-only edit endpoints (HTML form posts). Fields missing from a form are left
 * unchanged, so a one-field form (e.g. the quick Hide button) only touches that field.
 */
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { safeNext, type AuthEnv } from '../auth/auth.ts';
import type { Catalog, ImageEntity } from '../catalog/catalog.ts';
import { deleteImage, IMAGE_MAX_BYTES, ImageError, saveImage } from '../images.ts';
import { ActivityPage, MessagePage, NotFoundPage } from '../views/pages.tsx';
import { formField, splitList } from './params.ts';
import { setUrl } from '../views/links.ts';

const ACTOR = 'admin';

const visibility = (value: string | undefined): boolean | null | undefined => {
  if (value === 'hidden') return true;
  if (value === 'visible') return false;
  if (value === 'default') return null;
  return undefined;
};

/** Back to the page the form was on, if it's ours; otherwise `fallback`. */
function redirectBack(c: Context, fallback: string): Response {
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

/**
 * Mounted at the root; every route carries `requireAdmin` itself, because a sub-app's
 * `use()` would apply to the parent's routes too. Unknown IDs throw `NotFoundError`,
 * which the app's error handler turns into a 404.
 */
const isImageEntity = (value: string): value is ImageEntity =>
  value === 'streamer' || value === 'session' || value === 'set';

export function adminRoutes(catalog: Catalog, imagesDir: string): Hono<AuthEnv> {
  const app = new Hono<AuthEnv>();

  // Upload (field `image`) or remove (`remove=1`) a DJ picture, set art or album cover.
  app.post(
    '/admin/images/:entity/:id',
    requireAdmin,
    // Room for the multipart wrapping around a maximum-size image.
    bodyLimit({
      maxSize: IMAGE_MAX_BYTES + 64 * 1024,
      onError: (c) => c.text('Images must be 5 MB or smaller.', 413),
    }),
    async (c) => {
      const entity = c.req.param('entity');
      if (!isImageEntity(entity)) return c.html(<NotFoundPage auth={c.var.auth} />, 404);
      const id = c.req.param('id');
      const body = await c.req.parseBody();
      let image: string | undefined;
      if (body['remove'] === undefined) {
        const file = body['image'];
        if (!(file instanceof File)) {
          return c.html(
            <MessagePage
              auth={c.var.auth}
              title="Upload failed"
              message="Choose an image to upload."
            />,
            400,
          );
        }
        try {
          image = await saveImage(imagesDir, new Uint8Array(await file.arrayBuffer()));
        } catch (error) {
          if (!(error instanceof ImageError)) throw error;
          return c.html(
            <MessagePage auth={c.var.auth} title="Upload failed" message={error.message} />,
            400,
          );
        }
      }
      const previous = catalog.setImage(entity, id, image, ACTOR);
      // Content-named files can be shared, so only delete one nothing uses any more.
      if (previous && previous !== image && !catalog.imageInUse(previous)) {
        await deleteImage(imagesDir, previous);
      }
      return c.redirect(safeNext(formField(body, 'next')), 303);
    },
  );

  app.post('/sessions/:id/edit', requireAdmin, async (c) => {
    const id = c.req.param('id');
    const body = await c.req.parseBody();
    const hidden = visibility(formField(body, 'hidden'));
    catalog.updateSession(
      id,
      {
        ...(formField(body, 'title') !== undefined && { title: formField(body, 'title') ?? null }),
        ...(formField(body, 'description') !== undefined && {
          description: formField(body, 'description') ?? null,
        }),
        // Sessions have no recorder-side hidden flag, so "default" means visible.
        ...(hidden !== undefined && { hidden: hidden === true }),
      },
      ACTOR,
    );
    return redirectBack(c, `/sessions/${encodeURIComponent(id)}`);
  });

  app.post('/sets/:id/edit', requireAdmin, async (c) => {
    const id = c.req.param('id');
    const body = await c.req.parseBody();
    const text = (name: string) => {
      const value = formField(body, name);
      return value === undefined ? {} : { [name]: value };
    };
    const tags = formField(body, 'tags');
    const hidden = visibility(formField(body, 'hidden'));
    catalog.updateSet(
      id,
      {
        ...text('title'),
        ...text('displayName'),
        ...text('description'),
        ...(tags !== undefined && { tags: splitList(tags, /,/) }),
        ...(hidden !== undefined && { hidden }),
      },
      ACTOR,
    );
    const set = catalog.getSet(id, true);
    return redirectBack(c, set ? setUrl(set) : '/');
  });

  app.post('/streamers/:userId/edit', requireAdmin, async (c) => {
    const userId = c.req.param('userId');
    const body = await c.req.parseBody();
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
    return redirectBack(c, `/streamers/${encodeURIComponent(userId)}`);
  });

  app.get('/admin/activity', requireAdmin, (c) =>
    c.html(<ActivityPage auth={c.var.auth} entries={catalog.recentAudit(200)} />),
  );

  return app;
}
