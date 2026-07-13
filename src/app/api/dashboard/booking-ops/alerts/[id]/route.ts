import { NextResponse } from 'next/server';
import { requireCrmOperatorSession } from '@/lib/crm/api-auth';
import { getOperatorAlert } from '@/lib/booking-ops/operator-alerts';
import { applyOperatorExceptionAction, OPERATOR_EXCEPTION_ACTIONS, type OperatorExceptionAction } from '@/lib/booking-ops/operator-exception-actions';
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
  const body = await request.json().catch(() => ({})) as { action?: string; reason?: string; assignedToName?: string; assignedToPhone?: string; assignedToTelegram?: string };
  if (!OPERATOR_EXCEPTION_ACTIONS.includes(body.action as OperatorExceptionAction)) {
    return NextResponse.json({ ok: false, message: 'Действие не поддерживается.' }, { status: 400 });
  }
  try {
    const access = await resolveReservationAccess(auth.session);
    if (access.accountId === 'legacy') throw new Error('account_workspace_unavailable');
    const actor = auth.session.email ?? auth.session.userId ?? 'operator';
    const result = await applyOperatorExceptionAction({ accountId: access.accountId, alertId: context.params.id, action: body.action as OperatorExceptionAction, actor, reason: body.reason, assignedToName: body.assignedToName, assignedToPhone: body.assignedToPhone, assignedToTelegram: body.assignedToTelegram });
    const alert = result.alert;
    if (!alert) throw new Error('alert_not_found');
    await recordAndProcessBookingEvent({
      bookingId: alert.bookingId,
      type: body.action === 'acknowledge' ? 'alert.acknowledged' : 'alert.exception_action',
      actorType: 'operator',
      actorId: auth.session.email ?? auth.session.userId ?? null,
      source: 'booking_ops_dashboard',
      payload: { alertId: context.params.id, action: body.action },
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Не удалось подтвердить уведомление.';
    return NextResponse.json(
      { ok: false, message },
      { status: message === 'alert_not_found_or_not_open' || message === 'alert_not_found' ? 404 : 400 },
    );
  }
}
