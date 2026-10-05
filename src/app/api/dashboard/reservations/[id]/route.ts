import { NextResponse } from 'next/server';
import { requireCrmOperatorSession, requireOpsAdminSession } from '@/lib/crm/api-auth';
import {
  requireBookingOpsApiAccess,
  requireBookingOpsApiPropertyAccess,
} from '@/app/api/dashboard/booking-ops/access';
import { updateBookingOpsRecord } from '@/lib/booking-ops/repository';
import { supabase } from '@/lib/supabase';
import { auditReservationMutation, getUnifiedAvailability } from '@/lib/reservations/ledger';

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireCrmOperatorSession();
  if ('error' in auth) return auth.error;

  const { id } = await context.params;
  const access = await requireBookingOpsApiAccess(auth.session, id);
  if (!access.ok) return access.response;

  const result = await supabase
    .from('booking_ops_records')
    .select('*,reservation_source_links(*)')
    .eq('id', access.bookingId)
    .eq('account_id', access.accountId)
    .eq('property_id', access.propertyId)
    .maybeSingle();

  if (result.error) {
    return NextResponse.json({ ok: false, message: result.error.message }, { status: 400 });
  }
  return result.data
    ? NextResponse.json({ ok: true, reservation: result.data })
    : NextResponse.json({ ok: false, message: 'not_found' }, { status: 404 });
}

export async function PATCH(req: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireOpsAdminSession();
  if ('error' in auth) return auth.error;

  const { id } = await context.params;
  const currentAccess = await requireBookingOpsApiAccess(auth.session, id);
  if (!currentAccess.ok) return currentAccess.response;

  const scoped = await supabase
    .from('booking_ops_records')
    .select('id,property_id,unit_id,check_in_at,check_out_at,guest_count,payment_status,deposit_status,notes')
    .eq('id', currentAccess.bookingId)
    .eq('account_id', currentAccess.accountId)
    .eq('property_id', currentAccess.propertyId)
    .maybeSingle();

  if (scoped.error) {
    return NextResponse.json({ ok: false, message: scoped.error.message }, { status: 400 });
  }
  if (!scoped.data) {
    return NextResponse.json({ ok: false, message: 'scope_mismatch' }, { status: 409 });
  }

  const body = await req.json() as Record<string, unknown>;
  const targetPropertyId = body.propertyId === undefined
    ? currentAccess.propertyId
    : String(body.propertyId ?? '').trim();
  if (!targetPropertyId) {
    return NextResponse.json({ ok: false, message: 'property_id_required' }, { status: 400 });
  }

  const isTransfer = targetPropertyId !== currentAccess.propertyId;
  if (isTransfer) {
    const targetAccess = await requireBookingOpsApiPropertyAccess(auth.session, targetPropertyId);
    if (!targetAccess.ok) return targetAccess.response;
    if (targetAccess.accountId !== currentAccess.accountId) {
      return NextResponse.json({ ok: false, message: 'property_scope_mismatch' }, { status: 403 });
    }
  }

  const unitId = body.unitId === undefined
    ? (isTransfer ? null : scoped.data.unit_id)
    : body.unitId
      ? String(body.unitId)
      : null;
  const checkIn = String(body.checkIn ?? scoped.data.check_in_at ?? '');
  const checkOut = String(body.checkOut ?? scoped.data.check_out_at ?? '');

  if (
    isTransfer
    || body.unitId !== undefined
    || body.checkIn !== undefined
    || body.checkOut !== undefined
  ) {
    const availability = await getUnifiedAvailability({
      accountId: currentAccess.accountId,
      propertyId: targetPropertyId,
      unitId,
      checkIn,
      checkOut,
      excludeReservationId: currentAccess.bookingId,
    });
    if (!availability.available) {
      return NextResponse.json(
        { ok: false, message: 'reservation_conflict', conflicts: availability.conflicts },
        { status: 409 },
      );
    }
  }

  const result = await updateBookingOpsRecord(
    currentAccess.bookingId,
    {
      propertyId: isTransfer ? targetPropertyId : undefined,
      unitId: isTransfer || body.unitId !== undefined ? unitId : undefined,
      guestName: body.guestName as string | undefined,
      guestPhone: body.guestPhone as string | undefined,
      guestEmail: body.guestEmail as string | undefined,
      guestTelegram: body.guestTelegram as string | undefined,
      checkInAt: body.checkIn as string | undefined,
      checkOutAt: body.checkOut as string | undefined,
      guestCount: body.guestCount as number | undefined,
      notes: body.notes as string | undefined,
      paymentStatus: body.paymentStatus as string | undefined,
      depositStatus: body.depositStatus as never,
    },
    {
      actorType: 'admin',
      expectedScope: {
        accountId: currentAccess.accountId,
        propertyId: currentAccess.propertyId,
      },
      resultScope: {
        accountId: currentAccess.accountId,
        propertyId: targetPropertyId,
      },
    },
  );

  if (!result.ok) {
    const status = result.error === 'scope_mismatch' || result.error === 'property_scope_mismatch'
      ? 409
      : 400;
    return NextResponse.json({ ok: false, message: result.error }, { status });
  }

  await auditReservationMutation({
    accountId: currentAccess.accountId,
    actorId: currentAccess.actorId,
    reservationId: currentAccess.bookingId,
    action: 'reservation_updated',
    before: scoped.data,
    after: {
      propertyId: targetPropertyId,
      unitId,
      checkIn,
      checkOut,
      guestCount: body.guestCount ?? scoped.data.guest_count,
      paymentStatus: body.paymentStatus ?? scoped.data.payment_status,
      depositStatus: body.depositStatus ?? scoped.data.deposit_status,
      notesChanged: body.notes !== undefined,
    },
  });

  return NextResponse.json({ ok: true, reservation: result.record });
}
