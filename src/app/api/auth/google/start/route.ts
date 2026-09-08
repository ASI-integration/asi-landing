import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getSession, isSessionSecretConfigured } from '@/lib/auth';
import { getGoogleOAuthRedirectUri, safeAuthRedirectPath } from '@/lib/auth/app-url';

export const runtime = 'nodejs';

function getRequestOrigin(req: Request): string {
  const u = new URL(req.url);
  const proto =
    (req.headers.get('x-forwarded-proto') || u.protocol.replace(':', '') || 'https').split(',')[0]?.trim() ||
    'https';
  const host = (req.headers.get('x-forwarded-host') || req.headers.get('host') || u.host || '')
    .split(',')[0]
    ?.trim();
  if (!host) return u.origin;
  return `${proto}://${host}`;
}

function googleAuthUrl(params: Record<string, string>): string {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

export async function GET(req: Request) {
  const clientId = (process.env.GOOGLE_CLIENT_ID || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '').trim();
  const clientSecret = (process.env.GOOGLE_CLIENT_SECRET || '').trim();
  const debug = new URL(req.url).searchParams.get('debug') === '1';
  const plan = new URL(req.url).searchParams.get('plan');
  const redirectPath = safeAuthRedirectPath(new URL(req.url).searchParams.get('redirect'));
  const googleRedirectUri = getGoogleOAuthRedirectUri();

  if (!clientId || !clientSecret) {
    const url = new URL('/connect', getRequestOrigin(req));
    url.searchParams.set('google_error', 'not_configured');
    if (debug) url.searchParams.set('debugGoogle', '1');
    return NextResponse.redirect(url);
  }

  if (!isSessionSecretConfigured()) {
    const url = new URL('/connect', getRequestOrigin(req));
    url.searchParams.set('google_error', 'session_not_configured');
    if (debug) url.searchParams.set('debugGoogle', '1');
    return NextResponse.redirect(url);
  }

  const origin = getRequestOrigin(req);
  const state = crypto.randomBytes(16).toString('hex');

  const session = await getSession();
  if (session.userId) {
    if (debug) console.info('[GoogleOAuth][start] session exists; redirecting', { userId: session.userId, redirectPath });
    return NextResponse.redirect(new URL(redirectPath, origin));
  }
  session.googleOauthState = state;
  session.googleOauthPlan = plan;
  session.googleOauthRedirect = redirectPath;
  await session.save();

  const url = googleAuthUrl({
    client_id: clientId,
    redirect_uri: googleRedirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    include_granted_scopes: 'true',
    access_type: 'offline',
    prompt: 'consent',
    state,
  });

  if (debug) {
    console.info('[GoogleOAuth][start]', {
      origin,
      redirectUri: googleRedirectUri,
      hasClientId: Boolean(clientId),
      hasClientSecret: Boolean(clientSecret),
    });
  }

  return NextResponse.redirect(url);
}
