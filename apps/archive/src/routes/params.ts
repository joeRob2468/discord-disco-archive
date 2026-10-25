/** Lenient parsing of query and form input: bad values are dropped, not errors. */
import { snowflakeSchema } from '@dsr/core';
import type { Sort, SortDir } from '../catalog/catalog.ts';

export function pageParam(value: string | undefined): number {
  const page = Number(value);
  return Number.isInteger(page) && page >= 1 && page <= 10_000 ? page : 1;
}

export const snowflakeParam = (value: string | undefined): string | undefined =>
  value && snowflakeSchema.safeParse(value).success ? value : undefined;

export const textParam = (value: string | undefined, max = 200): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
};

type FormBody = Record<string, string | File | (string | File)[]>;

/** A form field as a string, or `undefined` if absent (meaning "leave unchanged"). */
export function formField(body: FormBody, name: string): string | undefined {
  const value = body[name];
  return typeof value === 'string' ? value : undefined;
}

export const splitList = (value: string, separator: RegExp): string[] =>
  value
    .split(separator)
    .map((item) => item.trim())
    .filter((item) => item !== '');

/**
 * `?sort=<key>&dir=asc|desc` against a fixed set of keys. An unknown key falls back to
 * `fallback`; a missing direction to the key's natural one (`defaultDir`).
 */
export function sortParam<K extends string>(
  sorts: Readonly<Record<K, unknown>>,
  sort: string | undefined,
  dir: string | undefined,
  fallback: K,
  defaultDir: (key: K) => SortDir,
): Sort<K> {
  const by = sort !== undefined && Object.hasOwn(sorts, sort) ? (sort as K) : fallback;
  return { by, dir: dir === 'asc' || dir === 'desc' ? dir : defaultDir(by) };
}
