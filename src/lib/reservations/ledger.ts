import { createHash, randomUUID } from 'node:crypto';
import { supabase } from '@/lib/supabase';
import { processInboundBookingRequest } from '@/lib/booking-ops/real-booking-intake-autopilot';
import { updateBookingOpsRecord } from '@/lib/booking-ops/repository';
import type { DirectReservationInput, SafeAvailabilityConflict } from './types';

const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
export async function auditReservationMutation(input: { accountId: string; actorId: string; reservationId?: string | null; action: string; before?: Record<string, unknown>; after?: Record<string, unknown> }) { const result = await supabase.from('reservation_ledger_audit').insert({ id: randomUUID(), account_id: input.accountId, booking_ops_record_id: input.reservationId ?? null, action: input.action, actor_id: input.actorId, before_value: input.before ?? {}, after_value: input.after ?? {} }); if (result.error) throw new Error(result.error.message); }
export function rangesOverlap(aFrom: string, aTo: string, bFrom: string, bTo: string) { return aFrom < bTo && bFrom < aTo; }
export function validateStayRange(checkIn: string, checkOut: string) {
  const from = new Date(checkIn); const to = new Date(checkOut);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) throw new Error('invalid_date_range');
  return { from: from.toISOString(), to: to.toISOString() };
}
export function safeImportFingerprint(input: Pick<DirectReservationInput, 'accountId'|'propertyId'|'unitId'|'checkIn'|'checkOut'|'guestPhone'|'guestEmail'>) {
  const contact = text(input.guestPhone).replace(/\D/g, '').slice(-10) || text(input.guestEmail).toLowerCase();
  return createHash('sha256').update([input.accountId,input.propertyId,input.unitId ?? '',input.checkIn,input.checkOut,contact].join('|')).digest('hex');
}

export async function getUnifiedAvailability(input: { accountId: string; propertyId: string; unitId?: string | null; checkIn: string; checkOut: string; excludeReservationId?: string }) {
  const range = validateStayRange(input.checkIn, input.checkOut); const now = new Date().toISOString();
  let reservations = supabase.from('booking_ops_records').select('id,asi_reference,check_in_at,check_out_at').eq('account_id', input.accountId).eq('property_id', input.propertyId).in('normalized_status', ['confirmed','checked_in']).lt('check_in_at', range.to).gt('check_out_at', range.from);
  if (input.unitId) reservations = reservations.eq('unit_id', input.unitId); if (input.excludeReservationId) reservations = reservations.neq('id', input.excludeReservationId);
  let holds = supabase.from('booking_availability_holds').select('id,date_from,date_to').eq('account_id', input.accountId).eq('property_id', input.propertyId).eq('status', 'active').lt('date_from', range.to).gt('date_to', range.from).or(`hold_expires_at.is.null,hold_expires_at.gt.${now}`);
  let blocks = supabase.from('booking_availability_blocks').select('id,date_from,date_to,block_type').eq('account_id', input.accountId).eq('property_id', input.propertyId).eq('status', 'active').lt('date_from', range.to).gt('date_to', range.from);
  if (input.unitId) { holds = holds.or(`unit_id.is.null,unit_id.eq.${input.unitId}`); blocks = blocks.or(`unit_id.is.null,unit_id.eq.${input.unitId}`); }
  const [r,h,b] = await Promise.all([reservations, holds, blocks]); const error = r.error ?? h.error ?? b.error; if (error) throw new Error(error.message);
  const conflicts: SafeAvailabilityConflict[] = [
    ...(r.data ?? []).map((x) => ({ kind: 'reservation' as const, id: x.id, reference: x.asi_reference ?? 'ASI reservation', dateFrom: x.check_in_at, dateTo: x.check_out_at })),
    ...(h.data ?? []).map((x) => ({ kind: 'hold' as const, id: x.id, reference: 'Temporary hold', dateFrom: x.date_from, dateTo: x.date_to })),
    ...(b.data ?? []).map((x) => ({ kind: 'block' as const, id: x.id, reference: x.block_type === 'maintenance' ? 'Maintenance block' : 'Owner block', dateFrom: x.date_from, dateTo: x.date_to })),
  ];
  return { available: conflicts.length === 0, range, conflicts };
}

