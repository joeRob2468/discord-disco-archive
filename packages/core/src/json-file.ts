import { randomBytes } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

export class JsonFileError extends Error {
  readonly filePath: string;

  constructor(filePath: string, message: string, options?: ErrorOptions) {
    super(`${filePath}: ${message}`, options);
    this.name = 'JsonFileError';
    this.filePath = filePath;
  }
}

/** Read and validate a JSON file. Returns `undefined` if it doesn't exist. */
export async function readJsonFile<T extends z.ZodType>(
  filePath: string,
  schema: T,
): Promise<z.output<T> | undefined> {
  let text: string;
  try {
    text = await readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new JsonFileError(filePath, 'invalid JSON', { cause: error });
  }

  const result = schema.safeParse(data);
  if (!result.success) {
    throw new JsonFileError(filePath, z.prettifyError(result.error), { cause: result.error });
  }
  return result.data;
}

/**
 * Write JSON so readers never see a half-written file: write a temp file in the same
 * directory, fsync it, then rename over the target.
 */
export async function writeJsonFileAtomic(filePath: string, data: unknown): Promise<void> {
  const dir = path.dirname(filePath);
  await mkdir(dir, { recursive: true });
  const tmpPath = path.join(
    dir,
    `.${path.basename(filePath)}.${randomBytes(4).toString('hex')}.tmp`,
  );

  const handle = await open(tmpPath, 'w');
  try {
    await handle.writeFile(`${JSON.stringify(data, null, 2)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }

  try {
    await rename(tmpPath, filePath);
  } catch (error) {
    await rm(tmpPath, { force: true });
    throw error;
  }
}
