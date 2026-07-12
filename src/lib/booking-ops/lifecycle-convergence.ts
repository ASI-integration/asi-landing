import { supabase } from '@/lib/supabase';
import type { LifecycleEvent, LifecycleState, WorkerTaskRole } from './lifecycle-autopilot';

export const COMPLETION_ROLE: Record<string, WorkerTaskRole | undefined> = {
  'cleaner.task_completed': 'cleaner',
  'linen.task_completed': 'linen_worker',
  'consumables.task_completed': 'consumables',
  'inspection.completed': 'inspector',
  'checkout.inspection_completed': 'inspector',
};

const FALLBACK_TASK_SUFFIX: Record<string, string | undefined> = {
  'cleaner.task_completed': 'cleaner',
  'linen.task_completed': 'linen_worker',
  'consumables.task_completed': 'consumables',
  'inspection.completed': 'inspector',
  'checkout.inspection_completed': 'checkout:inspector',
};

export type TaskCompletionTarget = { role: WorkerTaskRole; taskId?: string; taskKey?: string; checkout: boolean };

export function taskCompletionTarget(event: LifecycleEvent): TaskCompletionTarget | null {
  const role = COMPLETION_ROLE[event.type];
  const suffix = FALLBACK_TASK_SUFFIX[event.type];
  if (!role || !suffix) return null;
  const taskId = typeof event.payload.taskId === 'string' && event.payload.taskId ? event.payload.taskId : undefined;
  const payloadTaskKey = typeof event.payload.taskKey === 'string' && event.payload.taskKey ? event.payload.taskKey : undefined;
  return { role, taskId, taskKey: payloadTaskKey ?? (taskId ? undefined : `${event.bookingId}:${suffix}`), checkout: event.type === 'checkout.inspection_completed' };
}

export function lifecycleProjection(state: LifecycleState, propertyId: string | null) {
  const terminal = state.stage === 'closed';
  return {
    property_id: propertyId,
    current_stage: state.stage,
    status: terminal ? 'completed' : state.readiness === 'ready' ? 'ready_for_review' : 'active',
    blocker_reasons: terminal ? [] : state.blockers,
    next_action: terminal ? null : state.blockers[0] ?? null,
    next_action_due_at: null,
    sla_status: terminal ? 'satisfied' : 'on_track',
    severity: state.blockers.length && !terminal ? 'warning' : 'info',
    final_checkin_draft_allowed: !terminal && state.completed.includes('property_ready'),
    metadata: { canonicalSource: 'ops_v16_event_reducer', noExternalSend: true },
  };
}

export async function convergeLifecycleEvent(event: LifecycleEvent, state: LifecycleState, now: string) {
  const record = await supabase.from('booking_ops_records').select('property_id').eq('id', event.bookingId).single();
  if (record.error) throw new Error(record.error.message);
  const projection = lifecycleProjection(state, record.data?.property_id ? String(record.data.property_id) : null);
  const persisted = await supabase.from('booking_ops_lifecycle_states').upsert({
    booking_id: event.bookingId, ...projection, last_orchestrated_at: now, updated_at: now,
  }, { onConflict: 'booking_id' });
  if (persisted.error) throw new Error(persisted.error.message);

  const target = taskCompletionTarget(event);
  if (!target) return;
  let taskQuery = supabase.from('booking_ops_worker_tasks').update({
    status: 'completed', completed_at: now, completion_event_id: event.id, updated_at: now,
  }).eq('booking_id', event.bookingId).eq('assigned_role', target.role).neq('status', 'cancelled').neq('completion_event_id', event.id);
  if (target.taskId) taskQuery = taskQuery.eq('id', target.taskId);
  if (target.taskKey) taskQuery = taskQuery.eq('task_key', target.taskKey);
  taskQuery = target.checkout ? taskQuery.like('task_key', '%:checkout:inspector') : taskQuery.not('task_key', 'like', '%:checkout:inspector');
  const taskResult = await taskQuery;
  if (taskResult.error) throw new Error(taskResult.error.message);
}