async function sourceLink(accountId: string, reservationId: string, provider: string, externalId: string, input: DirectReservationInput) {
  const now = new Date().toISOString(); const existing = await supabase.from('reservation_source_links').select('id').eq('account_id', accountId).eq('provider', provider).eq('external_reservation_id', externalId).maybeSingle(); if (existing.error) throw new Error(existing.error.message); const result = await supabase.from('reservation_source_links').upsert({ id: existing.data?.id ?? randomUUID(), account_id: accountId, booking_ops_record_id: reservationId, provider, external_reservation_id: externalId, original_channel: input.originalChannel ?? null, source_status: input.confirmationMode, metadata: input.metadata ?? {}, last_seen_at: now, last_external_update_at: now }, { onConflict: 'account_id,provider,external_reservation_id', ignoreDuplicates: false }).select('id,booking_ops_record_id').single();
  if (result.error) throw new Error(result.error.message); return result.data;
}

export async function createDirectReservation(input: DirectReservationInput) {
  if (!input.accountId || !input.actorId || !input.idempotencyKey || !input.propertyId || !input.guestName || input.guestCount < 1) throw new Error('required_fields_missing');
  const range = validateStayRange(input.checkIn, input.checkOut);
  if (input.externalReservationId) { const provider = input.sourceProvider ?? input.sourceType; const linked = await supabase.from('reservation_source_links').select('booking_ops_record_id').eq('account_id', input.accountId).eq('provider', provider).eq('external_reservation_id', input.externalReservationId).maybeSingle(); if (linked.error) throw new Error(linked.error.message); if (linked.data) { await sourceLink(input.accountId, linked.data.booking_ops_record_id, provider, input.externalReservationId, input); return { created: false, reservationId: linked.data.booking_ops_record_id, duplicate: true }; } }
  if (!input.externalReservationId && !input.bookingReference) { const contactFilters = [input.guestPhone ? `guest_phone.eq.${input.guestPhone}` : null, input.guestEmail ? `guest_email.eq.${input.guestEmail}` : null, input.guestTelegram ? `guest_telegram.eq.${input.guestTelegram}` : null].filter(Boolean).join(','); if (contactFilters) { const candidates = await supabase.from('booking_ops_records').select('id,asi_reference').eq('account_id', input.accountId).eq('property_id', input.propertyId).eq('check_in_at', range.from).eq('check_out_at', range.to).or(contactFilters).limit(3); if (candidates.error) throw new Error(candidates.error.message); if ((candidates.data?.length ?? 0) > 1) { const item = await supabase.from('reservation_reconciliation_items').insert({ id: randomUUID(), account_id: input.accountId, kind: 'probable_duplicate', status: 'open', safe_summary: 'Several existing reservations match this request. Operator review is required.', evidence: { candidateReferences: candidates.data?.map((x) => x.asi_reference).filter(Boolean), propertyId: input.propertyId, unitId: input.unitId ?? null, checkIn: range.from, checkOut: range.to } }); if (item.error) throw new Error(item.error.message); return { created: false, needsReview: true, reconciliationKind: 'probable_duplicate' as const }; } } }
  const existingEvent = await supabase.from('booking_inbound_intake_events').select('booking_id,status').eq('idempotency_key', `msg:admin:${input.idempotencyKey}`).maybeSingle();
  if (existingEvent.error) throw new Error(existingEvent.error.message);
  if (existingEvent.data?.booking_id) return { created: false, reservationId: existingEvent.data.booking_id, duplicate: true };
  const availability = input.confirmationMode === 'inquiry' ? await getUnifiedAvailability({ accountId: input.accountId, propertyId: input.propertyId, unitId: input.unitId, checkIn: range.from, checkOut: range.to }) : { available: true, conflicts: [] as SafeAvailabilityConflict[] };
  let atomicHoldId: string | null = null;
  if (input.confirmationMode !== 'inquiry') {
    const reserved = await supabase.rpc('reserve_canonical_availability_atomic', { p_account_id: input.accountId, p_property_id: input.propertyId, p_unit_id: input.unitId ?? null, p_date_from: range.from.slice(0, 10), p_date_to: range.to.slice(0, 10), p_idempotency_key: `canonical:${input.accountId}:${input.idempotencyKey}`, p_hold_expires_at: input.holdExpiresAt ?? new Date(Date.now() + 30 * 60_000).toISOString() });
    if (reserved.error) throw new Error(reserved.error.message); const result = reserved.data as { ok: boolean; holdId?: string; conflicts?: SafeAvailabilityConflict[] }; if (!result.ok) return { created: false, blocked: true, conflicts: result.conflicts ?? [] }; atomicHoldId = result.holdId ?? null;
  }
  const intake = await processInboundBookingRequest({ guestName: input.guestName, guestPhone: input.guestPhone, guestEmail: input.guestEmail, guestTelegram: input.guestTelegram, checkInAt: range.from, checkOutAt: range.to, guestCount: input.guestCount, propertyId: input.propertyId, bookingReference: input.bookingReference, sourceMessageId: input.idempotencyKey, rawMessageText: input.notes, metadata: { ...input.metadata, sourceType: input.sourceType, confirmationMode: input.confirmationMode } }, 'admin');
  if (!intake.bookingId) throw new Error('canonical_intake_failed');
  const patch = await supabase.from('booking_ops_records').update({ account_id: input.accountId, unit_id: input.unitId ?? null, source_type: input.sourceType, source_provider: input.sourceProvider ?? null, original_channel: input.originalChannel ?? null, normalized_status: input.confirmationMode, amount: input.amount ?? null, currency: input.currency ?? null, payment_status: input.paymentStatus ?? null, deposit_status: input.depositStatus ?? 'not_required', sync_status: input.externalReservationId ? 'imported' : 'local_only', source_created_at: new Date().toISOString(), created_by_actor: input.actorId, reservation_metadata: input.metadata ?? {}, availability_status: input.confirmationMode === 'confirmed' ? 'confirmed' : input.confirmationMode === 'temporary_hold' ? 'held' : 'unchecked' }).eq('id', intake.bookingId).select('asi_reference').single();
  if (patch.error) throw new Error(patch.error.message);
  if (input.externalReservationId) await sourceLink(input.accountId, intake.bookingId, input.sourceProvider ?? input.sourceType, input.externalReservationId, input);
  if (atomicHoldId) { const hold = await supabase.from('booking_availability_holds').update({ booking_id: intake.bookingId, status: input.confirmationMode === 'confirmed' ? 'released' : 'active', updated_at: new Date().toISOString() }).eq('id', atomicHoldId); if (hold.error) throw new Error(hold.error.message); }
  await auditReservationMutation({ accountId: input.accountId, actorId: input.actorId, reservationId: intake.bookingId, action: 'reservation_created', after: { sourceType: input.sourceType, confirmationMode: input.confirmationMode, propertyId: input.propertyId, unitId: input.unitId ?? null, messagesSent: false } });
  return { created: true, reservationId: intake.bookingId, reference: patch.data.asi_reference, blocked: false, inquiryBlocker: input.confirmationMode === 'inquiry' ? availability.conflicts : [] };
}

