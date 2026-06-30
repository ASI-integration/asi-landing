import { NextResponse } from 'next/server';
import { requireCrmOperatorSession } from '@/lib/crm/api-auth';
import {
  getPreCheckinStatus,
  listBookingsByReadinessStatus,
  PRE_CHECKIN_READINESS_STATUSES,
  type PreCheckinReadinessStatus,
} from '@/lib/booking-ops/pre-checkin-control-center';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeStatus(value: unknown): PreCheckinReadinessStatus | undefined {
  const raw = text(value);
  return (PRE_CHECKIN_READINESS_STATUSES as readonly string[]).includes(raw)
    ? raw as PreCheckinReadinessStatus
    : undefined;
}

export async function GET(req: Request): Promise<NextResponse> {
  const auth = await requireCrmOperatorSession();
  if ('error' in auth) return auth.error;

  const params = new URL(req.url).searchParams;
  const bookingId = text(params.get('bookingId'));

  try {
    if (bookingId) {
      const readiness = await getPreCheckinStatus(bookingId);
      return NextResponse.json({ ok: true, readiness });
    }

    const readiness = await listBookingsByReadinessStatus({
      status: normalizeStatus(params.get('status')),
      limit: Number(params.get('limit')) || 100,
    });
    return NextResponse.json({
      ok: true,
      readiness,
      refreshedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Не удалось загрузить контроль заезда.';
    const status = message === 'booking_not_found' ? 404 : 500;
    return NextResponse.json({ ok: false, message }, { status });
  }
}
