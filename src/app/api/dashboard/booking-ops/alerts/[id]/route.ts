import { NextResponse } from 'next/server';
import { requireCrmOperatorSession } from '@/lib/crm/api-auth';
import { acknowledgeOperatorAlert, getOperatorAlert } from '@/lib/booking-ops/operator-alerts';
import { recordAndProcessBookingEvent } from '@/lib/booking-ops/lifecycle-autopilot-service';
import { resolveReservationAccess } from '@/lib/reservations/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: { id: string } }) {
  const auth = await requireCrmOperatorSession();
  if ('error' in auth) return auth.error;
  try {
    const access = await resolveReservationAccess(auth.session);
    if (access.accountId === 'legacy') throw new Error('account_workspace_unavailable');
    const alert = await getOperatorAlert(access.accountId, context.params.id);
    if (!alert) return NextResponse.json({ ok: false, message: 'Уведомление не найдено.' }, { status: 404 });
    return NextResponse.json({ ok: true, alert });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : 'Не удалось загрузить уведомление.' },
      { status: 400 },
    );
  }
}

export async function PATCH(request: Request, context: { params: { id: string } }) {
  const auth = await requireCrmOperatorSession();
  if ('error' in auth) return auth.error;
  const body = await request.json().catch(() => ({})) as { action?: string };
  if (body.action !== 'acknowledge') {
    return NextResponse.json({ ok: false, message: 'Действие не поддерживается.' }, { status: 400 });
  }
  try {
    const access = await resolveReservationAccess(auth.session);
    if (access.accountId === 'legacy') throw new Error('account_workspace_unavailable');
    const actor = auth.session.email ?? auth.session.userId ?? 'operator';
    const alert = await acknowledgeOperatorAlert(access.accountId, context.params.id, actor);
    await recordAndProcessBookingEvent({
      bookingId: alert.bookingId,
      type: 'alert.acknowledged',
      actorType: 'operator',
      actorId: auth.session.email ?? auth.session.userId ?? null,
      source: 'booking_ops_dashboard',
      payload: { alertId: context.params.id },
    });
    return NextResponse.json({ ok: true, alert });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Не удалось подтвердить уведомление.';
    return NextResponse.json(
      { ok: false, message },
      { status: message === 'alert_not_found_or_not_open' ? 404 : 400 },
    );
  }
}
