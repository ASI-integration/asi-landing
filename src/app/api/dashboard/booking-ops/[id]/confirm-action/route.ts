import { NextResponse } from 'next/server';
import { requireOpsAdminSession } from '@/lib/crm/api-auth';
import { resolveReservationAccess } from '@/lib/reservations/access';
import { resolveResidentialBookingIdentity } from '@/lib/platform/residential-booking-scope';
import { applyBookingOpsOperatorAction } from '@/lib/booking-ops/action-templates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: { id: string } };

export async function POST(req: Request, context: RouteContext): Promise<NextResponse> {
  const auth = await requireOpsAdminSession();
  if ('error' in auth) return auth.error;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, message: 'Некорректный JSON.' }, { status: 400 });
  }

  const actionId = String(body.actionId ?? body.action_id ?? '').trim();
  if (!actionId) {
    return NextResponse.json({ ok: false, message: 'Укажите действие (actionId).' }, { status: 400 });
  }

  let expectedScope: { accountId: string; propertyId: string };
  try {
    const access = await resolveReservationAccess(auth.session);
    const identity = await resolveResidentialBookingIdentity(context.params.id, access.accountId);
    expectedScope = { accountId: identity.accountId, propertyId: identity.propertyId };
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    if (code === 'booking_not_found') {
      return NextResponse.json({ ok: false, message: 'Запись не найдена.' }, { status: 404 });
    }
    if (code === 'booking_scope_mismatch' || code === 'reservation_account_not_found') {
      return NextResponse.json({ ok: false, message: 'Нет доступа к бронированию.' }, { status: 403 });
    }
    return NextResponse.json(
      { ok: false, message: 'Не удалось подтвердить область бронирования.' },
      { status: 409 },
    );
  }

  const result = await applyBookingOpsOperatorAction(
    context.params.id,
    actionId,
    { expectedScope },
  );
  if (!result.ok) {
    const status = result.error === 'not_found' ? 404 : result.error === 'scope_mismatch' ? 409 : 400;
    return NextResponse.json(
      { ok: false, message: result.error },
      { status },
    );
  }

  return NextResponse.json({ ok: true, record: result.record });
}
