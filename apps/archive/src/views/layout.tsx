import { raw } from 'hono/html';
import type { Child } from 'hono/jsx';
import type { AuthState } from '../auth/auth.ts';

export interface LayoutProps {
  title: string;
  auth: AuthState;
  /** Pre-fill the header search box. */
  query?: string | undefined;
  children?: Child;
}

export function Layout({ title, auth, query, children }: LayoutProps) {
  return (
    <>
      {raw('<!doctype html>')}
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>{`${title} · Stream Archive`}</title>
          <link rel="stylesheet" href="/assets/style.css" />
        </head>
        <body>
          <header>
            <a class="brand" href="/">
              Stream Archive
            </a>
            {auth.canView && (
              <nav>
                <a href="/sessions">Sessions</a>
                <a href="/streamers">Streamers</a>
                <a href="/tags">Tags</a>
                {auth.isAdmin && <a href="/admin/activity">Activity</a>}
              </nav>
            )}
            {auth.canView && (
              <form class="search" action="/search" method="get" role="search">
                <input
                  type="search"
                  name="q"
                  value={query ?? ''}
                  placeholder="Search sets…"
                  aria-label="Search"
                />
              </form>
            )}
            <AccountControls auth={auth} />
          </header>
          <main>{children}</main>
        </body>
      </html>
    </>
  );
}

function AccountControls({ auth }: { auth: AuthState }) {
  if (auth.role !== undefined) {
    return (
      <form class="inline" action="/logout" method="post">
        <span class="muted small">{auth.isAdmin ? 'Admin' : 'Signed in'} </span>
        <button class="secondary" type="submit">
          Log out
        </button>
      </form>
    );
  }
  if (auth.adminEnabled || auth.viewerPasswordRequired) {
    return (
      <a class="small" href="/login">
        Log in
      </a>
    );
  }
  return null;
}
