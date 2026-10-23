import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  ConfigError,
  envBoolean,
  envInteger,
  envList,
  optional,
  parseEnv,
  withDefault,
} from './env.ts';

const schema = z.object({
  TOKEN: z.string().min(1),
  ENABLED: withDefault(envBoolean, 'false'),
  PORT: withDefault(envInteger, '3000'),
  ROLES: withDefault(envList, ''),
  NOTE: optional(z.string()),
});

describe('parseEnv', () => {
  it('applies defaults for unset and blank values', () => {
    expect(parseEnv(schema, { TOKEN: 't', ENABLED: '', NOTE: '' })).toEqual({
      TOKEN: 't',
      ENABLED: false,
      PORT: 3000,
      ROLES: [],
      NOTE: undefined,
    });
  });

  it('parses booleans, integers and lists', () => {
    expect(
      parseEnv(schema, { TOKEN: 't', ENABLED: 'yes', PORT: '8080', ROLES: 'a, b,,c' }),
    ).toMatchObject({
      ENABLED: true,
      PORT: 8080,
      ROLES: ['a', 'b', 'c'],
    });
  });

  it('throws a ConfigError naming the bad key', () => {
    expect(() => parseEnv(schema, { PORT: 'abc' })).toThrow(ConfigError);
    expect(() => parseEnv(schema, { PORT: 'abc' })).toThrow(/TOKEN/);
  });
});
