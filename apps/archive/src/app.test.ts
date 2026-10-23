import { describe, expect, it } from 'vitest';
import { createApp } from './app.ts';
import { loadConfig } from './config.ts';

describe('archive app', () => {
  it('answers health checks', async () => {
    const app = createApp({ config: loadConfig({}) });
    const response = await app.request('/healthz');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });
});
