import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  // Public, non-secret runtime config that the client may need.
  const googleClientId = (process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || '').trim();

  const res = NextResponse.json({ googleClientId });
  // Avoid edge/CDN/static caching: this must reflect current server env.
  res.headers.set('Cache-Control', 'no-store, max-age=0');
  return res;
}

