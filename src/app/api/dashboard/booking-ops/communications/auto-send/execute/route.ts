import { NextResponse } from 'next/server';
import { requireOpsAdminSession } from '@/lib/crm/api-auth';
import {
  enqueueAutoSendDelivery,
  executeAutoSendDelivery,
  executeEligibleAutoSendBatch,
  toSafeDeliveryView,
} from '@/lib/booking-ops/communication-auto-send-executor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(req: Request): Promise<NextResponse> {
  const auth = await requireOpsAdminSession();
  if ('error' in auth) return auth.error;
  let body: { intentId?: unknown; deliveryId?: unknown; maxBatchSize?: unknown; dryRun?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, message: 'Некорректный JSON.' }, { status: 400 });
  }
  const deliveryId = String(body.deliveryId ?? '');
  const intentId = String(body.intentId ?? '');
  if (deliveryId) {
    if (!UUID_RE.test(deliveryId)) return NextResponse.json({ ok: false, message: 'Некорректный идентификатор доставки.' }, { status: 400 });
    const result = await executeAutoSendDelivery(deliveryId, { dryRun: body.dryRun === true });
    return NextResponse.json({ ...result, delivery: toSafeDeliveryView(result.delivery ?? null) }, { status: result.ok ? 200 : 409 });
  }
  if (intentId) {
    if (!UUID_RE.test(intentId)) return NextResponse.json({ ok: false, message: 'Некорректный идентификатор коммуникации.' }, { status: 400 });
    const queued = await enqueueAutoSendDelivery(intentId, { source: 'operator_execute' });
    if (!queued.ok) return NextResponse.json({ ok: false, message: 'Отправка не разрешена.', reason: queued.error }, { status: 409 });
    const result = await executeAutoSendDelivery(queued.delivery.id, { dryRun: body.dryRun === true });
    return NextResponse.json({ ...result, delivery: toSafeDeliveryView(result.delivery ?? null) }, { status: result.ok ? 200 : 409 });
  }
  const result = await executeEligibleAutoSendBatch({
    dryRun: body.dryRun === true,
    maxBatchSize: Math.min(Math.max(Number(body.maxBatchSize ?? 20) || 20, 1), 50),
  });
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
