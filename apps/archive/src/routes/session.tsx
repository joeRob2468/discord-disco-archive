/** Login and logout. */
import type { Logger } from '@dsr/core';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { safeNext, type Auth, type AuthEnv } from '../auth/auth.ts';
import { clientKey, LoginLimiter } from '../auth/login-limiter.ts';
import { clientIp } from '../client-ip.ts';
import { sitePreview } from '../views/layout.tsx';
import { LoginPage, NotFoundPage } from '../views/pages.tsx';
import { formField } from './params.ts';

/** A login form is a password and a `next` path; anything bigger is refused unread. */
const LOGIN_BODY_LIMIT = 16 * 1024;

export function sessionRoutes(
  auth: Auth,
  publicUrl: string,
  logger?: Logger,
  limiter = new LoginLimiter(),
): Hono<AuthEnv> {
  // Crawlers land on /login when a viewer password is set; show the site's preview there.
  const preview = sitePreview(publicUrl);
  const app = new Hono<AuthEnv>();
  const loginEnabled = auth.adminEnabled || auth.viewerPasswordRequired;

  app.get('/login', (c) => {
    if (!loginEnabled) return c.html(<NotFoundPage auth={c.var.auth} />, 404);
    return c.html(<LoginPage next={safeNext(c.req.query('next'))} preview={preview} />);
  });

  app.post(
    '/login',
    bodyLimit({ maxSize: LOGIN_BODY_LIMIT, onError: (c) => c.text('Too large.', 413) }),
    async (c) => {
      if (!loginEnabled) return c.html(<NotFoundPage auth={c.var.auth} />, 404);
      const body = await c.req.parseBody();
      const next = safeNext(formField(body, 'next'));
      const ip = clientIp(c);
      const client = clientKey(ip);
      // Checked before the password, so a blocked client learns nothing from it.
      const retryAfter = limiter.take(client);
      if (retryAfter > 0) {
        logger?.warn({ ip, retryAfter }, 'login refused: too many attempts');
        c.header('Retry-After', String(retryAfter));
        const minutes = Math.ceil(retryAfter / 60);
        return c.html(
          <LoginPage
            next={next}
            error={`Too many attempts. Try again in ${String(minutes)} minute${minutes === 1 ? '' : 's'}.`}
          />,
          429,
        );
      }
      const role = await auth.checkPassword(formField(body, 'password') ?? '');
      if (!role) {
        logger?.warn({ ip }, 'login failed: wrong password');
        return c.html(<LoginPage next={next} error="Wrong password." />, 401);
      }
      limiter.succeeded(client);
      await auth.login(c, role);
      logger?.info({ role, ip }, 'logged in');
      return c.redirect(next, 303);
    },
  );

  app.post('/logout', (c) => {
    if (c.var.auth.role) logger?.info({ role: c.var.auth.role, ip: clientIp(c) }, 'logged out');
    auth.logout(c);
    return c.redirect('/', 303);
  });

  return app;
}
