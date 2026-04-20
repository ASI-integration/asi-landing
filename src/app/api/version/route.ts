import { NextResponse } from 'next/server';
import { getServerReleaseSha } from '@/lib/serverReleaseSha';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const sha = getServerReleaseSha();

  const res = NextResponse.json({
    sha,
    deployedAt: (process.env.ASI_RELEASE_DEPLOYED_AT_ISO || '').trim() || null,
    releasePath: (process.env.ASI_RELEASE_PATH || '').trim() || null,
  });
  res.headers.set('Cache-Control', 'no-store, max-age=0');
  return res;
}

