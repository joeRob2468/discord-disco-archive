import { ConfigError } from '@dsr/core';
import { PermissionFlagsBits } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { loadBrowserConfig, loadConfig } from './config.ts';

const required = {
  DISCORD_BOT_TOKEN: 'token',
  DISCORD_GUILD_ID: '111111111111111111',
  RECORDER_USER_ID: '222222222222222222',
};

describe('loadConfig', () => {
  it('fills defaults from a minimal environment', () => {
    const config = loadConfig(required);
    expect(config.discord.commandDefaultPermission).toBe(PermissionFlagsBits.ManageEvents);
    expect(config.browser).toEqual({
      profileDir: './docker-data/recorder/profile',
      channel: 'chrome',
      windowSize: { width: 1920, height: 1080 },
    });
    expect(config.processing.targets).toEqual({ integrated: -14, truePeak: -1, range: 11 });
    expect(config.processing.exportFormats).toEqual(['mp3', 'm4a']);
    expect(config.session.restartGraceMs).toBe(60_000);
  });

  it('accepts Everyone as no restriction', () => {
    expect(
      loadConfig({ ...required, COMMAND_DEFAULT_PERMISSION: 'Everyone' }).discord
        .commandDefaultPermission,
    ).toBeNull();
  });

  it('rejects an unknown permission name', () => {
    expect(() => loadConfig({ ...required, COMMAND_DEFAULT_PERMISSION: 'Nope' })).toThrow(
      ConfigError,
    );
  });

  it('rejects malformed role IDs', () => {
    expect(() => loadConfig({ ...required, ALLOWED_ROLE_IDS: '123,abc' })).toThrow(ConfigError);
  });
});

describe('loadBrowserConfig', () => {
  it('does not need Discord credentials', () => {
    expect(loadBrowserConfig({ BROWSER_CHANNEL: 'chromium' }).channel).toBe('chromium');
  });
});
