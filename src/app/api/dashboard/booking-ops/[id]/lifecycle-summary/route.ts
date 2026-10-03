import { NextResponse } from 'next/server';
import { requireBookingOpsApiAccess } from '../../access';
import { requireCrmOperatorSession } from '@/lib/crm/api-auth';
import { getBookingLifecycleSummary } from '@/lib/booking-ops/lifecycle-autopilot-service';
import { requireBookingOpsRecordScope } from '@/lib/booking-ops/repository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type RouteContext = { params: { id: string } };

export async function GET(_req: Request, context: RouteContext) {
  const auth = await requireCrmOperatorSession();
  if ('error' in auth) return auth.error;
  const access = await requireBookingOpsApiAccess(auth.session, context.params.id);
  if (!access.ok) return access.response;
  const expectedScope = { accountId: access.accountId, propertyId: access.propertyId };
  try {
    const record = await requireBookingOpsRecordScope(access.bookingId, expectedScope);
    return NextResponse.json({ ok: true, lifecycle: await getBookingLifecycleSummary(record.id, expectedScope) });
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    const status = code === 'booking_scope_mismatch' ? 403 : code === 'booking_not_found' ? 404 : 500;
    return NextResponse.json({ ok: false, message: status === 403 ? 'Нет доступа к бронированию.' : 'Не удалось загрузить готовность брони.' }, { status });
  }
}
