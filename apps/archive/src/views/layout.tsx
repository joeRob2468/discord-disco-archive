import { raw } from 'hono/html';
import type { Child } from 'hono/jsx';
import type { AuthState } from '../auth/auth.ts';

const SITE_NAME = 'Stream Archive';
const SITE_DESCRIPTION =
  'Every set from every disco, in one place: recordings of our Discord DJ sessions, leveled and ready to play.';

/** Absolute URLs for a link preview (Open Graph), which chat apps need. */
export interface Preview {
  url: string;
  image: string;
}

/** The site's link preview for the page at `path`, from `ARCHIVE_PUBLIC_URL`. */
export const sitePreview = (publicUrl: string, path = '/'): Preview => ({
  url: new URL(path, publicUrl).href,
  image: new URL('/assets/og.png', publicUrl).href,
});

/**
 * Link preview tags. The viewer password sends crawlers to the login page, so it and
 * the home page carry them; the image is served without logging in.
 */
function PreviewTags({ preview }: { preview: Preview }) {
  return (
    <>
      <meta property="og:type" content="website" />
      <meta property="og:site_name" content={SITE_NAME} />
      <meta property="og:title" content={SITE_NAME} />
      <meta property="og:description" content={SITE_DESCRIPTION} />
      <meta property="og:url" content={preview.url} />
      <meta property="og:image" content={preview.image} />
      <meta property="og:image:type" content="image/png" />
      <meta property="og:image:width" content="1200" />
      <meta property="og:image:height" content="630" />
      <meta property="og:image:alt" content={`${SITE_NAME}: ${SITE_DESCRIPTION}`} />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={SITE_NAME} />
      <meta name="twitter:description" content={SITE_DESCRIPTION} />
      <meta name="twitter:image" content={preview.image} />
    </>
  );
}

export interface LayoutProps {
  title: string;
  auth: AuthState;
  preview?: Preview | undefined;
  /** Pre-fill the header search box. */
  query?: string | undefined;
  children?: Child;
}

/**
 * Applies the saved theme before first paint (dark unless the viewer chose light), and
 * handles the theme toggle, admin edit dialogs (`data-dialog`), set rows that expand
 * into an inline set page (`data-expand`, fetched by htmx) and "Copy link" buttons. Delegated on `document`, so it
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
    // A plain click expands the row; modified clicks still open the link as usual.
    const expand = event.target.closest('[data-expand]');
    if (expand && !(event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)) {
      const box = expand.closest('[data-set-row]')?.querySelector('[data-set-inline]');
      if (box) {
        event.preventDefault();
        const open = box.hidden;
        box.hidden = !open;
        expand.setAttribute('aria-expanded', String(open));
        if (open) htmx.ajax('GET', expand.dataset.expand, { target: box, swap: 'innerHTML' });
        else box.replaceChildren();
        return;
      }
    }
    const opener = event.target.closest('[data-dialog]');
    if (opener) {
      document.getElementById(opener.dataset.dialog)?.showModal();
      return;
    }
    // Close open dropdowns when clicking anywhere outside them.
    for (const open of document.querySelectorAll('details.dropdown[open]')) {
      if (!open.contains(event.target)) open.removeAttribute('open');
    }
    const button = event.target.closest('[data-copy]');
    if (!button) return;
    const text = button.textContent;
    navigator.clipboard.writeText(location.origin + button.dataset.copy).then(() => {
      button.textContent = 'Copied';
      setTimeout(() => { button.textContent = text; }, 1500);
    }, () => {});
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    for (const open of document.querySelectorAll('details.dropdown[open]')) open.removeAttribute('open');
  });
  // A dropdown left open must not survive navigation.
  document.addEventListener('htmx:beforeSwap', () => {
    for (const open of document.querySelectorAll('details.dropdown[open]')) open.removeAttribute('open');
  });
})();
`;

const ICONS = {
  menu: 'M4 6h16M4 12h16M4 18h16',
  home: 'M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  sessions: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  djs: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  admin: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
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

/**
 * The home link's mark: a plain filled flame (Lucide's "flame" outline, ISC), white on the
 * dark theme since it follows the text colour.
 */
