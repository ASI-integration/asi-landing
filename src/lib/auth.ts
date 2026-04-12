import { getIronSession } from 'iron-session';
import { cookies } from 'next/headers';

export type SessionData = {
  userId: string;
  email: string;
  // OAuth transient state (must not be relied on long-term)
  googleOauthState?: string;
  googleOauthPlan?: unknown;
};

const IS_PROD = process.env.NODE_ENV === 'production';

const cookieOptions = {
  // OAuth redirects from accounts.google.com require a cross-site cookie in modern browsers.
  // In production we must use SameSite=None and Secure=true, and set domain to cover subdomains.
  secure: IS_PROD,
  httpOnly: true,
  maxAge: 60 * 60 * 24 * 7, // 7 days
  sameSite: (IS_PROD ? 'none' : 'lax') as 'none' | 'lax',
  path: '/',
  ...(IS_PROD ? { domain: '.asi-global.ru' } : {}),
};

/** Trimmed `SESSION_SECRET` for iron-session (must be ≥32 characters or getIronSession throws). */
export function getSessionSecret(): string {
  return (process.env.SESSION_SECRET || '').trim();
}

export function isSessionSecretConfigured(): boolean {
  return getSessionSecret().length >= 32;
}

export async function getSession() {
  const cookieStore = await cookies();
  return getIronSession<SessionData>(cookieStore, {
    password: getSessionSecret(),
    cookieName: 'asi_session',
    cookieOptions,
  });
}
