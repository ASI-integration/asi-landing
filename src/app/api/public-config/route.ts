import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  // Public, non-secret runtime config that the client may need.
  const googleClientId = (process.env.GOOGLE_CLIENT_ID || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '').trim();
  // Client must not see secrets; only expose a boolean.
  const googleOAuthConfigured = Boolean(googleClientId && (process.env.GOOGLE_CLIENT_SECRET || '').trim());

  const res = NextResponse.json({ googleClientId, googleOAuthConfigured });
  // Avoid edge/CDN/static caching: this must reflect current server env.
  res.headers.set('Cache-Control', 'no-store, max-age=0');
  return res;
}

