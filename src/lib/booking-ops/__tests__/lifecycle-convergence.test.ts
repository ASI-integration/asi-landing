import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initialLifecycleState, reduceLifecycle, type LifecycleEvent } from '../lifecycle-autopilot';

type Task = { id: string; booking_id: string; task_key: string; assigned_role: string; status: string; completed_at?: string; completion_event_id?: string | null };
let tasks: Task[] = [];

function taskQuery() {
  let patch: Partial<Task> = {};
  const filters: Array<(task: Task) => boolean> = [];
  const api = {
    update: vi.fn((value: Partial<Task>) => { patch = value; return api; }),
    eq: vi.fn((key: keyof Task, value: unknown) => { filters.push((task) => task[key] === value); return api; }),
    neq: vi.fn((key: keyof Task, value: unknown) => { filters.push((task) => task[key] !== value); return api; }),
    like: vi.fn((key: keyof Task, value: string) => { const suffix = value.replace('%', ''); filters.push((task) => String(task[key]).endsWith(suffix)); return api; }),
    not: vi.fn((key: keyof Task, _operator: string, value: string) => { const suffix = value.replace('%', ''); filters.push((task) => !String(task[key]).endsWith(suffix)); return api; }),
    then: (resolve: (value: { error: null }) => unknown) => {
      for (const task of tasks.filter((candidate) => filters.every((filter) => filter(candidate)))) Object.assign(task, patch);
      return resolve({ error: null });
    },
  };
  return api;
}

vi.mock('@/lib/supabase', () => ({ supabase: { from: vi.fn((table: string) => {
  if (table === 'booking_ops_records') return { select: vi.fn(() => ({ eq: vi.fn(() => ({ single: vi.fn(async () => ({ data: { property_id: 'property-1' }, error: null })) })) })) };
  if (table === 'booking_ops_lifecycle_states') return { upsert: vi.fn(async () => ({ error: null })) };
  return taskQuery();
}) } }));

import { convergeLifecycleEvent, lifecycleProjection, taskCompletionTarget } from '../lifecycle-convergence';

const event = (type: string, id = type, payload: Record<string, unknown> = {}): LifecycleEvent => ({ id, bookingId: 'booking-1', objectId: null, type, actorType: 'system', payload, source: 'test', correlationId: 'run-1', createdAt: '2026-07-12T00:00:00.000Z' });
const now = '2026-07-12T01:00:00.000Z';

describe('OPS v17.3 lifecycle convergence', () => {
  beforeEach(() => {
    tasks = [
      { id: 'pre', booking_id: 'booking-1', task_key: 'booking-1:inspector', assigned_role: 'inspector', status: 'pending' },
      { id: 'checkout', booking_id: 'booking-1', task_key: 'booking-1:checkout:inspector', assigned_role: 'inspector', status: 'pending' },
      { id: 'reinspect', booking_id: 'booking-1', task_key: 'booking-1:reinspection:inspector', assigned_role: 'inspector', status: 'pending' },
    ];
  });

  it('advances the persisted projection from reducer output and synchronizes property_id', () => {
    const state = reduceLifecycle(initialLifecycleState(), event('guest.contacted')).state;
    expect(lifecycleProjection(state, 'property-1')).toMatchObject({ current_stage: 'guest_contacted', property_id: 'property-1' });
  });

  it('normal inspection completes only the pre-check-in task', async () => {
    await convergeLifecycleEvent(event('inspection.completed', 'normal-event'), initialLifecycleState(), now);
    expect(tasks.map(({ id, status }) => ({ id, status }))).toEqual([{ id: 'pre', status: 'completed' }, { id: 'checkout', status: 'pending' }, { id: 'reinspect', status: 'pending' }]);
    expect(tasks[0]).toMatchObject({ completed_at: now, completion_event_id: 'normal-event' });
  });

  it('checkout inspection completes only the checkout task', async () => {
    await convergeLifecycleEvent(event('checkout.inspection_completed', 'checkout-event'), initialLifecycleState(), now);
    expect(tasks.map(({ id, status }) => ({ id, status }))).toEqual([{ id: 'pre', status: 'pending' }, { id: 'checkout', status: 'completed' }, { id: 'reinspect', status: 'pending' }]);
  });

  it('a reinspection event targets its exact task and duplicate processing changes nothing', async () => {
    const exact = event('inspection.completed', 'reinspect-event', { taskId: 'reinspect', taskKey: 'booking-1:reinspection:inspector' });
    await convergeLifecycleEvent(exact, initialLifecycleState(), now);
    const snapshot = JSON.stringify(tasks);
    await convergeLifecycleEvent(exact, initialLifecycleState(), '2026-07-12T02:00:00.000Z');
    expect(tasks.find((task) => task.id === 'pre')?.status).toBe('pending');
    expect(tasks.find((task) => task.id === 'reinspect')).toMatchObject({ status: 'completed', completed_at: now, completion_event_id: 'reinspect-event' });
    expect(JSON.stringify(tasks)).toBe(snapshot);
  });

  it('uses exact deterministic keys only for synthetic events without task identity', () => {
    expect(taskCompletionTarget(event('inspection.completed'))?.taskKey).toBe('booking-1:inspector');
    expect(taskCompletionTarget(event('checkout.inspection_completed'))?.taskKey).toBe('booking-1:checkout:inspector');
  });
});