function Logo() {
  return (
    <svg class="size-6" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
    </svg>
  );
}

/** `<html>` with the shared head: theme, stylesheet, htmx. */
function Document(props: { title: string; preview?: Preview | undefined; children?: Child }) {
  const { title, preview, children } = props;
  return (
    <>
      {raw('<!doctype html>')}
      <html lang="en" data-theme="dark">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>{`${title} · ${SITE_NAME}`}</title>
          <meta name="description" content={SITE_DESCRIPTION} />
          {/* The hero's teal: also the accent colour Discord gives link embeds. */}
          <meta name="theme-color" content="#14b8a6" />
          <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
          <link rel="apple-touch-icon" href="/assets/apple-touch-icon.png" />
          {preview && <PreviewTags preview={preview} />}
          <script>{raw(PAGE_SCRIPT)}</script>
          <link rel="stylesheet" href="/assets/app.css" />
          {/* Error responses (wrong password, not found) are full pages too: show them. */}
          <meta
            name="htmx-config"
            content='{"responseHandling":[{"code":"204","swap":false},{"code":"...","swap":true}]}'
          />
          <script src="/assets/htmx.min.js" defer></script>
          <script type="module" src="/assets/player.js"></script>
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
          <>
            <li>
              <a href="/search">
                <Icon name="search" class="size-4" /> All sets
              </a>
            </li>
            <li>
              <a href="/sessions">
                <Icon name="sessions" class="size-4" /> Sessions
              </a>
            </li>
            <li>
              <a href="/djs">
                <Icon name="djs" class="size-4" /> DJs
              </a>
            </li>
          </>
        )}
        {auth.isAdmin && (
          <li>
            <a href="/admin">
              <Icon name="admin" class="size-4" /> Admin
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

const CONTROL_ICONS = {
  previous: 'M6 5h2v14H6zM20 5v14L9 12z',
  next: 'M16 5h2v14h-2zM4 5v14l11-7z',
  play: 'M7 4.5v15l12-7.5z',
  pause: 'M6 4h4v16H6zM14 4h4v16h-4z',
  volume: 'M4 9v6h4l5 4V5L8 9zM16 8.5a5 5 0 0 1 0 7',
  stop: 'M6 6h12v12H6z',
  queue: 'M3 5h13v2H3zM3 10h13v2H3zM3 15h8v2H3zM15 14v7l6-3.5z',
} as const;

function ControlIcon({
  name,
  class: className = 'size-5',
}: {
  name: keyof typeof CONTROL_ICONS;
  class?: string;
}) {
  return (
    <svg class={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d={CONTROL_ICONS[name]} />
    </svg>
  );
}

/**
 * The player bar, fixed to the bottom like Spotify's. Hidden until something plays.
 * `hx-preserve` keeps this element (and its audio) across hx-boost page swaps; the
 * behaviour is in client/player.ts.
 */
function PlayerBar() {
  return (
    <section
      id="player"
      hx-preserve="true"
      hidden
      data-state="paused"
      class="bg-base-200 border-base-content/10 fixed inset-x-0 bottom-0 z-40 border-t px-3 py-2 shadow-2xl sm:px-6"
      aria-label="Player"
    >
      <audio id="player-audio" preload="metadata" />
      <div
        id="player-queue"
        hidden
        class="panel absolute right-3 bottom-full mb-2 flex max-h-[60vh] w-[min(26rem,calc(100vw-1.5rem))] flex-col rounded-2xl p-2 sm:right-6"
        aria-label="Queue"
      >
        <div class="flex items-center justify-between px-2 py-1">
          <h2 class="font-bold">Queue</h2>
          <button id="player-queue-clear" type="button" class="btn btn-ghost btn-xs">
            Clear upcoming
          </button>
        </div>
        <ol id="player-queue-list" class="flex flex-col gap-0.5 overflow-y-auto" />
      </div>
      <div class="mx-auto grid max-w-[1400px] grid-cols-[1fr_auto] items-center gap-3 sm:grid-cols-[1fr_2fr_1fr]">
        <div class="flex min-w-0 items-center gap-3">
          <div id="player-art" class="size-12 shrink-0 rounded-lg shadow" />
          <div class="min-w-0">
            <a
              id="player-title"
              class="plain block truncate font-semibold hover:underline"
              href="#"
            />
            <p id="player-subtitle" class="text-base-content/60 truncate text-xs" />
          </div>
        </div>
        {/* On phones its two rows become grid items: controls beside the title, seek below. */}
        <div class="contents sm:flex sm:flex-col sm:items-center sm:gap-1">
          <div class="flex items-center gap-2">
            <button
              id="player-stop"
              type="button"
              class="btn btn-ghost btn-circle btn-sm"
              aria-label="Stop"
              title="Stop"
            >
              <ControlIcon name="stop" class="size-4" />
            </button>
            <button
              id="player-prev"
              type="button"
              class="btn btn-ghost btn-circle btn-sm"
              aria-label="Previous"
            >
              <ControlIcon name="previous" class="size-4" />
            </button>
            <button
              id="player-toggle"
              type="button"
              class="btn btn-circle btn-primary"
              aria-label="Play or pause"
            >
              <ControlIcon name="play" class="player-play size-5" />
              <ControlIcon name="pause" class="player-pause size-5" />
            </button>
            <button
              id="player-next"
              type="button"
              class="btn btn-ghost btn-circle btn-sm"
              aria-label="Next"
            >
              <ControlIcon name="next" class="size-4" />
            </button>
            <button
              id="player-queue-toggle"
              type="button"
              class="btn btn-ghost btn-circle btn-sm"
              aria-label="Queue"
              title="Queue"
              aria-expanded="false"
              aria-controls="player-queue"
            >
              <ControlIcon name="queue" class="size-4" />
            </button>
          </div>
          <div class="col-span-2 flex w-full items-center gap-2 text-xs tabular-nums sm:col-span-1">
            <span id="player-elapsed" class="text-base-content/60 w-12 text-right">
              0:00
            </span>
            <input
              id="player-seek"
              type="range"
              min="0"
              max="1000"
              value="0"
              class="range range-xs range-primary flex-1"
              aria-label="Seek"
            />
            <span id="player-duration" class="text-base-content/60 w-12">
              0:00
            </span>
          </div>
        </div>
        <div class="hidden items-center justify-end gap-2 sm:flex">
          <ControlIcon name="volume" class="text-base-content/60 size-4" />
          <input
            id="player-volume"
            type="range"
            min="0"
            max="1"
            step="0.01"
            value="1"
            class="range range-xs w-28"
            aria-label="Volume"
          />
        </div>
      </div>
    </section>
  );
}

export function Layout({ title, auth, query, preview, children }: LayoutProps) {
  return (
    <Document title={title} preview={preview}>
      <div class="mx-auto max-w-[1400px] p-3 sm:p-6">
        <div class="min-w-0">
          <header class="mb-6 flex items-center gap-2">
            <a
              class="plain btn btn-ghost panel btn-square size-12 rounded-2xl"
              href="/"
              aria-label="Home"
              title="Home"
            >
              <Logo />
            </a>
            {auth.canView ? (
              <form class="flex-1" action="/search" method="get" role="search">
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
      </div>
      <PlayerBar />
    </Document>
  );
}

/** A page with nothing but its content centred: the login page. */
export function BareLayout(props: {
  title: string;
  preview?: Preview | undefined;
  children?: Child;
}) {
  const { title, preview, children } = props;
  return (
    <Document title={title} preview={preview}>
      <main class="grid min-h-screen place-items-center p-4">{children}</main>
    </Document>
  );
}
