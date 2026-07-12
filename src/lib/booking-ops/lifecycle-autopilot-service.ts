import { createHash, randomUUID } from 'node:crypto';
import { supabase } from '@/lib/supabase';
import { initialLifecycleState, reduceLifecycle, type BookingEventActor, type LifecycleEvent, type LifecycleState } from './lifecycle-autopilot';

type RecordEventInput = {
  id?: string; bookingId: string; objectId?: string | null; type: string; actorType: BookingEventActor;
  actorId?: string | null; payload?: Record<string, unknown>; source: string; correlationId?: string;
  causationId?: string | null; createdAt?: string;
};

export function durableEventId(...parts: Array<string | null | undefined>): string {
  const hex = createHash('sha256').update(parts.map((part) => part ?? '').join('\u001f')).digest('hex').slice(0, 32).split('');
  hex[12] = '5';
  hex[16] = ((Number.parseInt(hex[16], 16) & 3) | 8).toString(16);
  return `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`;
}

const rowToEvent = (row: Record<string, unknown>): LifecycleEvent => ({
  id: String(row.id), bookingId: String(row.booking_id), objectId: row.object_id ? String(row.object_id) : null,
  type: String(row.event_type), actorType: row.actor_type as BookingEventActor,
  actorId: row.actor_id ? String(row.actor_id) : null, payload: (row.payload ?? {}) as Record<string, unknown>,
  source: String(row.source), correlationId: String(row.correlation_id),
  causationId: row.causation_id ? String(row.causation_id) : null, createdAt: String(row.created_at),
});

export async function processBookingDomainEvent(eventId: string) {
  const eventResult = await supabase.from('booking_ops_domain_events').select('*').eq('id', eventId).single();
  if (eventResult.error) throw new Error(eventResult.error.message);
  const event = rowToEvent(eventResult.data as Record<string, unknown>);
  const existing = await supabase.from('booking_ops_lifecycle_decisions').select('id').eq('event_id', event.id).maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data) return { processed: false, duplicate: true };
  const stateResult = await supabase.from('booking_ops_autopilot_states').select('state').eq('booking_id', event.bookingId).maybeSingle();
  if (stateResult.error) throw new Error(stateResult.error.message);
  const previous = (stateResult.data?.state as LifecycleState | undefined) ?? initialLifecycleState();
  const decision = reduceLifecycle(previous, event);
  const now = new Date().toISOString();
  for (const task of decision.tasksToCreate) {
    const result = await supabase.from('booking_ops_worker_tasks').upsert({
      id: randomUUID(), booking_id: event.bookingId, object_id: event.objectId ?? null, task_key: task.key,
      assigned_role: task.role, status: task.status, checklist: task.checklist, notes: task.notes ?? null,
      photo_attachments: task.photos ?? [], issue_report: task.issue ?? null, updated_at: now,
    }, { onConflict: 'booking_id,task_key', ignoreDuplicates: true });
    if (result.error) throw new Error(result.error.message);
  }
  const stateWrite = await supabase.from('booking_ops_autopilot_states').upsert({ booking_id: event.bookingId, stage: decision.state.stage, state: decision.state, last_event_id: event.id, updated_at: now }, { onConflict: 'booking_id' });
  if (stateWrite.error) throw new Error(stateWrite.error.message);
  const audit = decision.state.audit.at(-1)?.decision ?? 'event processed';
  const auditWrite = await supabase.from('booking_ops_lifecycle_decisions').insert({ id: randomUUID(), booking_id: event.bookingId, event_id: event.id, previous_stage: previous.stage, next_stage: decision.state.stage, decision: audit, blockers: decision.state.blockers, actions: decision.eventsToEmit });
  if (auditWrite.error?.code === '23505') return { processed: false, duplicate: true };
  if (auditWrite.error) throw new Error(auditWrite.error.message);
  await supabase.from('booking_ops_domain_events').update({ processed_at: now, processing_error: null }).eq('id', event.id);
  for (const emittedType of decision.eventsToEmit) {
    await recordAndProcessBookingEvent({
      id: durableEventId(event.id, emittedType), bookingId: event.bookingId, objectId: event.objectId,
      type: emittedType, actorType: 'system', source: 'lifecycle_orchestrator', correlationId: event.correlationId,
      causationId: event.id, payload: emittedType === 'property.ready' ? { ready: true } : {},
    });
  }
  return { processed: true, duplicate: false, decision };
}

