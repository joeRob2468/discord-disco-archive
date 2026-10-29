/**
 * Static assets: the Tailwind and esbuild output, htmx from node_modules, and the icons.
 * Pages link the app's own builds through `assetUrl`, which adds a version, so a new
 * build is fetched at once while unchanged files stay cached.
 */
import { statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

/** Route, file and content type of each asset. */
export const ASSETS = [
  [
    '/assets/app.css',
    fileURLToPath(new URL('../dist/app.css', import.meta.url)),
    'text/css; charset=utf-8',
  ],
  [
    '/assets/player.js',
    fileURLToPath(new URL('../dist/player.js', import.meta.url)),
    'text/javascript; charset=utf-8',
  ],
  [
    '/assets/admin.js',
    fileURLToPath(new URL('../dist/admin.js', import.meta.url)),
    'text/javascript; charset=utf-8',
  ],
  [
    '/assets/htmx.min.js',
    require.resolve('htmx.org/dist/htmx.min.js'),
    'text/javascript; charset=utf-8',
  ],
  ['/assets/og.png', fileURLToPath(new URL('views/static/og.png', import.meta.url)), 'image/png'],
  [
    '/assets/apple-touch-icon.png',
    fileURLToPath(new URL('views/static/apple-touch-icon.png', import.meta.url)),
    'image/png',
  ],
  [
    '/favicon.svg',
    fileURLToPath(new URL('views/static/favicon.svg', import.meta.url)),
    'image/svg+xml',
  ],
] as const;

type AssetRoute = (typeof ASSETS)[number][0];

/**
 * `route` with `?v=` from the file's modification time and size. Read on every call (a
 * stat, no file read), so `dev` picks up rebuilds without restarting. Unversioned if the
 * file is missing (dist/ not built yet).
 */
export function assetUrl(route: AssetRoute): string {
  const file = ASSETS.find(([r]) => r === route)?.[1];
  try {
    const { mtimeMs, size } = statSync(file ?? '');
    return `${route}?v=${Math.floor(mtimeMs).toString(36)}${size.toString(36)}`;
  } catch {
    return route;
  }
}
