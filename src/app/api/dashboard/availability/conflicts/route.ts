import { NextResponse } from 'next/server';
import { requireCrmOperatorSession } from '@/lib/crm/api-auth';
import { getAvailabilityStatus } from '@/lib/booking-ops/availability-overbooking-protection';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await requireCrmOperatorSession();
  if ('error' in auth) return auth.error;
  const params = new URL(req.url).searchParams;
  try {
    const status = await getAvailabilityStatus({
      bookingId: params.get('booking_id'), propertySetupId: params.get('property_setup_id'), propertyId: params.get('property_id'),
    });
    return NextResponse.json({ ok: true, conflicts: status.conflicts });
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : 'Не удалось загрузить конфликты.' }, { status: 400 });
  }
}