export async function recordAndProcessBookingEvent(input: RecordEventInput) {
  const eventId = input.id ?? randomUUID();
  const insert = await supabase.from('booking_ops_domain_events').insert({
    id: eventId, booking_id: input.bookingId, object_id: input.objectId ?? null, event_type: input.type,
    actor_type: input.actorType, actor_id: input.actorId ?? null, payload: input.payload ?? {}, source: input.source,
    correlation_id: input.correlationId ?? randomUUID(), causation_id: input.causationId ?? null,
    created_at: input.createdAt ?? new Date().toISOString(),
  });
  if (insert.error?.code === '23505') return { eventId, processed: false, duplicate: true };
  if (insert.error) throw new Error(insert.error.message);
  try {
    return { eventId, ...(await processBookingDomainEvent(eventId)) };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'event_processing_failed';
    await supabase.from('booking_ops_domain_events').update({ processing_error: message }).eq('id', eventId);
    throw error;
  }
}

export async function recoverUnprocessedBookingEvents(limit = 100) {
  const result = await supabase.from('booking_ops_domain_events').select('id').is('processed_at', null).is('processing_error', null).order('created_at').limit(limit);
  if (result.error) throw new Error(result.error.message);
  let processed = 0; const errors: string[] = [];
  for (const row of result.data ?? []) {
    try { const outcome = await processBookingDomainEvent(String(row.id)); if (outcome.processed) processed += 1; }
    catch (error) { errors.push(error instanceof Error ? error.message : 'event_processing_failed'); }
  }
  return { evaluated: result.data?.length ?? 0, processed, errors };
}

export async function bootstrapBookingLifecycle(input: { bookingId: string; objectId?: string | null; actorId?: string | null }) {
  const id = durableEventId('ops-v16-bootstrap', input.bookingId, 'booking.received');
  return recordAndProcessBookingEvent({
    id,
    bookingId: input.bookingId,
    objectId: input.objectId ?? null,
    type: 'booking.received',
    actorType: 'system',
    actorId: input.actorId ?? null,
    source: 'ops_v16_admin_bootstrap',
    correlationId: durableEventId('ops-v16-bootstrap', input.bookingId),
    causationId: null,
    payload: { bootstrap: true, messagingDisabled: true },
  });
}

export async function getBookingLifecycleSummary(bookingId: string) {
  const [events, state, tasks, errors] = await Promise.all([
    supabase.from('booking_ops_domain_events').select('id', { count: 'exact', head: true }).eq('booking_id', bookingId),
    supabase.from('booking_ops_autopilot_states').select('stage,state,last_event_id,updated_at').eq('booking_id', bookingId).maybeSingle(),
    supabase.from('booking_ops_worker_tasks').select('id', { count: 'exact', head: true }).eq('booking_id', bookingId),
    supabase.from('booking_ops_domain_events').select('id,event_type,processing_error,created_at').eq('booking_id', bookingId).not('processing_error', 'is', null).order('created_at', { ascending: false }).limit(20),
  ]);
  for (const result of [events, state, tasks, errors]) if (result.error) throw new Error(result.error.message);
  const lifecycle = state.data?.state as LifecycleState | undefined;
  return {
    domainEventCount: events.count ?? 0,
    stage: state.data?.stage ?? null,
    readiness: lifecycle?.readiness ?? null,
    blockers: lifecycle?.blockers ?? [],
    workerTaskCount: tasks.count ?? 0,
    lastProcessedEvent: state.data?.last_event_id ?? null,
    processingErrors: (errors.data ?? []).map((row) => ({ id: row.id, type: row.event_type, error: row.processing_error, createdAt: row.created_at })),
    updatedAt: state.data?.updated_at ?? null,
  };
}
