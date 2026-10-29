import { describe, expect, it } from 'vitest';
import { clientKey, LOGIN_ATTEMPTS, LOGIN_WINDOW_MS, LoginLimiter } from './login-limiter.ts';

describe('LoginLimiter', () => {
  const setup = () => {
    let time = 1_000_000;
    const limiter = new LoginLimiter({ now: () => time });
    return { limiter, advance: (ms: number) => (time += ms) };
  };

  it('blocks a client after too many attempts, until the oldest expires', () => {
    const { limiter, advance } = setup();
    for (let i = 0; i < LOGIN_ATTEMPTS; i++) {
      expect(limiter.take('1.2.3.4')).toBe(0);
      advance(1000);
    }
    expect(limiter.take('1.2.3.4')).toBe(LOGIN_WINDOW_MS / 1000 - LOGIN_ATTEMPTS);
    // Other clients are unaffected.
    expect(limiter.take('5.6.7.8')).toBe(0);
    advance(LOGIN_WINDOW_MS - LOGIN_ATTEMPTS * 1000 + 1);
    expect(limiter.take('1.2.3.4')).toBe(0);
  });

  it('does not count blocked attempts', () => {
    const { limiter, advance } = setup();
    for (let i = 0; i < LOGIN_ATTEMPTS; i++) limiter.take('a');
    for (let i = 0; i < 50; i++) expect(limiter.take('a')).toBeGreaterThan(0);
    advance(LOGIN_WINDOW_MS + 1);
    expect(limiter.take('a')).toBe(0);
  });

  it('clears a client on success', () => {
    const { limiter } = setup();
    for (let i = 0; i < LOGIN_ATTEMPTS; i++) limiter.take('a');
    limiter.succeeded('a');
    expect(limiter.take('a')).toBe(0);
  });
});

describe('clientKey', () => {
  it('keys IPv4 by address and IPv6 by /64', () => {
    expect(clientKey('203.0.113.7')).toBe('203.0.113.7');
    expect(clientKey('::ffff:203.0.113.7')).toBe('::ffff:203.0.113.7');
    expect(clientKey('2001:db8:1:2:aaaa::1')).toBe('2001:db8:1:2::/64');
    expect(clientKey('2001:0DB8:0001:0002:ffff:ffff:ffff:ffff')).toBe('2001:db8:1:2::/64');
    expect(clientKey('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(clientKey(undefined)).toBe('direct');
  });
});
