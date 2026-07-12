import { NextResponse } from 'next/server';
import { requireCrmOperatorSession, requireOpsAdminSession } from '@/lib/crm/api-auth';
import { supabase } from '@/lib/supabase';
import { cancelReservation, createAvailabilityBlock, createDirectReservation, getUnifiedAvailability } from '@/lib/reservations/ledger';
import { resolveReservationAccess } from '@/lib/reservations/access';
import { belongsToReservationAccount, isReservationVisibleInView, type ReservationView } from '@/lib/reservations/views';
import { reservationSourceTypes, type ConfirmationMode, type ReservationSourceType } from '@/lib/reservations/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const views = new Set<ReservationView>(['upcoming', 'active', 'inquiries', 'conflicts', 'cancelled', 'all']);
const conflictKinds = ['overlap_conflict', 'conflicting_update', 'probable_duplicate'];

export async function GET(req: Request) {
  const auth = await requireCrmOperatorSession();
  if ('error' in auth) return auth.error;
  try {
    const access = await resolveReservationAccess(auth.session);
    const url = new URL(req.url);
    const requestedView = url.searchParams.get('view') as ReservationView | null;
    const view = requestedView && views.has(requestedView) ? requestedView : 'all';
    let query = supabase.from('booking_ops_records').select('id,account_id,asi_reference,property_id,property_label,unit_id,source_type,source_provider,original_channel,check_in_at,check_out_at,guest_name,guest_count,normalized_status,payment_status,deposit_status,amount,currency,sync_status,created_at,updated_at').eq('account_id', access.accountId).order('check_in_at', { ascending: true }).limit(500);
    for (const [key, column] of [['property', 'property_id'], ['unit', 'unit_id'], ['source', 'source_type'], ['status', 'normalized_status']] as const) {
      const value = url.searchParams.get(key);
      if (value) query = query.eq(column, value);
    }
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    if (from) query = query.gte('check_out_at', from);
    if (to) query = query.lte('check_in_at', to);

    const [records, holds, reconciliation, unassigned] = await Promise.all([
      query,
      supabase.from('booking_availability_holds').select('booking_id').eq('account_id', access.accountId).eq('status', 'active').or(`hold_expires_at.is.null,hold_expires_at.gt.${new Date().toISOString()}`),
      supabase.from('reservation_reconciliation_items').select('booking_ops_record_id').eq('account_id', access.accountId).eq('status', 'open').in('kind', conflictKinds),
      access.isOpsAdmin ? supabase.from('booking_ops_records').select('id', { count: 'exact', head: true }).is('account_id', null) : Promise.resolve({ count: null, error: null }),
    ]);
    const error = records.error ?? holds.error ?? reconciliation.error ?? unassigned.error;
    if (error) return NextResponse.json({ ok: false, message: error.message }, { status: 400 });
    const activeHoldIds = new Set((holds.data ?? []).map((row) => row.booking_id).filter(Boolean));
    const conflictReservationIds = new Set((reconciliation.data ?? []).map((row) => row.booking_ops_record_id).filter(Boolean));
    const scopedRows = (records.data ?? []).filter((row) => belongsToReservationAccount(row, access.accountId)).filter((row) => isReservationVisibleInView({ row, view, now: new Date(), activeHoldIds, conflictReservationIds }));
    const reservations = scopedRows.map(({ account_id: _accountId, ...row }) => row);
    return NextResponse.json({ ok: true, reservations, visibleCount: reservations.length, unresolvedConflictCount: conflictReservationIds.size, ...(access.isOpsAdmin ? { unassignedLegacyCount: unassigned.count ?? 0 } : {}) });
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : 'reservation_list_failed' }, { status: 403 });
  }
}

export async function POST(req: Request) {
  const auth = await requireOpsAdminSession();
  if ('error' in auth) return auth.error;
  try {
    const access = await resolveReservationAccess(auth.session);
    const body = await req.json() as Record<string, unknown>;
    const action = String(body.action ?? 'create');
    if (action === 'availability') return NextResponse.json({ ok: true, availability: await getUnifiedAvailability({ accountId: access.accountId, propertyId: String(body.propertyId ?? ''), unitId: body.unitId ? String(body.unitId) : null, checkIn: String(body.checkIn ?? ''), checkOut: String(body.checkOut ?? '') }) });
    if (action === 'cancel') return NextResponse.json({ ok: true, result: await cancelReservation({ accountId: access.accountId, reservationId: String(body.reservationId ?? ''), actorId: access.actorId, reason: body.reason ? String(body.reason) : undefined }) });
    if (action === 'block') return NextResponse.json({ ok: true, block: await createAvailabilityBlock({ accountId: access.accountId, actorId: access.actorId, propertyId: String(body.propertyId ?? ''), unitId: body.unitId ? String(body.unitId) : null, checkIn: String(body.checkIn ?? ''), checkOut: String(body.checkOut ?? ''), type: body.type === 'maintenance' ? 'maintenance' : 'owner', note: body.note ? String(body.note) : undefined, severity: body.severity ? String(body.severity) : undefined, issueTaskReference: body.issueTaskReference ? String(body.issueTaskReference) : undefined, expectedReopeningAt: body.expectedReopeningAt ? String(body.expectedReopeningAt) : undefined, reinspectionRequired: body.reinspectionRequired === true }) });
    const sourceType = reservationSourceTypes.includes(body.sourceType as ReservationSourceType) ? body.sourceType as ReservationSourceType : 'manual';
    const reservation = await createDirectReservation({ accountId: access.accountId, actorId: access.actorId, idempotencyKey: String(body.idempotencyKey ?? ''), propertyId: String(body.propertyId ?? ''), unitId: body.unitId ? String(body.unitId) : null, checkIn: String(body.checkIn ?? ''), checkOut: String(body.checkOut ?? ''), guestName: String(body.guestName ?? ''), guestPhone: body.guestPhone ? String(body.guestPhone) : null, guestEmail: body.guestEmail ? String(body.guestEmail) : null, guestTelegram: body.guestTelegram ? String(body.guestTelegram) : null, guestCount: Number(body.guestCount ?? 1), sourceType, sourceProvider: body.sourceProvider ? String(body.sourceProvider) : null, bookingReference: body.bookingReference ? String(body.bookingReference) : null, amount: body.amount == null ? null : Number(body.amount), currency: body.currency ? String(body.currency) : null, paymentStatus: body.paymentStatus ? String(body.paymentStatus) : null, depositStatus: body.depositStatus ? String(body.depositStatus) : null, notes: body.notes ? String(body.notes) : null, confirmationMode: (['inquiry', 'temporary_hold', 'confirmed'].includes(String(body.confirmationMode)) ? body.confirmationMode : 'inquiry') as ConfirmationMode, holdExpiresAt: body.holdExpiresAt ? String(body.holdExpiresAt) : null });
    return NextResponse.json({ ok: !reservation.blocked, reservation }, { status: reservation.blocked ? 409 : 200 });
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : 'reservation_action_failed' }, { status: 400 });
  }
}
