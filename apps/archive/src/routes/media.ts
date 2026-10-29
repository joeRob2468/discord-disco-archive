/**
 * Streams set files from the read-only recordings volume, with Range support so seeking
 * works. Files are looked up through the catalog, so hidden sets stay hidden and request
 * paths never touch the filesystem directly. With a `limiter`, each client's media
 * bandwidth is capped (`ARCHIVE_DOWNLOAD_LIMIT_MBPS`). Downloads (`?download`) are counted.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import type { SetFiles } from '@dsr/core';
import { Hono } from 'hono';
import type { AuthEnv } from '../auth/auth.ts';
import type { BandwidthLimiter } from '../bandwidth.ts';
import type { Catalog, SetSummary } from '../catalog/catalog.ts';
import { clientIp } from '../client-ip.ts';
import { IMAGE_NAME, imageMime } from '../images.ts';
import { formatDate } from '../views/format.ts';

// serveStatic's MIME table lacks some of these (e.g. .m4a), and browsers need the right
// type to play them, so set it explicitly.
const FORMATS = {
  master: { file: 'master', ext: 'flac', mime: 'audio/flac' },
  mp3: { file: 'mp3', ext: 'mp3', mime: 'audio/mpeg' },
  m4a: { file: 'm4a', ext: 'm4a', mime: 'audio/mp4' },
  // The float32 capture (or an uploaded set's original file; see `fileType`), playable
  // before (or without) leveling.
  raw: { file: 'rawAudio', ext: 'wav', mime: 'audio/wav' },
} as const satisfies Record<string, { file: keyof SetFiles; ext: string; mime: string }>;

/** Types of uploaded originals (`uploads.ts`), by extension. */
const RAW_MIME: Record<string, string> = {
  wav: 'audio/wav',
  flac: 'audio/flac',
  aiff: 'audio/aiff',
  aif: 'audio/aiff',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  wma: 'audio/x-ms-wma',
  mp4: 'video/mp4',
  mkv: 'video/x-matroska',
  mov: 'video/quicktime',
  webm: 'video/webm',
};

/** The served file's extension and type: from its name for an uploaded original. */
function fileType(format: Format, relative: string): { ext: string; mime: string } {
  if (format !== 'raw') return FORMATS[format];
  const ext = path.extname(relative).slice(1).toLowerCase();
  return { ext, mime: RAW_MIME[ext] ?? 'application/octet-stream' };
}

type Format = keyof typeof FORMATS;

const isFormat = (value: string): value is Format => Object.hasOwn(FORMATS, value);

/** `DJ - Title (Nov 14, 2026).mp3`, minus characters that upset filesystems. */
function downloadName(set: SetSummary, ext: string): string {
  const label = set.title ?? set.sessionTitle;
  const base = `${set.name} - ${label} (${formatDate(set.sessionStartedAt)})`;
  return `${base.replace(/[\\/:*?"<>|\p{Cc}]+/gu, '').trim()}.${ext}`;
}

function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/**
 * Whether a download request starts a download. Download managers fetch one file in
 * several ranges, and resumes ask for the rest, so only the piece from byte 0 counts.
 */
export function countsAsDownload(
  method: string,
  range: string | undefined,
  status: number,
): boolean {
  if (method !== 'GET' || status >= 300) return false;
  return range === undefined || range.trim().startsWith('bytes=0-');
}

export function mediaRoutes(
  catalog: Catalog,
  recordingsDir: string,
  imagesDir: string,
  limiter?: BandwidthLimiter,
): Hono<AuthEnv> {
  const app = new Hono<AuthEnv>();

  // Uploaded images. Names are content hashes, so a URL's bytes never change.
  app.get('/images/:name', async (c) => {
    const name = c.req.param('name');
    if (!IMAGE_NAME.test(name)) return c.notFound();
    try {
      const bytes = await readFile(path.join(imagesDir, name));
      c.header('Content-Type', imageMime(name));
      c.header('Cache-Control', 'private, max-age=31536000, immutable');
      return c.body(bytes);
    } catch {
      // Missing file (e.g. removed by an admin): a plain 404.
      return c.notFound();
    }
  });
  const root = path.resolve(recordingsDir);

  app.get('/media/:setId/:format', async (c, next) => {
    const format = c.req.param('format');
    if (!isFormat(format)) return c.notFound();
    const set = catalog.getSet(c.req.param('setId'), c.var.auth.isAdmin);
    const relative = set?.files[FORMATS[format].file];
    if (!set || !relative) return c.notFound();

    // Paths come from session.json; still refuse anything that escapes the session folder.
    const sessionDir = path.join(root, set.sessionDir);
    const file = path.resolve(sessionDir, relative);
    if (!file.startsWith(sessionDir + path.sep)) return c.notFound();

    const type = fileType(format, relative);
    const download = c.req.query('download') !== undefined;
    if (download) {
      c.header('Content-Disposition', contentDisposition(downloadName(set, type.ext)));
    }
    c.header('Cache-Control', 'private, max-age=3600');

    const response = await serveStatic<AuthEnv>({ root: '/', path: file })(c, next);
    if (!response) return c.notFound();
    response.headers.set('Content-Type', type.mime);
    if (download && countsAsDownload(c.req.method, c.req.header('range'), response.status)) {
      catalog.recordDownload(set.id);
    }
    if (!limiter || !response.body) return response;
    // Without a proxy (local dev) every request counts as one client.
    const throttled = limiter.throttle(response.body, clientIp(c) ?? 'direct');
    return new Response(throttled, { status: response.status, headers: response.headers });
  });

  return app;
}
