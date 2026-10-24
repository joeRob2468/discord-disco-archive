import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deleteImage, detectImage, IMAGE_NAME, ImageError, saveImage } from './images.ts';
import { PNG } from './test/fixtures.ts';

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const WEBP = new TextEncoder().encode('RIFF\u0000\u0000\u0000\u0000WEBPVP8 ');

describe('detectImage', () => {
  it('recognises PNG, JPEG and WebP by their bytes', () => {
    expect(detectImage(PNG)).toBe('png');
    expect(detectImage(JPEG)).toBe('jpg');
    expect(detectImage(WEBP)).toBe('webp');
  });

  it('rejects anything else, whatever it claims to be', () => {
    expect(detectImage(new TextEncoder().encode('<svg onload=alert(1)>'))).toBeUndefined();
    expect(detectImage(new Uint8Array())).toBeUndefined();
  });
});

describe('saveImage', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'dsr-images-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('stores by content hash, so identical uploads share a file', async () => {
    const name = await saveImage(dir, PNG);
    expect(name).toMatch(IMAGE_NAME);
    expect(await saveImage(dir, PNG)).toBe(name);
    expect(await readdir(dir)).toEqual([name]);
    await deleteImage(dir, name);
    expect(await readdir(dir)).toEqual([]);
  });

  it('refuses unsupported or oversized files', async () => {
    await expect(saveImage(dir, new TextEncoder().encode('GIF89a'))).rejects.toThrow(ImageError);
    await expect(saveImage(dir, new Uint8Array(6 * 1024 * 1024))).rejects.toThrow(/5 MB/);
  });
});
