/** Login and logout. */
import type { Logger } from '@dsr/core';
import { Hono, type Context } from 'hono';
import { safeNext, type Auth, type AuthEnv } from '../auth/auth.ts';
import { LoginPage, NotFoundPage } from '../views/pages.tsx';
import { formField } from './params.ts';

/** The client's address as Traefik reports it, for spotting password guessing. */
const clientIp = (c: Context): string | undefined =>
  c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? c.req.header('x-real-ip');

export function sessionRoutes(auth: Auth, logger?: Logger): Hono<AuthEnv> {
  const app = new Hono<AuthEnv>();
  const loginEnabled = auth.adminEnabled || auth.viewerPasswordRequired;

  app.get('/login', (c) => {
    if (!loginEnabled) return c.html(<NotFoundPage auth={c.var.auth} />, 404);
    return c.html(<LoginPage next={safeNext(c.req.query('next'))} />);
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
