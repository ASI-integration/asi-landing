import { NextResponse } from 'next/server';
import { requireCrmOperatorSession } from '@/lib/crm/api-auth';
import { resolveReservationAccess } from '@/lib/reservations/access';
import { sameIdentity } from '@/lib/platform/decision';
import { adaptResidentialOpsDecision } from '@/lib/platform/ops-decision';
import { resolveResidentialBookingIdentity } from '@/lib/platform/residential-booking-scope';
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
      const access = await resolveReservationAccess(auth.session);
      const identity = await resolveResidentialBookingIdentity(bookingId, access.accountId);
      const readiness = await getPreCheckinStatus(bookingId);
      const currentIdentity = await resolveResidentialBookingIdentity(bookingId, access.accountId);
      if (!sameIdentity(identity, currentIdentity)) {
        return NextResponse.json({ ok: false, message: 'Состояние бронирования изменилось. Повторите запрос.' }, { status: 409 });
      }
      const platformDecision = adaptResidentialOpsDecision(identity, 'pre_checkin', {
        available: true,
        identity,
        observedAt: readiness.lastRecomputedAt,
        value: { kind: 'pre_checkin', readiness },
      }, Date.now());
      return NextResponse.json({ ok: true, readiness, platformDecision });
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
    const code = error instanceof Error ? error.message : '';
    if (code === 'booking_not_found') {
      return NextResponse.json({ ok: false, message: 'Бронирование не найдено.' }, { status: 404 });
    }
    if (code === 'booking_scope_mismatch' || code === 'reservation_account_not_found') {
      return NextResponse.json({ ok: false, message: 'Нет доступа к бронированию.' }, { status: 403 });
    }
    if (code === 'booking_scope_unavailable') {
      return NextResponse.json({ ok: false, message: 'Не удалось подтвердить область бронирования.' }, { status: 409 });
    }
    return NextResponse.json({ ok: false, message: 'Не удалось загрузить контроль заезда.' }, { status: 500 });
  }
}
