import { NextResponse } from 'next/server';
import { requireCrmOperatorSession } from '@/lib/crm/api-auth';
import { buildLegalSummaryForBookingOps, getGuestLegalReadiness } from '@/lib/booking-ops/guest-legal-deposit-mvd-execution';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<NextResponse> {
  const auth = await requireCrmOperatorSession();
  if ('error' in auth) return auth.error;
  const bookingId = new URL(req.url).searchParams.get('bookingId') ?? '';
  try {
    const existing = await getGuestLegalReadiness(bookingId);
    const status = existing ? await buildLegalSummaryForBookingOps(bookingId) : { readiness: null, nextAction: 'Инициализировать юридический контур.', lastEvent: null };
    return NextResponse.json({ ok: true, status });
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : 'Не удалось получить статус.' }, { status: 400 });
  }
}
