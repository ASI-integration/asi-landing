import { NextResponse } from 'next/server';
import { requireCrmOperatorSession } from '@/lib/crm/api-auth';
import { getPilotAutorunStatus, type PilotAutorunScopeType } from '@/lib/booking-ops/pilot-autorun-orchestrator';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<NextResponse> {
  const auth = await requireCrmOperatorSession();
  if ('error' in auth) return auth.error;
  try {
    const url = new URL(req.url);
    const scope = url.searchParams.get('scope')?.trim() as PilotAutorunScopeType;
    const ref = url.searchParams.get('ref')?.trim() ?? '';
    if (!['lead', 'property_setup', 'booking', 'batch'].includes(scope) || !ref) {
      return NextResponse.json({ ok: false, message: 'Укажите область и ID.' }, { status: 400 });
    }
    return NextResponse.json({ ok: true, status: await getPilotAutorunStatus({ scopeType: scope, scopeRef: ref }) });
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : 'Не удалось загрузить статус.' }, { status: 400 });
  }
}
