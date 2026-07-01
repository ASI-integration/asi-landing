import { NextResponse } from 'next/server';
import { requireOpsAdminSession } from '@/lib/crm/api-auth';
import { supabase } from '@/lib/supabase';
import {
  enqueueAutoSendDelivery,
  executeAutoSendDelivery,
  toSafeDeliveryView,
} from '@/lib/booking-ops/communication-auto-send-executor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: { id: string; communicationId: string } };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(req: Request, context: RouteContext): Promise<NextResponse> {
  const auth = await requireOpsAdminSession();
  if ('error' in auth) return auth.error;
  if (!UUID_RE.test(context.params.communicationId)) {
    return NextResponse.json({ ok: false, message: 'Некорректный идентификатор коммуникации.' }, { status: 400 });
  }
  const { data, error } = await supabase
    .from('booking_ops_communication_intents')
    .select('id')
    .eq('id', context.params.communicationId)
    .eq('booking_ops_record_id', context.params.id)
    .maybeSingle();
  if (error) return NextResponse.json({ ok: false, message: 'Не удалось проверить коммуникацию.' }, { status: 500 });
  if (!data) return NextResponse.json({ ok: false, message: 'Коммуникация не найдена.' }, { status: 404 });
  let body: { dryRun?: unknown } = {};
  try { body = await req.json(); } catch { /* empty body means actual execution */ }
  const queued = await enqueueAutoSendDelivery(context.params.communicationId, {
    source: 'booking_ops_operator',
    dry_run: body.dryRun === true,
  });
  if (!queued.ok) return NextResponse.json({ ok: false, message: 'Отправка не разрешена.', reason: queued.error }, { status: 409 });
  const result = await executeAutoSendDelivery(queued.delivery.id, { dryRun: body.dryRun === true });
  return NextResponse.json({
    ...result,
    delivery: toSafeDeliveryView(result.delivery ?? null),
    message: result.ok
      ? (body.dryRun === true ? 'Проверка завершена без отправки.' : 'Сообщение отправлено.')
      : 'Отправка заблокирована правилами безопасности.',
  }, { status: result.ok ? 200 : 409 });
}
