import { NextResponse } from 'next/server';
import { requireBookingOpsApiAccess } from '../../access';
import { requireCrmOperatorSession, requireOpsAdminSession } from '@/lib/crm/api-auth';
import { requireBookingOpsRecordScope } from '@/lib/booking-ops/repository';
import {
  adminUpdateLifecycleGate,
  getLifecycleStatus,
  syncLifecycleFromBookingOpsRecord,
} from '@/lib/booking-ops/lifecycle';
import { recordAndProcessBookingEvent } from '@/lib/booking-ops/lifecycle-autopilot-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: { id: string } };

export async function GET(_req: Request, context: RouteContext): Promise<NextResponse> {
  const auth = await requireCrmOperatorSession();
  if ('error' in auth) return auth.error;
  const access = await requireBookingOpsApiAccess(auth.session, context.params.id);
  if (!access.ok) return access.response;
  const expectedScope = { accountId: access.accountId, propertyId: access.propertyId };

  try {
    const record = await requireBookingOpsRecordScope(access.bookingId, expectedScope);
    await syncLifecycleFromBookingOpsRecord(record, expectedScope);
    const result = await getLifecycleStatus(record.id, expectedScope);
    if (!result.ok || !result.lifecycle) {
      return NextResponse.json(
        { ok: false, message: result.error ?? 'Не удалось загрузить готовность брони.' },
        { status: 500 },
      );
    }
    return NextResponse.json({ ok: true, lifecycle: result.lifecycle });
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    const status = code === 'booking_scope_mismatch' ? 403 : code === 'booking_not_found' ? 404 : 500;
    return NextResponse.json({ ok: false, message: status === 403 ? 'Нет доступа к бронированию.' : 'Не удалось загрузить готовность брони.' }, { status });
  }
}

export async function PATCH(req: Request, context: RouteContext): Promise<NextResponse> {
  const auth = await requireOpsAdminSession();
  if ('error' in auth) return auth.error;
  const access = await requireBookingOpsApiAccess(auth.session, context.params.id);
  if (!access.ok) return access.response;
  const expectedScope = { accountId: access.accountId, propertyId: access.propertyId };

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, message: 'Некорректный JSON.' }, { status: 400 });
  }

  try {
    const record = await requireBookingOpsRecordScope(access.bookingId, expectedScope);
    const result = await adminUpdateLifecycleGate({
      expectedScope,
      bookingId: record.id,
      gateKey: body.gateKey ?? body.gate_key,
      status: body.status,
      reason: body.reason,
      note: body.note,
      metadata: { manual: true },
    });
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, message: result.error ?? 'Не удалось обновить этап брони.' },
        { status: 400 },
      );
    }

    await recordAndProcessBookingEvent({
      bookingId: record.id, type: 'manual.override', actorType: 'operator', actorId: auth.session.email ?? auth.session.userId ?? null,
      source: 'booking_ops_lifecycle_override', payload: { reason: String(body.reason ?? body.note ?? ''), gateKey: body.gateKey ?? body.gate_key, previousState: 'unknown', resultingState: body.status, timestamp: new Date().toISOString() },
    }, expectedScope);

    const lifecycle = await getLifecycleStatus(record.id, expectedScope);
    return NextResponse.json({ ok: true, gate: result.gate, lifecycle: lifecycle.lifecycle });
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    const status = code === 'booking_scope_mismatch' ? 403 : code === 'booking_not_found' ? 404 : 500;
    return NextResponse.json({ ok: false, message: status === 403 ? 'Нет доступа к бронированию.' : 'Не удалось обновить этап брони.' }, { status });
  }
}
