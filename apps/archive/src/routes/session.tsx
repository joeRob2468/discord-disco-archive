/** Login and logout. */
import { Hono } from 'hono';
import { safeNext, type Auth, type AuthEnv } from '../auth/auth.ts';
import { LoginPage, NotFoundPage } from '../views/pages.tsx';
import { formField } from './params.ts';

export function sessionRoutes(auth: Auth): Hono<AuthEnv> {
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
      return c.html(<LoginPage next={next} error="Wrong password." />, 401);
    }
    await auth.login(c, role);
    return c.redirect(next, 303);
  });

  app.post('/logout', (c) => {
    auth.logout(c);
    return c.redirect('/', 303);
  });

  return app;
}
