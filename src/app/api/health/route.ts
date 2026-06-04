import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const res = NextResponse.json({
    ok: true,
    nodeEnv: (process.env.NODE_ENV || '').trim() || null,
    timestamp: new Date().toISOString(),
  });
  res.headers.set('Cache-Control', 'no-store, max-age=0');
  return res;
}

