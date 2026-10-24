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
 * handles the theme toggle and "Copy link" buttons. Delegated on `document`, so it
 * survives hx-boost swaps.
 */
const PAGE_SCRIPT = `
(() => {
  const root = document.documentElement;
  try { if (localStorage.getItem('theme') === 'light') root.dataset.theme = 'light'; } catch {}
  document.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;
    if (event.target.closest('[data-theme-toggle]')) {
      const next = root.dataset.theme === 'light' ? 'dark' : 'light';
      root.dataset.theme = next;
      try { localStorage.setItem('theme', next); } catch {}
      return;
    }
    const button = event.target.closest('[data-copy]');
    if (!button) return;
    const text = button.textContent;
    navigator.clipboard.writeText(location.origin + button.dataset.copy).then(() => {
      button.textContent = 'Copied';
      setTimeout(() => { button.textContent = text; }, 1500);
    }, () => {});
  });
})();
`;

const ICONS = {
  menu: 'M4 6h16M4 12h16M4 18h16',
  home: 'M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  activity: 'M3 12h4l3 8 4-16 3 8h4',
  theme: 'M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z',
  login: 'M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  search: 'M21 21l-4.3-4.3M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14z',
} as const;

export function Icon({
  name,
  class: className = 'size-5',
}: {
  name: keyof typeof ICONS;
  class?: string;
}) {
  return (
    <svg
      class={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d={ICONS[name]} />
    </svg>
  );
}

/** `<html>` with the shared head: theme, stylesheet, htmx. */
function Document({ title, children }: { title: string; children?: Child }) {
  return (
    <>
      {raw('<!doctype html>')}
      <html lang="en" data-theme="dark">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>{`${title} · Stream Archive`}</title>
          <script>{raw(PAGE_SCRIPT)}</script>
          <link rel="stylesheet" href="/assets/app.css" />
          {/* Error responses (wrong password, not found) are full pages too: show them. */}
          <meta
            name="htmx-config"
            content='{"responseHandling":[{"code":"204","swap":false},{"code":"...","swap":true}]}'
          />
          <script src="/assets/htmx.min.js" defer></script>
        </head>
        <body hx-boost="true" class="min-h-screen">
          <div class="backdrop" aria-hidden="true" />
          {children}
        </body>
      </html>
    </>
  );
}

/** The menu button beside the search bar: navigation, theme and account. */
function Menu({ auth }: { auth: AuthState }) {
  const loginEnabled = auth.adminEnabled || auth.viewerPasswordRequired;
  return (
    <details class="dropdown dropdown-end">
      <summary class="btn btn-ghost panel btn-square size-12 rounded-2xl" aria-label="Menu">
        <Icon name="menu" />
      </summary>
      <ul class="menu dropdown-content bg-base-200 border-base-content/10 rounded-box z-50 mt-2 w-56 border p-2 shadow-2xl">
        <li>
          <a href="/">
            <Icon name="home" class="size-4" /> Home
          </a>
        </li>
        {auth.canView && (
          <li>
            <a href="/search">
              <Icon name="search" class="size-4" /> All sets
            </a>
          </li>
        )}
        {auth.isAdmin && (
          <li>
            <a href="/admin/activity">
              <Icon name="activity" class="size-4" /> Activity
            </a>
          </li>
        )}
        <li>
          <button type="button" data-theme-toggle>
            <Icon name="theme" class="size-4" /> Light / dark
          </button>
        </li>
        {auth.role !== undefined ? (
          <li>
            <form class="p-0" action="/logout" method="post">
              <button class="flex w-full items-center gap-2 px-3 py-1.5" type="submit">
                <Icon name="logout" class="size-4" /> Log out
                <span class="badge badge-ghost badge-sm ml-auto">
                  {auth.isAdmin ? 'admin' : 'viewer'}
                </span>
              </button>
            </form>
          </li>
        ) : (
          loginEnabled && (
            <li>
              <a href="/login">
                <Icon name="login" class="size-4" /> Log in
              </a>
            </li>
          )
        )}
      </ul>
    </details>
  );
}

/** The right-hand "Now playing" panel; the player fills it in stage 3 of the UI rewrite. */
function NowPlayingPanel() {
  return (
    <aside class="hidden w-80 shrink-0 xl:block">
      <div class="panel sticky top-6 rounded-3xl p-5">
        <div class="from-primary/60 to-secondary/60 aspect-square rounded-2xl bg-gradient-to-br" />
        <p class="mt-4 text-lg font-semibold">Nothing playing</p>
        <p class="text-base-content/60 text-sm">Pick a set to start listening.</p>
      </div>
    </aside>
  );
}

export function Layout({ title, auth, query, children }: LayoutProps) {
  return (
    <Document title={title}>
      <div class="mx-auto flex max-w-[1500px] gap-6 p-3 sm:p-6">
        <div class="min-w-0 flex-1">
          <header class="mb-6 flex items-center gap-2">
            <a href="/" class="text-primary mr-1 text-sm font-black tracking-widest">
              DSR
            </a>
            {auth.canView ? (
              <form class="ui flex-1" action="/search" method="get" role="search">
                <label class="input panel h-12 w-full rounded-2xl border-0">
                  <Icon name="search" class="size-5 opacity-60" />
                  <input
                    class="grow"
                    type="search"
                    name="q"
                    value={query ?? ''}
                    placeholder="Search sets, DJs, sessions…"
                    aria-label="Search"
                  />
                </label>
              </form>
            ) : (
              <div class="flex-1" />
            )}
            <Menu auth={auth} />
          </header>
          <main>{children}</main>
        </div>
        <NowPlayingPanel />
      </div>
    </Document>
  );
}

/** A page with nothing but its content centred: the login page. */
export function BareLayout({ title, children }: { title: string; children?: Child }) {
  return (
    <Document title={title}>
      <main class="grid min-h-screen place-items-center p-4">{children}</main>
    </Document>
  );
}
