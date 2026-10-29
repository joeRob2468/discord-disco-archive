/**
 * Static assets. Built files (the Tailwind and esbuild output) and htmx from node_modules
 * are listed in `ASSETS`; pages link them through `assetUrl`, which adds a version, so a
 * new build is fetched at once while unchanged files stay cached. Hand-made files (icons,
 * the link preview image, the font: see public/fonts) live in `public/` and are served
 * under `/assets/` by `publicFile`, images and fonts only.
 */
import { statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
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
  // Browsers look for the icon at the root, so it's served there rather than under /assets/.
  [
    '/favicon.svg',
    fileURLToPath(new URL('../public/favicon.svg', import.meta.url)),
    'image/svg+xml',
  ],
] as const;

/** Hand-made static files, served at `/assets/<path>`. */
export const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));

/** What `public/` may serve, by extension: images and fonts, never text like its READMEs. */
const PUBLIC_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  woff2: 'font/woff2',
};

/**
 * The file in `public/` for `/assets/<relative>`, with its type; undefined for any other
 * kind of file, a hidden one, or a path that leaves the folder.
 */
export function publicFile(relative: string): { file: string; type: string } | undefined {
  const type = PUBLIC_TYPES[path.extname(relative).slice(1).toLowerCase()];
  if (!type || relative.split('/').some((part) => part === '' || part.startsWith('.'))) {
    return undefined;
  }
  const file = path.resolve(PUBLIC_DIR, relative);
  return file.startsWith(PUBLIC_DIR) ? { file, type } : undefined;
}

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