export async function cancelReservation(input: { accountId: string; reservationId: string; actorId: string; reason?: string }) {
  const current = await supabase.from('booking_ops_records').select('normalized_status').eq('id', input.reservationId).eq('account_id', input.accountId).maybeSingle(); if (current.error) throw new Error(current.error.message); if (!current.data) throw new Error('not_found'); if (current.data.normalized_status === 'cancelled') return { changed: false };
  const now = new Date().toISOString(); const saved = await supabase.from('booking_ops_records').update({ normalized_status: 'cancelled', cancelled_at: now, cancellation_reason: input.reason ?? null, availability_status: 'unchecked', updated_at: now }).eq('id', input.reservationId).eq('account_id', input.accountId); if (saved.error) throw new Error(saved.error.message);
  await supabase.from('booking_availability_holds').update({ status: 'released', updated_at: now }).eq('booking_id', input.reservationId).eq('account_id', input.accountId);
  await updateBookingOpsRecord(input.reservationId, { isBlocked: true, blockerReason: 'Reservation cancelled' }, { actorType: 'admin' });
  await auditReservationMutation({ accountId: input.accountId, actorId: input.actorId, reservationId: input.reservationId, action: 'reservation_cancelled', before: { status: current.data.normalized_status }, after: { status: 'cancelled', reason: input.reason ?? null, messagesSent: false } });
  return { changed: true };
}

