/**
 * Helpers for validating `process.env` with zod. Each app declares its own schema
 * (see `apps/<app>/src/config.ts`); this module only provides the building blocks.
 */
import { z } from 'zod';

export class ConfigError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ConfigError';
  }
}

/** `KEY=` in a .env file yields `''`; treat that the same as unset. */
const blankToUndefined = (value: unknown): unknown => (value === '' ? undefined : value);

/** Optional value: unset or blank becomes `undefined`. */
export const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess(blankToUndefined, schema.optional());

/** Value with a default: unset or blank becomes `fallback`. */
export const withDefault = <T extends z.ZodType>(schema: T, fallback: z.input<T>) =>
  z.preprocess((value) => blankToUndefined(value) ?? fallback, schema);

/** `true/false/1/0/yes/no/on/off`. */
export const envBoolean = z.stringbool();

export const envInteger = z.coerce.number().int();

export const envNumber = z.coerce.number();

/** Comma-separated list; blank entries are dropped. */
export const envList = z.string().transform((value) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== ''),
);

/** Parse `env` against `schema`, throwing a readable `ConfigError` listing every problem. */
export function parseEnv<T extends z.ZodType>(
  schema: T,
  env: NodeJS.ProcessEnv = process.env,
): z.output<T> {
  const result = schema.safeParse(env);
  if (!result.success) {
    throw new ConfigError(`Invalid configuration:\n${z.prettifyError(result.error)}`, {
      cause: result.error,
    });
  }
  return result.data;
}
