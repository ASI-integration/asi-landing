import { NextResponse } from 'next/server';
import { requireOpsAdminSession } from '@/lib/crm/api-auth';
import { requireBookingOpsApiAccess } from '@/app/api/dashboard/booking-ops/access';
import { sameIdentity } from '@/lib/platform/decision';
import { adaptResidentialOpsDecision } from '@/lib/platform/ops-decision';
import { resolveResidentialBookingIdentity } from '@/lib/platform/residential-booking-scope';
import {
  recomputeBookingCheckinReadiness,
  runPreCheckinAction,
} from '@/lib/booking-ops/pre-checkin-control-center';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function text(value: unknown): string {
  return String(value ?? '').trim();
}

export async function POST(req: Request): Promise<NextResponse> {
  const auth = await requireOpsAdminSession();
  if ('error' in auth) return auth.error;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const bookingId = text(body.bookingId ?? body.booking_id);
  if (!bookingId) {
    return NextResponse.json({ ok: false, message: 'Не указана бронь.' }, { status: 400 });
  }

  try {
    const access = await requireBookingOpsApiAccess(auth.session, bookingId);
    if (!access.ok) return access.response;
    const identity = {
      kind: 'identified' as const,
      accountId: access.accountId,
      propertyId: access.propertyId,
      bookingId: access.bookingId,
    };
    const expectedScope = { accountId: access.accountId, propertyId: access.propertyId };
    const readiness = body.action
      ? await runPreCheckinAction({
          bookingId,
          action: text(body.action),
          gateKey: body.gateKey ?? body.gate_key,
          reason: body.reason,
          note: body.note,
          metadata: body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
            ? body.metadata as Record<string, unknown>
            : {},
          expectedScope,
        })
      : await recomputeBookingCheckinReadiness(bookingId, { expectedScope });

    let platformDecision = adaptResidentialOpsDecision(identity, 'pre_checkin', {
      available: true,
      identity,
      observedAt: readiness.lastRecomputedAt,
      value: { kind: 'pre_checkin', readiness },
    }, Date.now());
    try {
      const currentIdentity = await resolveResidentialBookingIdentity(bookingId, access.accountId);
      if (!sameIdentity(identity, currentIdentity)) {
        platformDecision = adaptResidentialOpsDecision(
          identity,
          'pre_checkin',
          { available: false, reason: 'state_changed' },
          Date.now(),
        );
      }
    } catch {
      platformDecision = adaptResidentialOpsDecision(
        identity,
        'pre_checkin',
        { available: false, reason: 'unavailable' },
        Date.now(),
      );
    }

    return NextResponse.json({
      ok: true,
      readiness,
      platformDecision,
      message: 'Контроль заезда пересчитан. Внешние сообщения не отправлялись.',
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
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : 'Не удалось пересчитать контроль заезда.' },
      { status: 500 },
    );
  }
}
