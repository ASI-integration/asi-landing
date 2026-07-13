import { NextResponse } from 'next/server';
import { requireCrmOperatorSession } from '@/lib/crm/api-auth';
import { getOperatorAlert } from '@/lib/booking-ops/operator-alerts';
import { applyOperatorAlertAction, getOperatorAlertControl, OPERATOR_ALERT_ACTIONS, type OperatorAlertAction } from '@/lib/booking-ops/operator-exception-actions';
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
    return NextResponse.json({ ok: true, alert: { ...alert, control: await getOperatorAlertControl(alert, access.isOpsAdmin) } });
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
  const body = await request.json().catch(() => ({})) as {
    action?: string; reason?: string; resolutionCategory?: string; missingDataReason?: string; idempotencyKey?: string;
    executorId?: string; assignedToName?: string; assignedToPhone?: string; assignedToTelegram?: string;
  };
  if (!OPERATOR_ALERT_ACTIONS.includes(body.action as OperatorAlertAction)) {
    return NextResponse.json({ ok: false, message: 'Действие не поддерживается.' }, { status: 400 });
  }
  try {
    const access = await resolveReservationAccess(auth.session);
    if (access.accountId === 'legacy') throw new Error('account_workspace_unavailable');
    const actorId = auth.session.userId ?? auth.session.email ?? 'operator';
    const result = await applyOperatorAlertAction({
      accountId: access.accountId, alertId: context.params.id, action: body.action as OperatorAlertAction,
      actorId, canOverrideHighRisk: access.isOpsAdmin, idempotencyKey: body.idempotencyKey,
      executorId: body.executorId, assignedToName: body.assignedToName, assignedToPhone: body.assignedToPhone,
      assignedToTelegram: body.assignedToTelegram, missingDataReason: body.missingDataReason,
      resolutionCategory: body.resolutionCategory, reason: body.reason,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Не удалось подтвердить уведомление.';
    return NextResponse.json(
      { ok: false, message },
      { status: message === 'alert_not_found_or_not_open' || message === 'alert_not_found' ? 404 : message === 'high_risk_alert_override_forbidden' ? 403 : 400 },
    );
  }
}
