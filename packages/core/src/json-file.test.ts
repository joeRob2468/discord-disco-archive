import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { JsonFileError, readJsonFile, writeJsonFileAtomic } from './json-file.ts';

const schema = z.object({ n: z.number() });

describe('json files', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'dsr-core-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('round-trips and leaves no temp files behind', async () => {
    const file = path.join(dir, 'nested', 'data.json');
    await writeJsonFileAtomic(file, { n: 1 });
    expect(await readJsonFile(file, schema)).toEqual({ n: 1 });
    expect(await readdir(path.dirname(file))).toEqual(['data.json']);
  });

  it('returns undefined for a missing file', async () => {
    expect(await readJsonFile(path.join(dir, 'missing.json'), schema)).toBeUndefined();
  });

  it('rejects data that does not match the schema', async () => {
    const file = path.join(dir, 'bad.json');
    await writeFile(file, '{"n":"one"}');
    await expect(readJsonFile(file, schema)).rejects.toBeInstanceOf(JsonFileError);
  });
});
