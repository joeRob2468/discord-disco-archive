/**
 * Shared-password access control.
 *
 * - Viewer: if `ARCHIVE_PASSWORD` is set, browsing needs it; otherwise the archive is public.
 * - Admin: `ARCHIVE_ADMIN_PASSWORD` unlocks hiding and editing. If unset, editing is off.
 *
 * Login sets a signed, HttpOnly cookie holding the role and an expiry. A later Discord
 * login (docs/plan.md, "Archive site") would set the same cookie, so nothing else changes.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Context, MiddlewareHandler } from 'hono';
import { deleteCookie, getSignedCookie, setSignedCookie } from 'hono/cookie';
import type { AuthConfig } from '../config.ts';

export type Role = 'viewer' | 'admin';

export interface AuthState {
  role: Role | undefined;
  canView: boolean;
  isAdmin: boolean;
  /** Admin login is possible (an admin password is configured). */
  adminEnabled: boolean;
  /** Viewing requires a password. */
  viewerPasswordRequired: boolean;
}

export interface AuthEnv {
  Variables: { auth: AuthState };
}

const COOKIE = 'dsr_session';
const MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const FAILED_LOGIN_DELAY_MS = 750;

const digest = (value: string): Buffer => createHash('sha256').update(value).digest();

/** Constant-time comparison that doesn't leak the expected length. */
function passwordMatches(candidate: string, expected: string | undefined): boolean {
  return expected !== undefined && timingSafeEqual(digest(candidate), digest(expected));
}

interface CookiePayload {
  role: Role;
  exp: number;
}

function parsePayload(raw: string | false | undefined): CookiePayload | undefined {
  if (!raw) return undefined;
  try {
    const payload = JSON.parse(raw) as Partial<CookiePayload>;
    if (
      (payload.role === 'viewer' || payload.role === 'admin') &&
      typeof payload.exp === 'number'
    ) {
      return payload.exp > Date.now() ? { role: payload.role, exp: payload.exp } : undefined;
    }
  } catch {
    // Tampered or legacy cookie: treat as logged out.
  }
  return undefined;
}

export function createAuth(config: AuthConfig) {
  const secret = config.sessionSecret;
  const adminEnabled = config.adminPassword !== undefined;
  const viewerPasswordRequired = config.viewerPassword !== undefined;

  /** Resolves the caller's role into `c.var.auth`. */
  const middleware: MiddlewareHandler<AuthEnv> = async (c, next) => {
    let role: Role | undefined;
    if (secret !== undefined) {
      const payload = parsePayload(await getSignedCookie(c, secret, COOKIE));
      // An admin cookie from before the admin password was removed is ignored.
      role = payload?.role === 'admin' && !adminEnabled ? undefined : payload?.role;
    }
    c.set('auth', {
      role,
      canView: !viewerPasswordRequired || role !== undefined,
      isAdmin: role === 'admin',
      adminEnabled,
      viewerPasswordRequired,
    });
    await next();
  };

  /** Which role, if any, a submitted password unlocks. Slow on failure. */
  const checkPassword = async (password: string): Promise<Role | undefined> => {
    if (passwordMatches(password, config.adminPassword)) return 'admin';
    if (passwordMatches(password, config.viewerPassword)) return 'viewer';
    await new Promise((resolve) => setTimeout(resolve, FAILED_LOGIN_DELAY_MS));
    return undefined;
  };

  const login = async (c: Context, role: Role): Promise<void> => {
    if (secret === undefined) throw new Error('Login requires ARCHIVE_SESSION_SECRET');
    const payload: CookiePayload = { role, exp: Date.now() + MAX_AGE_SECONDS * 1000 };
    await setSignedCookie(c, COOKIE, JSON.stringify(payload), secret, {
      httpOnly: true,
      secure: config.secureCookies,
      sameSite: 'Lax',
      path: '/',
      maxAge: MAX_AGE_SECONDS,
    });
  };

  const logout = (c: Context): void => {
    deleteCookie(c, COOKIE, { path: '/', secure: config.secureCookies });
  };

  return { middleware, checkPassword, login, logout, adminEnabled, viewerPasswordRequired };
}

export type Auth = ReturnType<typeof createAuth>;

/** Only allow same-site relative redirects after login. */
export function safeNext(next: string | undefined): string {
  return next?.startsWith('/') && !next.startsWith('//') ? next : '/';
}
