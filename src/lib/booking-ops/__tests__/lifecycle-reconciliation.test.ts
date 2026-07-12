import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = {
  lifecycle: { current_stage: 'guest_intake', status: 'waiting_guest', blocker_reasons: ['guest_data'], next_action: 'collect', final_checkin_draft_allowed: false, property_id: null } as Record<string, unknown>,
  tasks: [{ id: 'task-1', task_key: 'booking-1:cleaner', assigned_role: 'cleaner', status: 'pending', completion_event_id: null as string | null }],
  audits: 0,
};
let events = [
  { id: 'e1', booking_id: 'booking-1', object_id: 'property-1', event_type: 'cleaner.task_completed', actor_type: 'system', payload: {}, source: 'test', correlation_id: 'c1', created_at: '2026-07-12T00:00:00Z' },
];

function query(table: string) {
  let taskId = '';
  let pendingPatch: Record<string, unknown> | null = null;
  const api: Record<string, unknown> = {
    select: vi.fn(() => api), eq: vi.fn((key: string, value: unknown) => { if (key === 'id') { taskId = String(value); if (pendingPatch) Object.assign(db.tasks.find((task) => task.id === taskId) ?? {}, pendingPatch); } return api; }), neq: vi.fn(() => api), order: vi.fn(() => api),
    maybeSingle: vi.fn(async () => table === 'booking_ops_records' ? { data: { id: 'booking-1', account_id: 'account-1', property_id: 'property-1', reservation_metadata: { acceptance_safe: true } }, error: null } : { data: db.lifecycle, error: null }),
    upsert: vi.fn((patch: Record<string, unknown>) => { db.lifecycle = { ...db.lifecycle, ...patch }; return Promise.resolve({ error: null }); }),
    update: vi.fn((patch: Record<string, unknown>) => { pendingPatch = patch; return api; }),
    insert: vi.fn(() => { if (table === 'booking_ops_lifecycle_events') db.audits += 1; return Promise.resolve({ error: null }); }),
    then: (resolve: (value: unknown) => unknown) => resolve(table === 'booking_ops_domain_events' ? { data: events, error: null } : table === 'booking_ops_worker_tasks' ? { data: db.tasks, error: null } : { data: [], error: null }),
  };
  return api;
}

vi.mock('@/lib/supabase', () => ({ supabase: { from: vi.fn((table: string) => query(table)) } }));
import { reconcileBookingLifecycle } from '../lifecycle-reconciliation';

describe('OPS v17.3 lifecycle reconciliation', () => {
  beforeEach(() => {
    db.lifecycle = { current_stage: 'guest_intake', status: 'waiting_guest', blocker_reasons: ['guest_data'], next_action: 'collect', final_checkin_draft_allowed: false, property_id: null };
    db.tasks = [{ id: 'task-1', task_key: 'booking-1:cleaner', assigned_role: 'cleaner', status: 'pending', completion_event_id: null }];
    events = [{ id: 'e1', booking_id: 'booking-1', object_id: 'property-1', event_type: 'cleaner.task_completed', actor_type: 'system', payload: {}, source: 'test', correlation_id: 'c1', created_at: '2026-07-12T00:00:00Z' }];
    db.audits = 0;
  });

  it('dry-run reports repairs without changing projections or tasks', async () => {
    const before = JSON.stringify(db);
    const result = await reconcileBookingLifecycle({ bookingId: 'booking-1', accountId: 'account-1', actorId: 'actor-1' });
    expect(result.changed).toBe(true); expect(JSON.stringify(db)).toBe(before);
  });

  it('repairs stale projections and deterministic task completion once', async () => {
    const result = await reconcileBookingLifecycle({ bookingId: 'booking-1', accountId: 'account-1', actorId: 'actor-1', dryRun: false });
    expect(result.changed).toBe(true); expect(db.lifecycle.property_id).toBe('property-1'); expect(db.tasks[0].status).toBe('completed'); expect(db.audits).toBe(1);
  });

  it('reports no changes on a second reconciliation', async () => {
    await reconcileBookingLifecycle({ bookingId: 'booking-1', accountId: 'account-1', actorId: 'actor-1', dryRun: false });
    const second = await reconcileBookingLifecycle({ bookingId: 'booking-1', accountId: 'account-1', actorId: 'actor-1', dryRun: false });
    expect(second.changed).toBe(false); expect(db.audits).toBe(1);
  });

  it('repairs only the inspector task identified by historical taskId and taskKey', async () => {
    db.tasks = [
      { id: 'pre', task_key: 'booking-1:inspector', assigned_role: 'inspector', status: 'pending', completion_event_id: null },
      { id: 'checkout', task_key: 'booking-1:checkout:inspector', assigned_role: 'inspector', status: 'pending', completion_event_id: null },
      { id: 'reinspect', task_key: 'booking-1:reinspection:inspector', assigned_role: 'inspector', status: 'pending', completion_event_id: null },
    ];
    events = [{ id: 'inspection-event', booking_id: 'booking-1', object_id: 'property-1', event_type: 'inspection.completed', actor_type: 'worker', payload: { taskId: 'reinspect', taskKey: 'booking-1:reinspection:inspector' }, source: 'secure_task_workspace', correlation_id: 'c2', created_at: '2026-07-12T00:00:00Z' }];
    const result = await reconcileBookingLifecycle({ bookingId: 'booking-1', accountId: 'account-1', actorId: 'actor-1', dryRun: false });
    expect(result.taskRepairs).toBe(1);
    expect(db.tasks.map(({ id, status }) => ({ id, status }))).toEqual([{ id: 'pre', status: 'pending' }, { id: 'checkout', status: 'pending' }, { id: 'reinspect', status: 'completed' }]);
    expect(db.tasks[2].completion_event_id).toBe('inspection-event');
  });

  it('uses the exact checkout fallback key for older acceptance events', async () => {
    db.tasks = [
      { id: 'pre', task_key: 'booking-1:inspector', assigned_role: 'inspector', status: 'pending', completion_event_id: null },
      { id: 'checkout', task_key: 'booking-1:checkout:inspector', assigned_role: 'inspector', status: 'pending', completion_event_id: null },
    ];
    events = [{ id: 'checkout-event', booking_id: 'booking-1', object_id: 'property-1', event_type: 'checkout.inspection_completed', actor_type: 'system', payload: {}, source: 'acceptance', correlation_id: 'c3', created_at: '2026-07-12T00:00:00Z' }];
    await reconcileBookingLifecycle({ bookingId: 'booking-1', accountId: 'account-1', actorId: 'actor-1', dryRun: false });
    expect(db.tasks.map(({ id, status }) => ({ id, status }))).toEqual([{ id: 'pre', status: 'pending' }, { id: 'checkout', status: 'completed' }]);
  });
});
