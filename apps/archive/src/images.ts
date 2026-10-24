/**
 * Admin-uploaded images (DJ pictures, set art, album covers), stored in the archive's
 * own data directory, never in the read-only recordings. Files are named by a hash of
 * their content, so they can be cached forever and identical uploads share a file.
 */
import { createHash } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;

const TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
} as const;

type ImageExt = keyof typeof TYPES;

/** `<32 hex chars>.<ext>`: the only names `/images/:name` will serve. */
export const IMAGE_NAME = /^[0-9a-f]{32}\.(png|jpg|webp)$/;

export const imagesDir = (dataDir: string): string => path.join(dataDir, 'images');

const startsWith = (bytes: Uint8Array, prefix: readonly number[], offset = 0): boolean =>
  prefix.every((byte, i) => bytes[offset + i] === byte);

/** The image type from the file's magic bytes; the browser's claimed type isn't trusted. */
export function detectImage(bytes: Uint8Array): ImageExt | undefined {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpg';
  // RIFF....WEBP
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return 'webp';
  }
  return undefined;
}

export const imageMime = (name: string): string => TYPES[path.extname(name).slice(1) as ImageExt];

export class ImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageError';
  }
}

/** Validate and store an upload. Returns its file name. */
export async function saveImage(dir: string, bytes: Uint8Array): Promise<string> {
  if (bytes.byteLength === 0) throw new ImageError('The file is empty.');
  if (bytes.byteLength > IMAGE_MAX_BYTES) throw new ImageError('Images must be 5 MB or smaller.');
  const ext = detectImage(bytes);
  if (!ext) throw new ImageError('Only PNG, JPEG and WebP images are supported.');
  const name = `${createHash('sha256').update(bytes).digest('hex').slice(0, 32)}.${ext}`;
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, name), bytes);
  return name;
}

export async function deleteImage(dir: string, name: string): Promise<void> {
  if (!IMAGE_NAME.test(name)) return;
  await rm(path.join(dir, name), { force: true });
}
