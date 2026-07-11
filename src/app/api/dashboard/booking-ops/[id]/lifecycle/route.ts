import { NextResponse } from 'next/server';
import { requireCrmOperatorSession, requireOpsAdminSession } from '@/lib/crm/api-auth';
import { getBookingOpsRecord } from '@/lib/booking-ops/repository';
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

  const record = await getBookingOpsRecord(context.params.id);
  if (!record) {
    return NextResponse.json({ ok: false, message: 'Запись не найдена.' }, { status: 404 });
  }
  await syncLifecycleFromBookingOpsRecord(record);
  const result = await getLifecycleStatus(record.id);
  if (!result.ok || !result.lifecycle) {
    return NextResponse.json(
      { ok: false, message: result.error ?? 'Не удалось загрузить готовность брони.' },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true, lifecycle: result.lifecycle });
}

export async function PATCH(req: Request, context: RouteContext): Promise<NextResponse> {
  const auth = await requireOpsAdminSession();
  if ('error' in auth) return auth.error;

  const record = await getBookingOpsRecord(context.params.id);
  if (!record) {
    return NextResponse.json({ ok: false, message: 'Запись не найдена.' }, { status: 404 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, message: 'Некорректный JSON.' }, { status: 400 });
  }

  const result = await adminUpdateLifecycleGate({
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
  });

  const lifecycle = await getLifecycleStatus(record.id);
  return NextResponse.json({ ok: true, gate: result.gate, lifecycle: lifecycle.lifecycle });
}
