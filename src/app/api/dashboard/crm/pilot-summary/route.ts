import { NextResponse } from 'next/server';
import { requireCrmOperatorSession } from '@/lib/crm/api-auth';
import { listCrmContacts } from '@/lib/crm/repository';
import { computePilotRolloutMetrics, PILOT_LIMIT_FULL_MESSAGE } from '@/lib/crm/pilot-rollout';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const auth = await requireCrmOperatorSession();
  if ('error' in auth) return auth.error;

  try {
    const contacts = await listCrmContacts();
    const metrics = computePilotRolloutMetrics(contacts);
    return NextResponse.json({
      ok: true,
      metrics,
      limitMessage: metrics.limitReached ? PILOT_LIMIT_FULL_MESSAGE : null,
    });
  } catch {
    return NextResponse.json({ ok: false, message: 'Не удалось загрузить сводку пилота.' }, { status: 500 });
  }
}
