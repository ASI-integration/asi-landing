import { NextResponse } from 'next/server';
import { OAuth2Client } from 'google-auth-library';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { supabase } from '@/lib/supabase';
import { getSession } from '@/lib/auth';
import { ensureAccountForUser } from '@/lib/accounts';
import { resolveRedirectOrigin } from '@/lib/app-url';

export const runtime = 'nodejs';

// Must match Google Cloud Console OAuth redirect URI exactly.
const GOOGLE_REDIRECT_URI = 'https://www.asi-global.ru/api/auth/google/callback';

function getRequestOrigin(req: Request): string {
  let fallbackOrigin: string | undefined;
  try {
    fallbackOrigin = new URL(req.url).origin;
  } catch {
    fallbackOrigin = undefined;
  }
  return resolveRedirectOrigin({
    forwardedHost: req.headers.get('x-forwarded-host'),
    host: req.headers.get('host'),
    forwardedProto: req.headers.get('x-forwarded-proto'),
    fallbackOrigin,
  });
}

async function exchangeCodeForTokens(opts: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<{ id_token?: string }> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: opts.code,
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      redirect_uri: opts.redirectUri,
      grant_type: 'authorization_code',
    }).toString(),
  });

  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) {
    const msg =
      typeof data?.error_description === 'string'
        ? data.error_description
        : typeof data?.error === 'string'
          ? data.error
          : 'token_exchange_failed';
    throw new Error(msg);
  }
  return data as { id_token?: string };
}

function randomPassword(): string {
  return crypto.randomBytes(24).toString('base64').replace(/[+/=]/g, '').slice(0, 24);
}

function safeRedirectPath(value: string | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/dashboard';
  return value;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code') || '';
  const state = url.searchParams.get('state') || '';
  const debug = url.searchParams.get('debug') === '1';

  const origin = getRequestOrigin(req);
  const fail = (reason: string) => {
    const u = new URL('/connect', origin);
    u.searchParams.set('google_error', reason);
    if (debug) u.searchParams.set('debugGoogle', '1');
    return NextResponse.redirect(u);
  };

  console.info('[GoogleOAuth][callback] request', {
    path: url.pathname,
    hasCode: Boolean(code),
    hasState: Boolean(state),
    origin,
    xfProto: req.headers.get('x-forwarded-proto'),
    xfHost: req.headers.get('x-forwarded-host'),
    host: req.headers.get('host'),
    referer: req.headers.get('referer'),
    userAgent: req.headers.get('user-agent'),
    hasCookieHeader: Boolean(req.headers.get('cookie')),
  });

  if (!code || !state) return fail('missing_params');

  const clientId = (process.env.GOOGLE_CLIENT_ID || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '').trim();
  const clientSecret = (process.env.GOOGLE_CLIENT_SECRET || '').trim();
  if (!clientId || !clientSecret) return fail('not_configured');

  const session = await getSession();
  console.info('[GoogleOAuth][callback] session pre-check', {
    hasUserId: Boolean(session.userId),
    hasExpectedState: Boolean(session.googleOauthState),
  });

  const expectedState = session.googleOauthState;
  const plan = session.googleOauthPlan;
  const redirectPath = safeRedirectPath(session.googleOauthRedirect);
  session.googleOauthState = undefined;
  session.googleOauthPlan = undefined;
  session.googleOauthRedirect = undefined;
  await session.save();

  if (!expectedState || expectedState !== state) return fail('bad_state');

  try {
    const tokenResp = await exchangeCodeForTokens({
      code,
      clientId,
      clientSecret,
      redirectUri: GOOGLE_REDIRECT_URI,
    });
    const idToken = (tokenResp.id_token || '').trim();
    if (!idToken) return fail('no_id_token');

    const client = new OAuth2Client(clientId);
    const ticket = await client.verifyIdToken({ idToken, audience: clientId });
    const payload = ticket.getPayload();
    const aud = payload?.aud;
    if (aud && aud !== clientId) return fail('aud_mismatch');

    const email = payload?.email?.toLowerCase();
    if (!email) return fail('email_missing');

    const { data: existing, error: lookupErr } = await supabase
      .from('users')
      .select('id, email')
      .eq('email', email)
      .maybeSingle();
    if (lookupErr) throw lookupErr;

    let userId = existing?.id as string | undefined;
    if (!userId) {
      const passwordHash = await bcrypt.hash(randomPassword(), 10);
      const { data: created, error: createErr } = await supabase
        .from('users')
        .insert({ email, password_hash: passwordHash })
        .select('id, email')
        .single();
      if (createErr) throw createErr;
      userId = created.id;

      const now = new Date();
      const trialEnd = new Date(now);
      trialEnd.setDate(trialEnd.getDate() + 7);
      await supabase.from('subscriptions').upsert(
        {
          user_id: userId,
          status: 'trial',
          trial_start: now.toISOString(),
          trial_end: trialEnd.toISOString(),
        },
        { onConflict: 'user_id' }
      );
    }

    session.userId = userId!;
    session.email = email;
    await session.save();

    console.info('[GoogleOAuth][callback] session created', {
      userId,
      email,
      hasCookieHeaderAfterSave: Boolean(req.headers.get('cookie')),
    });

    await ensureAccountForUser({
      userId: userId!,
      email,
      selectedPlan: plan,
      trialDays: 7,
    });

    console.info('[GoogleOAuth][callback] redirecting to dashboard', {
      userId,
      hasCookieHeader: Boolean(req.headers.get('cookie')),
      redirectPath,
    });
    return NextResponse.redirect(new URL(redirectPath, origin));
  } catch (err) {
    console.error('[GoogleOAuth][callback]', err);
    if (debug) {
      const u = new URL('/connect', origin);
      u.searchParams.set('google_error', 'callback_failed');
      u.searchParams.set('debugGoogle', '1');
      u.searchParams.set('details', err instanceof Error ? err.message : String(err ?? 'unknown_error'));
      return NextResponse.redirect(u);
    }
    return fail('callback_failed');
  }
}
