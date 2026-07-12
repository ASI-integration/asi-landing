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
    neq: vi.fn((key: keyof Task, value: unknown) => { filters.push((task) => task[key] != null && task[key] !== value); return api; }),
    or: vi.fn((expression: string) => {
      const match = expression.match(/^completion_event_id\.is\.null,completion_event_id\.neq\.(.+)$/);
      if (!match) throw new Error(`unsupported_or_filter:${expression}`);
      filters.push((task) => task.completion_event_id == null || task.completion_event_id !== match[1]);
      return api;
    }),
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
      { id: 'pre', booking_id: 'booking-1', task_key: 'booking-1:inspector', assigned_role: 'inspector', status: 'pending', completion_event_id: null },
      { id: 'checkout', booking_id: 'booking-1', task_key: 'booking-1:checkout:inspector', assigned_role: 'inspector', status: 'pending', completion_event_id: null },
      { id: 'reinspect', booking_id: 'booking-1', task_key: 'booking-1:reinspection:inspector', assigned_role: 'inspector', status: 'pending', completion_event_id: null },
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

  it('backfills an event id on an already completed workspace task with a NULL event id', async () => {
    tasks[2].status = 'completed';
    await convergeLifecycleEvent(event('inspection.completed', 'workspace-event', { taskId: 'reinspect', taskKey: 'booking-1:reinspection:inspector' }), initialLifecycleState(), now);
    expect(tasks[2]).toMatchObject({ status: 'completed', completed_at: now, completion_event_id: 'workspace-event' });
    expect(tasks[0].completion_event_id).toBeNull();
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

  it('completes every synthetic golden-path fallback task with initially NULL event ids', async () => {
    tasks = [
      { id: 'cleaner', booking_id: 'booking-1', task_key: 'booking-1:cleaner', assigned_role: 'cleaner', status: 'pending', completion_event_id: null },
      { id: 'linen', booking_id: 'booking-1', task_key: 'booking-1:linen_worker', assigned_role: 'linen_worker', status: 'pending', completion_event_id: null },
      { id: 'consumables', booking_id: 'booking-1', task_key: 'booking-1:consumables', assigned_role: 'consumables', status: 'pending', completion_event_id: null },
      { id: 'inspection', booking_id: 'booking-1', task_key: 'booking-1:inspector', assigned_role: 'inspector', status: 'pending', completion_event_id: null },
      { id: 'checkout', booking_id: 'booking-1', task_key: 'booking-1:checkout:inspector', assigned_role: 'inspector', status: 'pending', completion_event_id: null },
    ];
    for (const type of ['cleaner.task_completed', 'linen.task_completed', 'consumables.task_completed', 'inspection.completed', 'checkout.inspection_completed']) {
      await convergeLifecycleEvent(event(type, `${type}:event`), initialLifecycleState(), now);
    }
    expect(tasks).toEqual(tasks.map((task) => expect.objectContaining({ status: 'completed', completed_at: now, completion_event_id: expect.any(String) })));
  });
});
