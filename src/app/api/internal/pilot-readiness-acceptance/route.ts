import { NextResponse } from 'next/server';
import { cleanupPilotAcceptanceData } from '@/lib/pilot-readiness/cleanup';
import { PILOT_ACCEPTANCE_PREFIX } from '@/lib/pilot-readiness/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function isAuthorized(req: Request): boolean {
  const expected = process.env.INTERNAL_TEST_SECRET;
  if (!expected) return false;
  return req.headers.get('x-internal-test-secret') === expected;
}

export async function POST(req: Request): Promise<Response> {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    // cleanup without body is allowed
  }

  const marker = String(body.marker ?? PILOT_ACCEPTANCE_PREFIX).trim() || PILOT_ACCEPTANCE_PREFIX;
  const result = await cleanupPilotAcceptanceData(marker);
  return NextResponse.json(result, { status: result.ok ? 200 : 422 });
}
