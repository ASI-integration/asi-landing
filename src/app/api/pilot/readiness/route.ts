import { NextResponse } from 'next/server';
import { requirePilotBetaSession } from '@/lib/pilot/api-auth';
import { getPilotReadiness } from '@/lib/pilot/readiness';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * SP-08: safe normalized pilot readiness (no owner diagnostics).
 */
export async function GET() {
  const auth = await requirePilotBetaSession();
  if ('error' in auth) return auth.error;

  const readiness = await getPilotReadiness();
  return NextResponse.json(
    {
      ok: true,
      readiness: {
        state: readiness.state,
        canSubmit: readiness.canSubmit,
        messageRu: readiness.messageRu,
        checkedAt: readiness.checkedAt,
      },
    },
    { status: 200, headers: { 'cache-control': 'no-store' } },
  );
}
