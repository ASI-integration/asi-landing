import { NextResponse } from 'next/server';
import { requireOpsAdminSession } from '@/lib/crm/api-auth';
import { supabase } from '@/lib/supabase';
import {
  blockIntentAutoSend,
  disableAutoSendForBooking,
  markBookingMessageTypeSafe,
  markIntentAutoSendEligible,
  markIntentReviewRequired,
} from '@/lib/booking-ops/communication-auto-send-policy';
import { listBookingOpsCommunicationsForRecord } from '@/lib/booking-ops/communication-orchestrator';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: { id: string; communicationId: string } };
type Action = 'approve_send' | 'force_review' | 'block_auto_send' | 'mark_safe_type' | 'disable_booking';

const ACTIONS = new Set<Action>([
  'approve_send',
  'force_review',
  'block_auto_send',
  'mark_safe_type',
  'disable_booking',
]);

export async function POST(req: Request, context: RouteContext): Promise<NextResponse> {
  const auth = await requireOpsAdminSession();
  if ('error' in auth) return auth.error;

  let body: { action?: unknown };
  try {
    body = await req.json() as { action?: unknown };
  } catch {
    return NextResponse.json({ ok: false, message: 'Некорректный JSON.' }, { status: 400 });
  }
  const action = String(body.action ?? '') as Action;
  if (!ACTIONS.has(action)) {
    return NextResponse.json({ ok: false, message: 'Неизвестное действие.' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('booking_ops_communication_intents')
    .select('id,booking_ops_record_id,booking_id,purpose')
    .eq('id', context.params.communicationId)
    .eq('booking_ops_record_id', context.params.id)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ ok: false, message: 'Не удалось проверить коммуникацию.' }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ ok: false, message: 'Коммуникация не найдена.' }, { status: 404 });
  }

  const row = data as {
    id: string;
    booking_ops_record_id: string;
    booking_id: string | null;
    purpose: string;
  };
  const bookingScope = row.booking_id ?? row.booking_ops_record_id;
  const operatorMetadata = { operator_action: action };
  let result: { ok: boolean; error?: string };

  switch (action) {
    case 'approve_send':
      result = await markIntentAutoSendEligible(row.id, 'Разрешено оператором после проверки.', operatorMetadata);
      break;
    case 'force_review':
      result = await markIntentReviewRequired(row.id, 'Оператор назначил ручную проверку.', operatorMetadata);
      break;
    case 'block_auto_send':
      result = await blockIntentAutoSend(row.id, 'Оператор заблокировал автоотправку.', operatorMetadata);
      break;
    case 'mark_safe_type':
      result = await markBookingMessageTypeSafe(bookingScope, row.purpose);
      if (result.ok) {
        result = await markIntentAutoSendEligible(
          row.id,
          'Тип сообщения разрешён оператором для этой брони.',
          { ...operatorMetadata, actual_send_enabled: true },
        );
      }
      break;
    case 'disable_booking':
      result = await disableAutoSendForBooking(bookingScope);
      if (result.ok) {
        result = await markIntentReviewRequired(row.id, 'Автоотправка отключена для брони.', operatorMetadata);
      }
      break;
  }

  if (!result.ok) {
    const unsafe = result.error === 'unsafe_override_denied' || result.error === 'message_type_cannot_be_marked_safe';
    return NextResponse.json({
      ok: false,
      message: unsafe
        ? 'Правило безопасности не позволяет включить автоотправку для этой коммуникации.'
        : 'Не удалось изменить правило автоотправки.',
    }, { status: unsafe ? 409 : 500 });
  }

  const refreshed = await listBookingOpsCommunicationsForRecord(context.params.id);
  return NextResponse.json({
    ok: true,
    communications: refreshed.ok ? refreshed.communications : undefined,
    message: action === 'approve_send'
      ? 'Коммуникация разрешена для очереди. Фактическая отправка не выполнялась.'
      : 'Правило автоотправки обновлено.',
  });
}
