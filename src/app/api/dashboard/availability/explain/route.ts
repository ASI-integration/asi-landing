import { NextResponse } from 'next/server';
import { requireCrmOperatorSession } from '@/lib/crm/api-auth';
import { explainAvailabilityConflict } from '@/lib/booking-ops/availability-overbooking-protection';
import {
  requireBookingOpsApiAvailabilityCheckAccess,
  requireBookingOpsApiAvailabilityScopeAccess,
} from '@/app/api/dashboard/booking-ops/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await requireCrmOperatorSession();
  if ('error' in auth) return auth.error;
  const params = new URL(req.url).searchParams;
  try {
    const checkId = params.get('check_id');
    const bookingId = params.get('booking_id');
    let accountId: string;
    let propertyId: string;
    let input: { checkId?: string; bookingId?: string };

    if (checkId) {
      const access = await requireBookingOpsApiAvailabilityCheckAccess(auth.session, checkId);
      if (!access.ok) return access.response;
      accountId = access.accountId;
      propertyId = access.propertyId;
      input = { checkId: access.checkId };
    } else {
      const access = await requireBookingOpsApiAvailabilityScopeAccess(auth.session, { bookingId });
      if (!access.ok) return access.response;
      if (!access.bookingId) {
        return NextResponse.json({ ok: false, message: 'Укажите ID проверки или брони.' }, { status: 400 });
      }
      accountId = access.accountId;
      propertyId = access.propertyId;
      input = { bookingId: access.bookingId };
    }

    const explanation = await explainAvailabilityConflict(input, accountId, { propertyId });
    if (!explanation) return NextResponse.json({ ok: false, message: 'Проверка не найдена.' }, { status: 404 });
    return NextResponse.json({ ok: true, explanation });
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : 'Не удалось объяснить проверку.' }, { status: 400 });
  }
}
