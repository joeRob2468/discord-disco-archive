/** Login and logout. */
import type { Logger } from '@dsr/core';
import { Hono } from 'hono';
import { safeNext, type Auth, type AuthEnv } from '../auth/auth.ts';
import { clientIp } from '../client-ip.ts';
import { sitePreview } from '../views/layout.tsx';
import { LoginPage, NotFoundPage } from '../views/pages.tsx';
import { formField } from './params.ts';

export function sessionRoutes(auth: Auth, publicUrl: string, logger?: Logger): Hono<AuthEnv> {
  // Crawlers land on /login when a viewer password is set; show the site's preview there.
  const preview = sitePreview(publicUrl);
  const app = new Hono<AuthEnv>();
  const loginEnabled = auth.adminEnabled || auth.viewerPasswordRequired;

  app.get('/login', (c) => {
    if (!loginEnabled) return c.html(<NotFoundPage auth={c.var.auth} />, 404);
    return c.html(<LoginPage next={safeNext(c.req.query('next'))} preview={preview} />);
  });

  app.post('/login', async (c) => {
    if (!loginEnabled) return c.html(<NotFoundPage auth={c.var.auth} />, 404);
    const body = await c.req.parseBody();
    const next = safeNext(formField(body, 'next'));
    const role = await auth.checkPassword(formField(body, 'password') ?? '');
    if (!role) {
      logger?.warn({ ip: clientIp(c) }, 'login failed: wrong password');
      return c.html(<LoginPage next={next} error="Wrong password." />, 401);
    }
    await auth.login(c, role);
    logger?.info({ role, ip: clientIp(c) }, 'logged in');
    return c.redirect(next, 303);
  });

  app.post('/logout', (c) => {
    if (c.var.auth.role) logger?.info({ role: c.var.auth.role, ip: clientIp(c) }, 'logged out');
    auth.logout(c);
    return c.redirect('/', 303);
  });

  return app;
}
