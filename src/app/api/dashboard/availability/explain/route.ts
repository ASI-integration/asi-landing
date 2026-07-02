import { NextResponse } from 'next/server';
import { requireCrmOperatorSession } from '@/lib/crm/api-auth';
import { explainAvailabilityConflict } from '@/lib/booking-ops/availability-overbooking-protection';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await requireCrmOperatorSession();
  if ('error' in auth) return auth.error;
  const params = new URL(req.url).searchParams;
  try {
    const explanation = await explainAvailabilityConflict({
      checkId: params.get('check_id') ?? undefined,
      bookingId: params.get('booking_id') ?? undefined,
    });
    if (!explanation) return NextResponse.json({ ok: false, message: 'Проверка не найдена.' }, { status: 404 });
    return NextResponse.json({ ok: true, explanation });
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : 'Не удалось объяснить проверку.' }, { status: 400 });
  }
}
