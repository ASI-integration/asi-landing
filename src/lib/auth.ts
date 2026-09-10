import { getIronSession } from 'iron-session';
import { cookies } from 'next/headers';
import { resolveSessionCookieDomain } from '@/lib/auth/app-url';

export type SessionData = {
  userId: string;
  email: string;
  // OAuth transient state (must not be relied on long-term)
  googleOauthState?: string;
  googleOauthPlan?: unknown;
  googleOauthRedirect?: string;
};

export function getSessionCookieOptions(
  env: Readonly<Record<string, string | undefined>> = process.env,
  nodeEnv: string | undefined = process.env.NODE_ENV,
) {
  const isProd = nodeEnv === 'production';
  const domain = resolveSessionCookieDomain(env, nodeEnv);
  return {
    // OAuth redirects from accounts.google.com require a cross-site cookie in modern browsers.
    // Production www/apex keeps Domain=.asi-global.ru; staging stays host-only.
    secure: isProd,
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 7, // 7 days
    sameSite: (isProd ? 'none' : 'lax') as 'none' | 'lax',
    path: '/',
    ...(domain ? { domain } : {}),
  };
}

/** Trimmed `SESSION_SECRET` for iron-session (must be ≥32 characters or getIronSession throws). */
export function getSessionSecret(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  return (env.SESSION_SECRET || '').trim();
}

export function isSessionSecretConfigured(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return getSessionSecret(env).length >= 32;
}

export async function getSession() {
  const cookieStore = await cookies();
  return getIronSession<SessionData>(cookieStore, {
    password: getSessionSecret(),
    cookieName: 'asi_session',
    cookieOptions: getSessionCookieOptions(),
  });
}
