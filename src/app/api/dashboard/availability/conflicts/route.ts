import { NextResponse } from 'next/server';
import { requireCrmOperatorSession } from '@/lib/crm/api-auth';
import { getAvailabilityStatus } from '@/lib/booking-ops/availability-overbooking-protection';
import { requireBookingOpsApiAvailabilityScopeAccess } from '@/app/api/dashboard/booking-ops/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await requireCrmOperatorSession();
  if ('error' in auth) return auth.error;
  const params = new URL(req.url).searchParams;
  try {
    const access = await requireBookingOpsApiAvailabilityScopeAccess(auth.session, {
      bookingId: params.get('booking_id'),
      propertySetupId: params.get('property_setup_id'),
      propertyId: params.get('property_id'),
    });
    if (!access.ok) return access.response;
    const status = await getAvailabilityStatus({
      bookingId: access.bookingId,
      propertySetupId: access.propertySetupId,
      propertyId: access.propertyId,
    }, {}, { accountId: access.accountId });
    return NextResponse.json({ ok: true, conflicts: status.conflicts });
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : 'Не удалось загрузить конфликты.' }, { status: 400 });
  }
}
