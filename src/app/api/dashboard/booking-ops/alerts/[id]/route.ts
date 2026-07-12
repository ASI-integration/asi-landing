import { NextResponse } from 'next/server';
import { requireCrmOperatorSession } from '@/lib/crm/api-auth';
import { supabase } from '@/lib/supabase';
import { acknowledgeOpsAlert } from '@/lib/booking-ops/ops-alert-orchestrator';
import { recordAndProcessBookingEvent } from '@/lib/booking-ops/lifecycle-autopilot-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: { id: string } }) {
  const auth = await requireCrmOperatorSession();
  if ('error' in auth) return auth.error;
  const result = await supabase.from('booking_ops_alerts').select('*').eq('id', context.params.id).maybeSingle();
  if (result.error) return NextResponse.json({ ok: false, message: result.error.message }, { status: 400 });
  if (!result.data) return NextResponse.json({ ok: false, message: 'Уведомление не найдено.' }, { status: 404 });
  return NextResponse.json({ ok: true, alert: result.data });
}

export async function PATCH(request: Request, context: { params: { id: string } }) {
  const auth = await requireCrmOperatorSession();
  if ('error' in auth) return auth.error;
  const body = await request.json().catch(() => ({})) as { action?: string };
  if (body.action !== 'acknowledge') return NextResponse.json({ ok: false, message: 'Действие не поддерживается.' }, { status: 400 });
  try {
    const alert = await acknowledgeOpsAlert(context.params.id, auth.session.email ?? auth.session.userId ?? 'operator');
    await recordAndProcessBookingEvent({ bookingId: String(alert.booking_id), type: 'alert.acknowledged', actorType: 'operator', actorId: auth.session.email ?? auth.session.userId ?? null, source: 'booking_ops_dashboard', payload: { alertId: context.params.id } });
    return NextResponse.json({ ok: true, alert });
  } catch (error) { return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : 'Не удалось подтвердить уведомление.' }, { status: 400 }); }
}
