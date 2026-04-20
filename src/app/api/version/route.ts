import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const sha =
    (process.env.ASI_RELEASE_SHA || process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || '').trim() ||
    null;

  const res = NextResponse.json({
    sha,
    deployedAt: (process.env.ASI_RELEASE_DEPLOYED_AT_ISO || '').trim() || null,
    releasePath: (process.env.ASI_RELEASE_PATH || '').trim() || null,
  });
  res.headers.set('Cache-Control', 'no-store, max-age=0');
  return res;
}

