import { NextResponse } from 'next/server';
import { isSessionSecretConfigured } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  // Public, non-secret runtime config that the client may need.
  const googleClientId = (process.env.GOOGLE_CLIENT_ID || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '').trim();
  const hasClientSecret = Boolean((process.env.GOOGLE_CLIENT_SECRET || '').trim());
  const sessionOk = isSessionSecretConfigured();
  // We support two Google sign-in modes:
  // - redirect: full OAuth redirect (requires client secret + session secret)
  // - gis: client-side GIS id_token (requires only client id + session secret)
  const googleOAuthMode: 'redirect' | 'gis' | 'disabled' =
    !googleClientId ? 'disabled'
      : !sessionOk ? 'disabled'
        : hasClientSecret ? 'redirect'
          : 'gis';

  // Back-compat boolean: "Google sign-in is available in some working mode".
  const googleOAuthConfigured = googleOAuthMode !== 'disabled';

  // Non-secret hints for support/debug (no secret values exposed).
  const googleOAuthEnv = !googleClientId
    ? 'missing_client_id'
    : !sessionOk
      ? 'missing_session_secret'
      : hasClientSecret
        ? 'ready_redirect'
        : 'ready_gis';

  const res = NextResponse.json({ googleClientId, googleOAuthConfigured, googleOAuthEnv, googleOAuthMode });
  // Avoid edge/CDN/static caching: this must reflect current server env.
  res.headers.set('Cache-Control', 'no-store, max-age=0');
  return res;
}

