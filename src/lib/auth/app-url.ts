/**
 * Trusted public app origin for OAuth redirects and related server-side URLs.
 * Prefer NEXT_PUBLIC_APP_URL (fallback NEXT_PUBLIC_URL). When unset, preserve
 * historical production hardcode so www behavior stays unchanged.
 */

export const PRODUCTION_APP_ORIGIN = 'https://www.asi-global.ru';

const PRODUCTION_SHARED_COOKIE_HOSTS: Readonly<Record<string, string>> = {
  'www.asi-global.ru': '.asi-global.ru',
  'asi-global.ru': '.asi-global.ru',
  'app.asi-global.ru': '.asi-global.ru',
  'www.guestautopilot.com': '.guestautopilot.com',
  'guestautopilot.com': '.guestautopilot.com',
  'app.guestautopilot.com': '.guestautopilot.com',
};

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
 * Auth cookies may be shared within ONE registrable domain, never between
 * asi-global.ru and guestautopilot.com. An explicit request host takes
 * precedence over the build-time NEXT_PUBLIC_APP_URL; this prevents the
 * marketing-site config from setting an invalid .asi-global.ru cookie on
 * app.guestautopilot.com. Unknown/preview hosts remain host-only.
 */
export function resolveSessionCookieDomain(
  env: Readonly<Record<string, string | undefined>> = process.env,
  nodeEnv: string | undefined = process.env.NODE_ENV,
  requestHost?: string | null,
): string | undefined {
  if (nodeEnv !== 'production') return undefined;
  if (requestHost !== undefined) {
    const hostname = (requestHost ?? '').trim().toLowerCase().replace(/:\\d+$/, '');
    return PRODUCTION_SHARED_COOKIE_HOSTS[hostname];
  }
  try {
    const host = new URL(getTrustedAppOrigin(env)).hostname.toLowerCase();
    return PRODUCTION_SHARED_COOKIE_HOSTS[host];
  } catch {
    // Invalid or missing origin must never broaden cookie scope.
    return undefined;
  }
}

/** Path-only post-login redirect; blocks open redirects. */
export function safeAuthRedirectPath(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || /[\\\x00-\x20]/.test(value)) return '/dashboard';
  return value;
}
