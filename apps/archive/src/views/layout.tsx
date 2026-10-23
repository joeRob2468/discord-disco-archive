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

/**
 * Applies the saved theme before first paint (dark unless the viewer chose light), and
 * handles the navbar toggle. Delegated on `document`, so it survives hx-boost swaps.
 */
const THEME_SCRIPT = `
(() => {
  const root = document.documentElement;
  try { if (localStorage.getItem('theme') === 'light') root.dataset.theme = 'light'; } catch {}
  document.addEventListener('click', (event) => {
    if (!(event.target instanceof Element) || !event.target.closest('[data-theme-toggle]')) return;
    const next = root.dataset.theme === 'light' ? 'dark' : 'light';
    root.dataset.theme = next;
    try { localStorage.setItem('theme', next); } catch {}
  });
})();
`;

const NAV_LINKS = [
  ['/sessions', 'Sessions'],
  ['/streamers', 'Streamers'],
  ['/tags', 'Tags'],
] as const;

function NavItems({ auth }: { auth: AuthState }) {
  if (!auth.canView) return null;
  return (
    <>
      {NAV_LINKS.map(([href, label]) => (
        <li>
          <a href={href}>{label}</a>
        </li>
      ))}
      {auth.isAdmin && (
        <li>
          <a href="/admin/activity">Activity</a>
        </li>
      )}
    </>
  );
}

export function Layout({ title, auth, query, children }: LayoutProps) {
  return (
    <>
      {raw('<!doctype html>')}
      <html lang="en" data-theme="dark">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>{`${title} · Stream Archive`}</title>
          <script>{raw(THEME_SCRIPT)}</script>
          <link rel="stylesheet" href="/assets/app.css" />
          {/* Error responses (wrong password, not found) are full pages too: show them. */}
          <meta
            name="htmx-config"
            content='{"responseHandling":[{"code":"204","swap":false},{"code":"...","swap":true}]}'
          />
          <script src="/assets/htmx.min.js" defer></script>
        </head>
        <body hx-boost="true">
          <div class="drawer">
            <input id="nav-drawer" type="checkbox" class="drawer-toggle" />
            <div class="drawer-content flex min-h-screen flex-col">
              <header class="navbar bg-base-200 border-base-300 gap-2 border-b px-2 lg:px-4">
                {auth.canView && (
                  <label
                    for="nav-drawer"
                    class="btn btn-square btn-ghost lg:hidden"
                    aria-label="Open menu"
                  >
                    <svg
                      class="size-5"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                    >
                      <path d="M4 6h16M4 12h16M4 18h16" />
                    </svg>
                  </label>
                )}
                <a class="btn btn-ghost px-2 text-lg font-bold" href="/">
                  Stream Archive
                </a>
                <ul class="menu menu-horizontal hidden gap-1 lg:flex">
                  <NavItems auth={auth} />
                </ul>
                <div class="flex-1" />
                {auth.canView && (
                  <form class="hidden sm:block" action="/search" method="get" role="search">
                    <input
                      class="input input-sm w-48 lg:w-64"
                      type="search"
                      name="q"
                      value={query ?? ''}
                      placeholder="Search sets…"
                      aria-label="Search"
                    />
                  </form>
                )}
                <button
                  type="button"
                  class="btn btn-ghost btn-square btn-sm"
                  data-theme-toggle
                  aria-label="Toggle light or dark theme"
                  title="Toggle light or dark theme"
                >
                  <svg
                    class="size-5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                  >
                    <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
                  </svg>
                </button>
                <AccountControls auth={auth} />
              </header>
              <main class="mx-auto w-full max-w-5xl flex-1 px-4 pt-6 pb-16">{children}</main>
            </div>
            <div class="drawer-side z-40">
              <label for="nav-drawer" class="drawer-overlay" aria-label="Close menu"></label>
              <div class="bg-base-200 min-h-full w-64 p-4">
                <a class="mb-4 block px-2 text-lg font-bold" href="/">
                  Stream Archive
                </a>
                {auth.canView && (
                  <form class="mb-4" action="/search" method="get" role="search">
                    <input
                      class="input input-sm w-full"
                      type="search"
                      name="q"
                      value={query ?? ''}
                      placeholder="Search sets…"
                      aria-label="Search"
                    />
                  </form>
                )}
                <ul class="menu w-full p-0">
                  <NavItems auth={auth} />
                </ul>
              </div>
            </div>
          </div>
        </body>
      </html>
    </>
  );
}

function AccountControls({ auth }: { auth: AuthState }) {
  if (auth.role !== undefined) {
    return (
      <form class="flex items-center gap-2" action="/logout" method="post">
        <span class="badge badge-ghost badge-sm hidden sm:inline-flex">
          {auth.isAdmin ? 'Admin' : 'Signed in'}
        </span>
        <button class="btn btn-ghost btn-sm" type="submit">
          Log out
        </button>
      </form>
    );
  }
  if (auth.adminEnabled || auth.viewerPasswordRequired) {
    return (
      <a class="btn btn-ghost btn-sm" href="/login">
        Log in
      </a>
    );
  }
  return null;
}
