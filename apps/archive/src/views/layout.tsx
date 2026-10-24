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
 * handles the theme toggle. Delegated on `document`, so it survives hx-boost swaps.
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
  // "Copy link" buttons: copy the absolute URL of their data-copy path.
  document.addEventListener('click', (event) => {
    const button = event.target instanceof Element && event.target.closest('[data-copy]');
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

function RailLink({
  href,
  icon,
  label,
}: {
  href: string;
  icon: keyof typeof ICONS;
  label: string;
}) {
  return (
    <a
      href={href}
      class="btn btn-ghost btn-square tooltip tooltip-right rounded-2xl"
      data-tip={label}
      aria-label={label}
    >
      <Icon name={icon} />
    </a>
  );
}

function ThemeButton() {
  return (
    <button
      type="button"
      class="btn btn-ghost btn-square rounded-2xl"
      data-theme-toggle
      aria-label="Toggle light or dark theme"
      title="Toggle light or dark theme"
    >
      <Icon name="theme" />
    </button>
  );
}

function AccountButton({ auth }: { auth: AuthState }) {
  if (auth.role !== undefined) {
    return (
      <form action="/logout" method="post">
        <button
          class="btn btn-ghost btn-square rounded-2xl"
          type="submit"
          aria-label="Log out"
          title={`Log out (${auth.isAdmin ? 'admin' : 'viewer'})`}
        >
          <Icon name="logout" />
        </button>
      </form>
    );
  }
  if (auth.adminEnabled || auth.viewerPasswordRequired) {
    return (
      <a
        class="btn btn-ghost btn-square rounded-2xl"
        href="/login"
        aria-label="Log in"
        title="Log in"
      >
        <Icon name="login" />
      </a>
    );
  }
  return null;
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
        <body hx-boost="true" class="bg-base-300 min-h-screen">
          <div class="backdrop" aria-hidden="true" />
          <div class="mx-auto flex max-w-[1500px] gap-6 p-3 sm:p-6">
            <nav class="panel sticky top-6 hidden h-[calc(100vh-3rem)] w-20 shrink-0 flex-col items-center gap-3 rounded-3xl py-6 lg:flex">
              <a href="/" class="text-primary mb-4 text-sm font-black tracking-widest">
                DSR
              </a>
              <RailLink href="/" icon="home" label="Home" />
              {auth.isAdmin && <RailLink href="/admin/activity" icon="activity" label="Activity" />}
              <div class="flex-1" />
              <ThemeButton />
              <AccountButton auth={auth} />
            </nav>
            <div class="min-w-0 flex-1">
              <header class="mb-6 flex items-center gap-2">
                <a href="/" class="text-primary mr-1 text-sm font-black tracking-widest lg:hidden">
                  DSR
                </a>
                {auth.canView && (
                  <form class="ui flex-1" action="/" method="get" role="search">
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
                )}
                <div class="flex gap-1 lg:hidden">
                  <ThemeButton />
                  <AccountButton auth={auth} />
                </div>
              </header>
              <main>{children}</main>
            </div>
            <NowPlayingPanel />
          </div>
        </body>
      </html>
    </>
  );
}
