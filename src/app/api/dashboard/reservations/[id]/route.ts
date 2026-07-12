import { NextResponse } from 'next/server';
import { requireCrmOperatorSession, requireOpsAdminSession } from '@/lib/crm/api-auth';
import { updateBookingOpsRecord } from '@/lib/booking-ops/repository';
import { supabase } from '@/lib/supabase';
import { auditReservationMutation, getUnifiedAvailability } from '@/lib/reservations/ledger';

const accountId = (session: { userId?: string | null }) => session.userId ?? '';

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireCrmOperatorSession(); if ('error' in auth) return auth.error;
  const { id } = await context.params;
  const result = await supabase.from('booking_ops_records').select('*,reservation_source_links(*)').eq('id', id).eq('account_id', accountId(auth.session)).maybeSingle();
  if (result.error) return NextResponse.json({ ok: false, message: result.error.message }, { status: 400 });
  return result.data ? NextResponse.json({ ok: true, reservation: result.data }) : NextResponse.json({ ok: false, message: 'not_found' }, { status: 404 });
}

export async function PATCH(req: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireOpsAdminSession(); if ('error' in auth) return auth.error;
  const { id } = await context.params; const account = accountId(auth.session);
  const scoped = await supabase.from('booking_ops_records').select('id,property_id,unit_id,check_in_at,check_out_at,guest_count,payment_status,deposit_status,notes').eq('id', id).eq('account_id', account).maybeSingle();
  if (!scoped.data) return NextResponse.json({ ok: false, message: 'not_found' }, { status: 404 });
  const body = await req.json() as Record<string, unknown>;
  const propertyId = String(body.propertyId ?? scoped.data.property_id ?? ''); const unitId = body.unitId === undefined ? scoped.data.unit_id : body.unitId ? String(body.unitId) : null;
  const checkIn = String(body.checkIn ?? scoped.data.check_in_at ?? ''); const checkOut = String(body.checkOut ?? scoped.data.check_out_at ?? '');
  if (body.propertyId !== undefined || body.unitId !== undefined || body.checkIn !== undefined || body.checkOut !== undefined) {
    const availability = await getUnifiedAvailability({ accountId: account, propertyId, unitId, checkIn, checkOut, excludeReservationId: id });
    if (!availability.available) return NextResponse.json({ ok: false, message: 'reservation_conflict', conflicts: availability.conflicts }, { status: 409 });
  }
  const result = await updateBookingOpsRecord(id, { propertyId: body.propertyId as string | undefined, guestName: body.guestName as string | undefined, guestPhone: body.guestPhone as string | undefined, guestEmail: body.guestEmail as string | undefined, guestTelegram: body.guestTelegram as string | undefined, checkInAt: body.checkIn as string | undefined, checkOutAt: body.checkOut as string | undefined, guestCount: body.guestCount as number | undefined, notes: body.notes as string | undefined, paymentStatus: body.paymentStatus as string | undefined, depositStatus: body.depositStatus as never }, { actorType: 'admin' });
  if (!result.ok) return NextResponse.json({ ok: false, message: result.error }, { status: 400 });
  if (body.unitId !== undefined) { const unit = await supabase.from('booking_ops_records').update({ unit_id: unitId, updated_at: new Date().toISOString() }).eq('id', id).eq('account_id', account); if (unit.error) return NextResponse.json({ ok: false, message: unit.error.message }, { status: 400 }); }
  await auditReservationMutation({ accountId: account, actorId: auth.session.userId!, reservationId: id, action: 'reservation_updated', before: scoped.data, after: { propertyId, unitId, checkIn, checkOut, guestCount: body.guestCount ?? scoped.data.guest_count, paymentStatus: body.paymentStatus ?? scoped.data.payment_status, depositStatus: body.depositStatus ?? scoped.data.deposit_status, notesChanged: body.notes !== undefined } });
  return NextResponse.json({ ok: true, reservation: result.record });
}