/** Restore a previously cancelled reservation identity after availability checks. Idempotent when already active. */
export async function restoreReservation(input: {
  accountId: string;
  reservationId: string;
  actorId: string;
  propertyId: string;
  unitId?: string | null;
  checkIn: string;
  checkOut: string;
  reason?: string;
}) {
  const current = await supabase
    .from('booking_ops_records')
    .select('id,normalized_status,property_id,unit_id,check_in_at,check_out_at')
    .eq('id', input.reservationId)
    .eq('account_id', input.accountId)
    .maybeSingle();
  if (current.error) throw new Error(current.error.message);
  if (!current.data) throw new Error('not_found');
  const status = String(current.data.normalized_status ?? '').toLowerCase();
  if (status !== 'cancelled' && status !== 'canceled') {
    return { changed: false, blocked: false as const, conflicts: [] as SafeAvailabilityConflict[] };
  }
  const range = validateStayRange(input.checkIn, input.checkOut);
  const availability = await getUnifiedAvailability({
    accountId: input.accountId,
    propertyId: input.propertyId,
    unitId: input.unitId ?? null,
    checkIn: range.from,
    checkOut: range.to,
    excludeReservationId: input.reservationId,
  });
  if (!availability.available) {
    return { changed: false, blocked: true as const, conflicts: availability.conflicts };
  }
  const now = new Date().toISOString();
  const saved = await supabase.from('booking_ops_records').update({
    normalized_status: 'confirmed',
    cancelled_at: null,
    cancellation_reason: null,
    availability_status: 'confirmed',
    check_in_at: range.from,
    check_out_at: range.to,
    updated_at: now,
  }).eq('id', input.reservationId).eq('account_id', input.accountId);
  if (saved.error) throw new Error(saved.error.message);
  await updateBookingOpsRecord(input.reservationId, {
    isBlocked: false,
    blockerReason: null,
    checkInAt: range.from,
    checkOutAt: range.to,
  }, { actorType: 'admin' });
  await auditReservationMutation({
    accountId: input.accountId,
    actorId: input.actorId,
    reservationId: input.reservationId,
    action: 'reservation_restored',
    before: { status: current.data.normalized_status },
    after: { status: 'confirmed', reason: input.reason ?? null, messagesSent: false },
  });
  return { changed: true, blocked: false as const, conflicts: [] as SafeAvailabilityConflict[] };
}

export async function createAvailabilityBlock(input: { accountId: string; actorId: string; propertyId: string; unitId?: string | null; checkIn: string; checkOut: string; type: 'owner'|'maintenance'; note?: string; severity?: string; issueTaskReference?: string; expectedReopeningAt?: string; reinspectionRequired?: boolean }) {
  const range = validateStayRange(input.checkIn, input.checkOut); const availability = await getUnifiedAvailability({ accountId: input.accountId, propertyId: input.propertyId, unitId: input.unitId, checkIn: range.from, checkOut: range.to });
  const result = await supabase.from('booking_availability_blocks').insert({ id: randomUUID(), account_id: input.accountId, property_id: input.propertyId, unit_id: input.unitId ?? null, date_from: range.from, date_to: range.to, source: input.type === 'maintenance' ? 'maintenance' : 'owner_stay', block_type: input.type, status: 'active', reason: input.note ?? null, severity: input.severity ?? null, issue_task_reference: input.issueTaskReference ?? null, expected_reopening_at: input.expectedReopeningAt ?? null, reinspection_required: input.reinspectionRequired === true, metadata: { createdByActor: input.actorId } }).select('id').single(); if (result.error) throw new Error(result.error.message);
  await auditReservationMutation({ accountId: input.accountId, actorId: input.actorId, action: 'availability_block_created', after: { blockId: result.data.id, type: input.type, propertyId: input.propertyId, unitId: input.unitId ?? null, dateFrom: range.from, dateTo: range.to } });
  return { id: result.data.id, conflicts: availability.conflicts };
}
