import { ConfigError } from '@dsr/core';
import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.ts';

describe('loadConfig', () => {
  it('defaults to a public archive with editing disabled', () => {
    expect(loadConfig({}).auth).toEqual({
      viewerPassword: undefined,
      adminPassword: undefined,
      sessionSecret: undefined,
      secureCookies: false,
    });
  });

  it('requires a session secret once any password is set', () => {
    expect(() => loadConfig({ ARCHIVE_ADMIN_PASSWORD: 'long-enough-pass' })).toThrow(ConfigError);
  });

  it('rejects identical viewer and admin passwords', () => {
    expect(() =>
      loadConfig({
        ARCHIVE_PASSWORD: 'same-password-1',
        ARCHIVE_ADMIN_PASSWORD: 'same-password-1',
        ARCHIVE_SESSION_SECRET: 'x'.repeat(32),
      }),
    ).toThrow(/differ/);
  });

  it('uses secure cookies behind https', () => {
    expect(
      loadConfig({ ARCHIVE_PUBLIC_URL: 'https://archive.example.com' }).auth.secureCookies,
    ).toBe(true);
  });
});
