/**
 * Copies each DJ's Discord avatar (the `avatarUrl` the recorder saves in `session.json`)
 * into the images folder once, so pages never load images from Discord. Only the first
 * avatar is kept, as a starting picture: an admin's upload replaces it. A failed copy is
 * tried again only if a new URL turns up.
 */
import type { Logger } from '@dsr/core';
import type { Catalog } from './catalog/catalog.ts';
import { IMAGE_MAX_BYTES, saveImage } from './images.ts';

const AVATAR_HOST = 'cdn.discordapp.com';
const TIMEOUT_MS = 10_000;

export class AvatarError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AvatarError';
  }
}

async function download(url: string, fetchImpl: typeof fetch): Promise<Uint8Array> {
  const parsed = URL.parse(url);
  // The URL comes from a file on disk: only ever fetch from Discord's CDN.
  if (parsed?.protocol !== 'https:' || parsed.hostname !== AVATAR_HOST) {
    throw new AvatarError('Not a Discord avatar URL');
  }
  const response = await fetchImpl(parsed, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: 'error',
  });
  if (!response.ok) throw new AvatarError(`Discord answered ${String(response.status)}`);
  if (Number(response.headers.get('content-length')) > IMAGE_MAX_BYTES) {
    throw new AvatarError('Avatar too large');
  }
  return new Uint8Array(await response.arrayBuffer());
}

/** Copy every avatar not yet copied. `saveImage` checks the size and type. */
export async function copyAvatars(
  catalog: Catalog,
  imagesDir: string,
  logger: Logger,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  for (const { userId, url } of catalog.avatarsToCopy()) {
    let image: string | undefined;
    try {
      image = await saveImage(imagesDir, await download(url, fetchImpl));
      logger.info({ userId }, 'avatar copied');
    } catch (error) {
      logger.warn({ err: error, userId, url }, 'could not copy avatar');
    }
    catalog.setAvatarImage(userId, url, image);
  }
}

/** `copyAvatars` as a fire-and-forget trigger that never runs twice at once. */
export function avatarCopier(catalog: Catalog, imagesDir: string, logger: Logger): () => void {
  let running = false;
  return () => {
    if (running) return;
    running = true;
    copyAvatars(catalog, imagesDir, logger)
      .catch((error: unknown) => {
        logger.error({ err: error }, 'avatar copying failed');
      })
      .finally(() => {
        running = false;
      });
  };
}
