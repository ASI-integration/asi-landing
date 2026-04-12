import { NextResponse } from 'next/server';
import { isSessionSecretConfigured } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  // Public, non-secret runtime config that the client may need.
  const googleClientId = (process.env.GOOGLE_CLIENT_ID || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '').trim();
  const hasClientSecret = Boolean((process.env.GOOGLE_CLIENT_SECRET || '').trim());
  const sessionOk = isSessionSecretConfigured();
  // Client must not see secrets; only expose a boolean.
  const googleOAuthConfigured = Boolean(googleClientId && hasClientSecret && sessionOk);
  // Non-secret hints for support/debug (no secret values exposed).
  const googleOAuthEnv = !googleClientId
    ? 'missing_client_id'
    : !hasClientSecret
      ? 'missing_client_secret'
      : !sessionOk
        ? 'missing_session_secret'
        : 'ready';

  const res = NextResponse.json({ googleClientId, googleOAuthConfigured, googleOAuthEnv });
  // Avoid edge/CDN/static caching: this must reflect current server env.
  res.headers.set('Cache-Control', 'no-store, max-age=0');
  return res;
}

