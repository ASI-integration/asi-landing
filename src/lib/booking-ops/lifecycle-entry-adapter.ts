import { durableEventId, recordAndProcessBookingEvent } from './lifecycle-autopilot-service';
import type { BookingEventActor } from './lifecycle-autopilot';

const ACTION_EVENTS: Record<string, string | null> = {
  documents_received: 'guest.documents_received', verify_documents: 'guest.documents_verified', prepare_contract: 'contract.generated',
  request_deposit: 'deposit.requested', deposit_received: 'deposit.confirmed', waive_deposit: 'deposit.confirmed',
  mvd_report_accepted: 'mvd.completed', record_documents_received: 'guest.documents_received',
  mark_documents_verified_manual: 'guest.documents_verified', create_contract_draft: 'contract.generated',
  create_deposit_request_draft: 'deposit.requested', mark_deposit_paid_manual: 'deposit.confirmed',
  mark_deposit_waived_manual: 'deposit.confirmed', mark_mvd_not_required: 'mvd.not_required', mark_mvd_accepted_manual: 'mvd.completed',
  mark_guest_checked_out: 'checkout.started', mark_post_checkout_inspection_done: 'checkout.inspection_completed',
  mark_deposit_return_ready: 'deposit.returned', mark_booking_closed: 'booking.closed',
  mark_instructions_sent: 'checkin.instructions_released', mark_guest_checked_in: 'guest.checked_in',
  simulate_release: 'checkin.instructions_released',
};

export async function emitLifecycleForAction(input: { bookingId: string; action: string; actorType?: BookingEventActor; actorId?: string | null; source: string; payload?: Record<string, unknown>; occurrence?: string }) {
  const type = ACTION_EVENTS[input.action];
  if (!type) return null;
  const occurrence = input.occurrence ?? JSON.stringify(input.payload ?? {});
  return recordAndProcessBookingEvent({
    id: durableEventId(input.source, input.bookingId, input.action, occurrence), bookingId: input.bookingId, type,
    actorType: input.actorType ?? 'operator', actorId: input.actorId ?? null, source: input.source,
    correlationId: durableEventId(input.source, input.bookingId, occurrence), payload: { action: input.action, ...(input.payload ?? {}) },
  });
}

export async function emitPhysicalLifecycle(input: { bookingId: string; action: string; actorId?: string | null; body: Record<string, unknown> }) {
  const status = String(input.body.status ?? '');
  let type: string | null = null;
  if (input.action === 'update_cleaning' && status === 'verified') type = 'cleaner.task_completed';
  if (input.action === 'update_linen' && ['completed', 'delivered', 'verified'].includes(status)) type = 'linen.task_completed';
  if (input.action === 'update_supplies' && ['completed', 'verified', 'waived'].includes(status)) type = 'consumables.task_completed';
  if (input.action === 'create_maintenance') type = 'damage.reported';
  if (input.action === 'update_maintenance' && ['completed', 'resolved'].includes(status)) type = 'maintenance.task_completed';
  if (input.action === 'final_approval') type = 'inspection.completed';
  if (!type) return null;
  return recordAndProcessBookingEvent({ id: durableEventId('physical_readiness', input.bookingId, input.action, String(input.body.id ?? ''), status), bookingId: input.bookingId, type, actorType: 'operator', actorId: input.actorId, source: 'physical_readiness', correlationId: durableEventId('physical_readiness', input.bookingId, input.action), payload: { action: input.action, status } });
}
