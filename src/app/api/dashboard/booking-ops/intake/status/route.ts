import { NextResponse } from 'next/server';
import { requireCrmOperatorSession } from '@/lib/crm/api-auth';
import { getInboundBookingIntakeStatus } from '@/lib/booking-ops/real-booking-intake-autopilot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<NextResponse> {
  const auth = await requireCrmOperatorSession();
  if ('error' in auth) return auth.error;

  const url = new URL(req.url);
  const bookingId = url.searchParams.get('bookingId')?.trim()
    ?? url.searchParams.get('booking_id')?.trim()
    ?? '';
  const intakeId = url.searchParams.get('intakeId')?.trim()
    ?? url.searchParams.get('intake_id')?.trim()
    ?? '';

  if (!bookingId && !intakeId) {
    return NextResponse.json(
      { ok: false, message: 'Укажите bookingId или intakeId.' },
      { status: 400 },
    );
  }

  const result = await getInboundBookingIntakeStatus({
    bookingId: bookingId || undefined,
    intakeId: intakeId || undefined,
  });

  if (!result) {
    return NextResponse.json({ ok: false, message: 'Заявка не найдена.' }, { status: 404 });
  }

  return NextResponse.json({ ok: true, result });
}
