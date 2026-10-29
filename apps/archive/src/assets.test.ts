import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PUBLIC_DIR, publicFile } from './assets.ts';

describe('publicFile', () => {
  it('serves images and fonts from public/', () => {
    expect(publicFile('og.png')).toEqual({
      file: path.join(PUBLIC_DIR, 'og.png'),
      type: 'image/png',
    });
    expect(publicFile('fonts/Satoshi-Variable.woff2')?.type).toBe('font/woff2');
  });

  it('refuses anything else: text, hidden files, and paths out of the folder', () => {
    for (const relative of [
      'fonts/README.md',
      'fonts/Satoshi-LICENSE.txt',
      '.hidden.png',
      'fonts/.cache/x.woff2',
      '../package.json',
      '../dist/../public/og.png',
      'fonts//og.png',
      '',
    ]) {
      expect(publicFile(relative), relative).toBeUndefined();
    }
  });
});
