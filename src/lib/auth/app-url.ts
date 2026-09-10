/**
 * Trusted public app origin for OAuth redirects and related server-side URLs.
 * Prefer NEXT_PUBLIC_APP_URL (fallback NEXT_PUBLIC_URL). When unset, preserve
 * historical production hardcode so www behavior stays unchanged.
 */

export const PRODUCTION_APP_ORIGIN = 'https://www.asi-global.ru';

const PRODUCTION_SHARED_COOKIE_HOSTS = new Set(['www.asi-global.ru', 'asi-global.ru']);

export function getTrustedAppOrigin(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const raw = (env.NEXT_PUBLIC_APP_URL || env.NEXT_PUBLIC_URL || '').trim().replace(/\/$/, '');
  if (raw) {
    try {
      const parsed = new URL(raw);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return `${parsed.protocol}//${parsed.host}`;
      }
    } catch {
      // fall through to production default
    }
  }
  return PRODUCTION_APP_ORIGIN;
}

/** Google OAuth redirect_uri; must match a URI registered in Google Cloud Console. */
export function getGoogleOAuthRedirectUri(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  return `${getTrustedAppOrigin(env)}/api/auth/google/callback`;
}

/**
 * Parent-domain cookie only for production www/apex (historical behavior).
 * Staging and other hosts stay host-only so sessions do not leak across hosts.
 */
export function resolveSessionCookieDomain(
  env: Readonly<Record<string, string | undefined>> = process.env,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): string | undefined {
  if (nodeEnv !== 'production') return undefined;
  try {
    const host = new URL(getTrustedAppOrigin(env)).hostname;
    if (PRODUCTION_SHARED_COOKIE_HOSTS.has(host)) return '.asi-global.ru';
  } catch {
    return '.asi-global.ru';
  }
  return undefined;
}

/** Path-only post-login redirect; blocks open redirects. */
export function safeAuthRedirectPath(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/dashboard';
  return value;
}
