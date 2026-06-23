import { NextResponse } from 'next/server';
import { syncAutoOpsTasks } from '@/lib/ops-v1/auto-tasks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isAuthorized(req: Request): boolean {
  const expected = process.env.INTERNAL_TEST_SECRET;
  if (!expected) return false;
  return req.headers.get('x-internal-test-secret') === expected;
}

export async function POST(req: Request): Promise<Response> {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
  }

  const sync = await syncAutoOpsTasks();
  return NextResponse.json({ ok: true, sync });
}
