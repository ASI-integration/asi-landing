import { NextResponse } from 'next/server';
import { requireCrmOperatorSession } from '@/lib/crm/api-auth';
import { requireBookingOpsApiAccess, requireBookingOpsApiAccount } from '../../booking-ops/access';
import { explainPilotAutorun, type PilotAutorunScopeType } from '@/lib/booking-ops/pilot-autorun-orchestrator';

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
    let authorizedRef = ref;
    if (scope === 'booking') {
      const access = await requireBookingOpsApiAccess(auth.session, ref);
      if (!access.ok) return access.response;
      authorizedRef = access.bookingId;
    } else if (scope === 'batch') {
      const access = await requireBookingOpsApiAccount(auth.session);
      if (!access.ok) return access.response;
      if (!ref.startsWith(`batch:${access.accountId}:`)) {
        return NextResponse.json({ ok: false, message: 'Нет доступа к пакетному запуску.' }, { status: 403 });
      }
    }
    return NextResponse.json({ ok: true, ...(await explainPilotAutorun({ scopeType: scope, scopeRef: authorizedRef })) });
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : 'Не удалось подготовить объяснение.' }, { status: 400 });
  }
}
