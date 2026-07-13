import { supabase } from '@/lib/supabase';
import { createBookingOpsTask } from './tasks';
import { durableEventId, recordProcessedBookingAuditEvent } from './lifecycle-autopilot-service';
import { ensurePhysicalTasks } from './physical-readiness-execution';

type ReservationCandidate = {
  id: string;
  account_id: string | null;
  property_id: string | null;
  check_in_at: string | null;
  normalized_status?: string | null;
  ops_status?: string | null;
};

const TERMINAL_STATUSES = new Set(['cancelled', 'canceled', 'completed', 'closed', 'archived', 'inactive']);

function text(value: unknown): string { return String(value ?? '').trim(); }
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function selectEarliestEligibleUpcomingBooking(input: {
  previousBookingId: string;
  accountId: string;
  propertyId: string;
  boundary: string;
  candidates: ReservationCandidate[];
}): ReservationCandidate | null {
  const boundaryMs = new Date(input.boundary).getTime();
  return input.candidates
    .filter((candidate) => candidate.id !== input.previousBookingId)
    .filter((candidate) => text(candidate.account_id) === input.accountId && text(candidate.property_id) === input.propertyId)
    .filter((candidate) => !TERMINAL_STATUSES.has(text(candidate.normalized_status).toLowerCase()))
    .filter((candidate) => !TERMINAL_STATUSES.has(text(candidate.ops_status).toLowerCase()))
    .filter((candidate) => {
      const checkInMs = new Date(text(candidate.check_in_at)).getTime();
      return Number.isFinite(checkInMs) && checkInMs >= boundaryMs;
    })
    .sort((left, right) => new Date(text(left.check_in_at)).getTime() - new Date(text(right.check_in_at)).getTime())[0] ?? null;
}

export type TurnoverCleaningActivation =
  | { kind: 'upcoming_booking'; previousBookingId: string; nextBookingId: string; cleaningTaskId: string; created: boolean }
  | { kind: 'fallback_task'; previousBookingId: string; taskId: string; created: boolean };

export async function activateTurnoverCleaningAfterCheckout(previousBookingId: string, occurredAt?: string): Promise<TurnoverCleaningActivation> {
  const previousResult = await supabase.from('booking_ops_records')
    .select('id,booking_id,account_id,property_id,check_out_at,normalized_status,ops_status')
    .eq('id', previousBookingId).maybeSingle();
  if (previousResult.error) throw new Error(previousResult.error.message);
  const previous = previousResult.data as (ReservationCandidate & { booking_id?: string | null; check_out_at?: string | null }) | null;
  if (!previous) throw new Error('booking_not_found');
  const accountId = text(previous.account_id);
  const propertyId = text(previous.property_id);
  if (!accountId || accountId === 'legacy') throw new Error('booking_account_missing');
  if (!propertyId) throw new Error('booking_property_missing');
  const boundary = occurredAt ?? text(previous.check_out_at);
  const boundaryDate = new Date(boundary);
  if (!boundary || Number.isNaN(boundaryDate.getTime())) throw new Error('checkout_boundary_invalid');
  const boundaryIso = boundaryDate.toISOString();

  const upcomingResult = await supabase.from('booking_ops_records')
    .select('id,account_id,property_id,check_in_at,normalized_status,ops_status')
    .eq('account_id', accountId).eq('property_id', propertyId).gte('check_in_at', boundaryIso)
    .neq('id', previousBookingId).order('check_in_at', { ascending: true }).limit(50);
  if (upcomingResult.error) throw new Error(upcomingResult.error.message);
  const next = selectEarliestEligibleUpcomingBooking({
    previousBookingId, accountId, propertyId, boundary: boundaryIso,
    candidates: (upcomingResult.data ?? []) as ReservationCandidate[],
  });

  if (!next) {
    const fallback = await createBookingOpsTask({
      bookingOpsRecordId: previousBookingId,
      bookingId: text(previous.booking_id) || null,
      taskType: 'cleaning_needed',
      source: 'system',
      title: 'Нужна уборка после выезда',
      priority: 'normal',
      metadata: { source: 'checkout_trigger', previousBookingId, propertyId, reasonCode: 'no_next_booking' },
    });
    if (!fallback.ok) throw new Error(fallback.error);
    return { kind: 'fallback_task', previousBookingId, taskId: fallback.task.id, created: fallback.created };
  }

  await ensurePhysicalTasks(next.id);
  const cleaningResult = await supabase.from('booking_cleaning_tasks').select('*').eq('booking_id', next.id).maybeSingle();
  if (cleaningResult.error) throw new Error(cleaningResult.error.message);
  if (!cleaningResult.data) throw new Error('cleaning_task_not_initialized');
  const cleaning = cleaningResult.data as Record<string, unknown>;
  const linkage = { previousBookingId, nextBookingId: next.id, source: 'checkout_trigger' };
  const reportPayload = object(cleaning.report_payload);
  const alreadyLinked = JSON.stringify(reportPayload.turnoverLinkage) === JSON.stringify(linkage);
  if (!alreadyLinked) {
    const update = await supabase.from('booking_cleaning_tasks').update({
      report_payload: { ...reportPayload, turnoverLinkage: linkage }, updated_at: new Date().toISOString(),
    }).eq('id', String(cleaning.id)).eq('booking_id', next.id);
    if (update.error) throw new Error(update.error.message);
  }
  const cleaningTaskId = String(cleaning.id);
  await recordProcessedBookingAuditEvent({
    id: durableEventId('turnover_cleaning_activated', previousBookingId, next.id),
    bookingId: next.id,
    objectId: propertyId,
    type: 'turnover_cleaning_activated',
    actorType: 'system',
    source: 'checkout_trigger',
    correlationId: durableEventId('checkout_turnover', previousBookingId),
    payload: { previousBookingId, nextBookingId: next.id, propertyId, cleaningTaskId, outcome: alreadyLinked ? 'reused' : 'created_or_linked' },
  });
  return { kind: 'upcoming_booking', previousBookingId, nextBookingId: next.id, cleaningTaskId, created: !alreadyLinked };
}
