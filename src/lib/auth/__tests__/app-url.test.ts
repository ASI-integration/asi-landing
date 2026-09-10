import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PRODUCTION_APP_ORIGIN,
  getGoogleOAuthRedirectUri,
  getTrustedAppOrigin,
  resolveSessionCookieDomain,
  safeAuthRedirectPath,
} from '../app-url';
import {
  getSessionCookieOptions,
  getSessionSecret,
  isSessionSecretConfigured,
} from '@/lib/auth';

beforeEach(() => {
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('trusted app origin / Google OAuth redirect_uri', () => {
  it('production www APP_URL keeps historical www callback', () => {
    const env = { NEXT_PUBLIC_APP_URL: 'https://www.asi-global.ru' };
    expect(getTrustedAppOrigin(env)).toBe('https://www.asi-global.ru');
    expect(getGoogleOAuthRedirectUri(env)).toBe(
      'https://www.asi-global.ru/api/auth/google/callback',
    );
  });

  it('staging APP_URL yields staging callback', () => {
    const env = { NEXT_PUBLIC_APP_URL: 'https://staging.asi-global.ru' };
    expect(getGoogleOAuthRedirectUri(env)).toBe(
      'https://staging.asi-global.ru/api/auth/google/callback',
    );
  });

  it('falls back to historical www origin when APP_URL is unset', () => {
    expect(getTrustedAppOrigin({})).toBe(PRODUCTION_APP_ORIGIN);
    expect(getGoogleOAuthRedirectUri({})).toBe(
      `${PRODUCTION_APP_ORIGIN}/api/auth/google/callback`,
    );
  });

  it('prefers NEXT_PUBLIC_APP_URL over NEXT_PUBLIC_URL', () => {
    const env = {
      NEXT_PUBLIC_APP_URL: 'https://staging.asi-global.ru',
      NEXT_PUBLIC_URL: 'https://www.asi-global.ru',
    };
    expect(getTrustedAppOrigin(env)).toBe('https://staging.asi-global.ru');
  });
});

describe('session cookie domain isolation', () => {
  it('production www keeps Domain=.asi-global.ru', () => {
    const env = { NEXT_PUBLIC_APP_URL: 'https://www.asi-global.ru' };
    expect(resolveSessionCookieDomain(env, 'production')).toBe('.asi-global.ru');
    expect(getSessionCookieOptions(env, 'production').domain).toBe('.asi-global.ru');
  });

  it('staging production NODE_ENV uses host-only cookie (no Domain)', () => {
    const env = { NEXT_PUBLIC_APP_URL: 'https://staging.asi-global.ru' };
    expect(resolveSessionCookieDomain(env, 'production')).toBeUndefined();
    expect(getSessionCookieOptions(env, 'production')).not.toHaveProperty('domain');
  });

  it('non-production never sets parent Domain', () => {
    const env = { NEXT_PUBLIC_APP_URL: 'https://www.asi-global.ru' };
    expect(resolveSessionCookieDomain(env, 'development')).toBeUndefined();
  });
});

describe('staging SESSION_SECRET isolation', () => {
  it('uses only the process SESSION_SECRET (no production secret coupling)', () => {
    const stagingOnly = {
      SESSION_SECRET: 'staging-session-secret-value-at-least-32-chars',
      NEXT_PUBLIC_APP_URL: 'https://staging.asi-global.ru',
    };
    expect(isSessionSecretConfigured(stagingOnly)).toBe(true);
    expect(getSessionSecret(stagingOnly)).toBe(stagingOnly.SESSION_SECRET);
    expect(getSessionSecret(stagingOnly)).not.toContain('production');
    expect(getSessionSecret({ SESSION_SECRET: '' })).toBe('');
    expect(isSessionSecretConfigured({ SESSION_SECRET: 'short' })).toBe(false);
  });
});

describe('safeAuthRedirectPath', () => {
  it('preserves /pilot and rejects open redirects', () => {
    expect(safeAuthRedirectPath('/pilot')).toBe('/pilot');
    expect(safeAuthRedirectPath('/pilot?taskId=1')).toBe('/pilot?taskId=1');
    expect(safeAuthRedirectPath('https://evil.example/')).toBe('/dashboard');
    expect(safeAuthRedirectPath('//evil.example')).toBe('/dashboard');
    expect(safeAuthRedirectPath(null)).toBe('/dashboard');
  });
});
