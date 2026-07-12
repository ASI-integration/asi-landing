import { randomUUID } from 'node:crypto';
import { supabase } from '@/lib/supabase';
import { initialLifecycleState, reduceLifecycle, type LifecycleEvent, type LifecycleState } from './lifecycle-autopilot';
import { COMPLETION_ROLE, lifecycleProjection, taskCompletionTarget } from './lifecycle-convergence';

type Row = { id: string; account_id: string | null; property_id: string | null; reservation_metadata: Record<string, unknown> | null };
const safe = (metadata: Record<string, unknown> | null) => metadata?.acceptance_safe === true || metadata?.test_reservation === true || metadata?.environment === 'test';
const eventFrom = (row: Record<string, unknown>): LifecycleEvent => ({ id: String(row.id), bookingId: String(row.booking_id), objectId: row.object_id ? String(row.object_id) : null, type: String(row.event_type), actorType: row.actor_type as LifecycleEvent['actorType'], actorId: row.actor_id ? String(row.actor_id) : null, payload: (row.payload ?? {}) as Record<string, unknown>, source: String(row.source), correlationId: String(row.correlation_id), causationId: row.causation_id ? String(row.causation_id) : null, createdAt: String(row.created_at) });

export async function reconcileBookingLifecycle(input: { bookingId: string; accountId: string; actorId: string; dryRun?: boolean }) {
  const recordResult = await supabase.from('booking_ops_records').select('id,account_id,property_id,reservation_metadata').eq('id', input.bookingId).maybeSingle();
  if (recordResult.error) throw new Error(recordResult.error.message);
  if (!recordResult.data) throw new Error('reservation_not_found');
  const record = recordResult.data as Row;
  if (record.account_id !== input.accountId) throw new Error('reservation_account_mismatch');
  if (!safe(record.reservation_metadata)) throw new Error('reservation_not_test_safe');
  const [eventsResult, stateResult, tasksResult] = await Promise.all([
    supabase.from('booking_ops_domain_events').select('*').eq('booking_id', input.bookingId).order('created_at'),
    supabase.from('booking_ops_lifecycle_states').select('*').eq('booking_id', input.bookingId).maybeSingle(),
    supabase.from('booking_ops_worker_tasks').select('id,task_key,assigned_role,status,completion_event_id').eq('booking_id', input.bookingId),
  ]);
  for (const result of [eventsResult, stateResult, tasksResult]) if (result.error) throw new Error(result.error.message);
  let state: LifecycleState = initialLifecycleState();
  const completions: LifecycleEvent[] = [];
  for (const raw of eventsResult.data ?? []) {
    const event = eventFrom(raw as Record<string, unknown>); state = reduceLifecycle(state, event).state;
    if (COMPLETION_ROLE[event.type]) completions.push(event);
  }
  const projection = lifecycleProjection(state, record.property_id);
  const current = stateResult.data as Record<string, unknown> | null;
  const projectionChanged = !current || ['property_id','current_stage','status','blocker_reasons','next_action','final_checkin_draft_allowed'].some((key) => JSON.stringify(current[key]) !== JSON.stringify(projection[key as keyof typeof projection]));
  const latestCompletions = new Map<string, { event: LifecycleEvent; target: NonNullable<ReturnType<typeof taskCompletionTarget>> }>();
  for (const event of completions) {
    const target = taskCompletionTarget(event);
    if (target) latestCompletions.set(target.taskId ? `id:${target.taskId}` : `key:${target.taskKey}`, { event, target });
  }
  const taskRepairs = [...latestCompletions.values()].flatMap(({ event, target }) => {
    const task = (tasksResult.data ?? []).find((candidate) => {
      if (candidate.assigned_role !== target.role || candidate.status === 'cancelled') return false;
      if (target.taskId && candidate.id !== target.taskId) return false;
      if (target.taskKey && candidate.task_key !== target.taskKey) return false;
      const checkout = String(candidate.task_key).endsWith(':checkout:inspector');
      return checkout === target.checkout;
    });
    return task && (task.status !== 'completed' || task.completion_event_id !== event.id) ? [{ task, event }] : [];
  });
  const changed = projectionChanged || taskRepairs.length > 0;
  if (input.dryRun !== false || !changed) return { dryRun: input.dryRun !== false, changed, stage: state.stage, projectionChanged, taskRepairs: taskRepairs.length };
  const now = new Date().toISOString();
  if (projectionChanged) {
    const write = await supabase.from('booking_ops_lifecycle_states').upsert({ booking_id: input.bookingId, ...projection, last_orchestrated_at: now, updated_at: now }, { onConflict: 'booking_id' });
    if (write.error) throw new Error(write.error.message);
  }
  for (const { task, event } of taskRepairs) {
    const write = await supabase.from('booking_ops_worker_tasks').update({ status: 'completed', completed_at: now, completion_event_id: event.id, updated_at: now }).eq('id', task.id).eq('booking_id', input.bookingId).eq('assigned_role', COMPLETION_ROLE[event.type]!).neq('status', 'cancelled');
    if (write.error) throw new Error(write.error.message);
  }
  const audit = await supabase.from('booking_ops_lifecycle_events').insert({ id: randomUUID(), booking_id: input.bookingId, property_id: record.property_id, event_type: 'projection_reconciled', event_payload: { projectionChanged, taskRepairs: taskRepairs.length, noExternalActions: true }, actor_type: 'operator', actor_id: input.actorId, dedupe_key: `ops-v17.3-reconcile:${state.stage}:${taskRepairs.length}` });
  if (audit.error?.code !== '23505' && audit.error) throw new Error(audit.error.message);
  return { dryRun: false, changed: true, stage: state.stage, projectionChanged, taskRepairs: taskRepairs.length };
}
