import { NextResponse } from 'next/server';
import { requirePilotBetaSession } from '@/lib/pilot/api-auth';
import { PILOT_BETA_ROLE } from '@/lib/pilot/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Minimal pilot surface for SP-02: proves invite + role for the session.
 * Does not create tasks (later packages).
 */
export async function GET() {
  const auth = await requirePilotBetaSession();
  if ('error' in auth) return auth.error;

  return NextResponse.json(
    {
      ok: true,
      role: PILOT_BETA_ROLE,
      userId: auth.session.userId,
      // email intentionally omitted from response body to reduce PII leakage
    },
    { status: 200, headers: { 'cache-control': 'no-store' } },
  );
}
