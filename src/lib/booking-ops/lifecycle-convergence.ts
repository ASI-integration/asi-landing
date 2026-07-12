import { supabase } from '@/lib/supabase';
import type { LifecycleEvent, LifecycleState, WorkerTaskRole } from './lifecycle-autopilot';

export const COMPLETION_ROLE: Record<string, WorkerTaskRole | undefined> = {
  'cleaner.task_completed': 'cleaner',
  'linen.task_completed': 'linen_worker',
  'consumables.task_completed': 'consumables',
  'inspection.completed': 'inspector',
  'checkout.inspection_completed': 'inspector',
};

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

  const role = COMPLETION_ROLE[event.type];
  if (!role) return;
  let taskQuery = supabase.from('booking_ops_worker_tasks').update({
    status: 'completed', completed_at: now, completion_event_id: event.id, updated_at: now,
  }).eq('booking_id', event.bookingId).eq('assigned_role', role).neq('status', 'cancelled');
  taskQuery = event.type === 'checkout.inspection_completed'
    ? taskQuery.like('task_key', '%:checkout:inspector')
    : taskQuery.not('task_key', 'like', '%:checkout:inspector');
  const taskResult = await taskQuery;
  if (taskResult.error) throw new Error(taskResult.error.message);
}
