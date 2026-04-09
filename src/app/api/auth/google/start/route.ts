import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getSession } from '@/lib/auth';

export const runtime = 'nodejs';

function getRequestOrigin(req: Request): string {
  const u = new URL(req.url);
  const proto = req.headers.get('x-forwarded-proto') || u.protocol.replace(':', '');
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || u.host;
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

  if (!clientId || !clientSecret) {
    const url = new URL('/connect', getRequestOrigin(req));
    url.searchParams.set('google_error', 'not_configured');
    if (debug) url.searchParams.set('debugGoogle', '1');
    return NextResponse.redirect(url);
  }

  const origin = getRequestOrigin(req);
  const redirectUri = `${origin}/api/auth/google/callback`;
  const state = crypto.randomBytes(16).toString('hex');

  const session = await getSession();
  session.googleOauthState = state;
  session.googleOauthPlan = plan;
  await session.save();

  const url = googleAuthUrl({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    include_granted_scopes: 'true',
    access_type: 'offline',
    prompt: 'consent',
    state,
  });

  if (debug) {
    console.info('[GoogleOAuth][start]', { origin, redirectUri, hasClientId: Boolean(clientId), hasClientSecret: Boolean(clientSecret) });
  }

  return NextResponse.redirect(url);
}

