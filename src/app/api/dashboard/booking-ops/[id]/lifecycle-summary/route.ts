import { NextResponse } from 'next/server';
import { requireCrmOperatorSession } from '@/lib/crm/api-auth';
import { getBookingLifecycleSummary } from '@/lib/booking-ops/lifecycle-autopilot-service';
import { getBookingOpsRecord } from '@/lib/booking-ops/repository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type RouteContext = { params: { id: string } };

export async function GET(_req: Request, context: RouteContext) {
  const auth = await requireCrmOperatorSession();
  if ('error' in auth) return auth.error;
  const record = await getBookingOpsRecord(context.params.id);
  if (!record) return NextResponse.json({ ok: false, message: 'booking_not_found' }, { status: 404 });
  return NextResponse.json({ ok: true, lifecycle: await getBookingLifecycleSummary(record.id) });
}
