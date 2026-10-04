import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireScope: vi.fn(),
  event: vi.fn(),
  audit: vi.fn(),
  eventId: vi.fn((...parts: string[]) => parts.join(':')),
}));

const database = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  const state = {
    record: { id: 'booking-1', account_id: 'account-a', property_id: 'property-1' } as Row | null,
    link: { id: 'link-1', task_id: 'task-1', actor_type: 'cleaner', expires_at: '2099-01-01T00:00:00.000Z', revoked_at: null } as Row,
    task: { id: 'task-1', booking_id: 'booking-1', object_id: 'property-1', task_key: 'booking-1:cleaner', assigned_role: 'cleaner', status: 'pending', checklist: [], notes: null, photo_attachments: [] } as Row,
    lastWorkerUpdateFilters: {} as Record<string, unknown>,
  };

  class Query {
    private mode: 'select' | 'update' = 'select';
    private patch: Row = {};
    private filters: Record<string, unknown> = {};
    constructor(private table: string) {}
    select() { return this; }
    update(patch: Row) { this.mode = 'update'; this.patch = patch; return this; }
    eq(key: string, value: unknown) { this.filters[key] = value; return this; }
    private result() {
      if (this.table === 'booking_ops_secure_task_links') {
        return this.mode === 'update' ? { data: null, error: null } : { data: { ...state.link }, error: null };
      }
      if (this.table === 'booking_ops_records') return { data: state.record ? { ...state.record } : null, error: null };
      if (this.table === 'booking_ops_worker_tasks') {
        if (this.mode === 'select') return { data: { ...state.task }, error: null };
        state.lastWorkerUpdateFilters = { ...this.filters };
        const matches = Object.entries(this.filters).every(([key, value]) => state.task[key] === value);
        if (!matches) return { data: null, error: null };
        Object.assign(state.task, this.patch);
        return { data: { ...state.task }, error: null };
      }
      return { data: null, error: null };
    }
    async maybeSingle() { return this.result(); }
    async single() { return this.result(); }
    then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
      return Promise.resolve(this.result()).then(resolve, reject);
    }
  }
  return { state, supabase: { from: (table: string) => new Query(table) } };
});

vi.mock('@/lib/supabase', () => ({ supabase: database.supabase }));
vi.mock('@/lib/booking-ops/repository', () => ({ requireBookingOpsRecordScope: mocks.requireScope }));
vi.mock('@/lib/booking-ops/lifecycle-autopilot-service', () => ({
  durableEventId: mocks.eventId,
  recordAndProcessBookingEvent: mocks.event,
}));
vi.mock('@/lib/booking-ops/secure-worker-links', () => ({ auditWorkerLinkAction: mocks.audit }));

import { PATCH, workerCompletionEventType } from '../route';

describe('secure worker workspace completion events', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    database.state.record = { id: 'booking-1', account_id: 'account-a', property_id: 'property-1' };
    database.state.link = { id: 'link-1', task_id: 'task-1', actor_type: 'cleaner', expires_at: '2099-01-01T00:00:00.000Z', revoked_at: null };
    database.state.task = { id: 'task-1', booking_id: 'booking-1', object_id: 'property-1', task_key: 'booking-1:cleaner', assigned_role: 'cleaner', status: 'pending', checklist: [], notes: null, photo_attachments: [] };
    database.state.lastWorkerUpdateFilters = {};
    mocks.requireScope.mockResolvedValue({});
    mocks.event.mockResolvedValue({ processed: true, duplicate: false });
    mocks.audit.mockResolvedValue(undefined);
  });

  it('emits inspection.completed for the normal inspector task', () => {
    expect(workerCompletionEventType('inspector', 'booking-1:inspector')).toBe('inspection.completed');
  });

  it('emits checkout.inspection_completed for the checkout inspector task', () => {
    expect(workerCompletionEventType('inspector', 'booking-1:checkout:inspector')).toBe('checkout.inspection_completed');
  });

  it('guards account-bound task mutation and lifecycle event with canonical scope', async () => {
    const response = await PATCH(
      new NextRequest('https://example.test', {
        method: 'PATCH',
        body: JSON.stringify({ action: 'complete' }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: { token: 'worker-token' } },
    );

    expect(response.status).toBe(200);
    const expectedScope = { accountId: 'account-a', propertyId: 'property-1' };
    expect(database.state.lastWorkerUpdateFilters).toMatchObject({
      id: 'task-1', booking_id: 'booking-1', object_id: 'property-1',
    });
    expect(mocks.event).toHaveBeenCalledWith(expect.objectContaining({
      bookingId: 'booking-1',
      objectId: 'property-1',
      type: 'cleaner.task_completed',
    }), expectedScope);
    expect(mocks.requireScope).toHaveBeenCalledWith('booking-1', expectedScope);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      bookingId: 'booking-1', taskId: 'task-1', action: 'completed',
    }));
  });

  it('fails closed before worker mutation when canonical scope revalidation rejects', async () => {
    mocks.requireScope.mockRejectedValueOnce(new Error('booking_scope_mismatch'));

    await expect(PATCH(
      new NextRequest('https://example.test', {
        method: 'PATCH',
        body: JSON.stringify({ action: 'complete' }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: { token: 'worker-token' } },
    )).rejects.toThrow('booking_scope_mismatch');

    expect(database.state.task.status).toBe('pending');
    expect(mocks.event).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it('preserves legacy task-link behavior without canonical expected scope', async () => {
    database.state.record = { id: 'booking-1', account_id: 'legacy', property_id: null };

    const response = await PATCH(
      new NextRequest('https://example.test', {
        method: 'PATCH',
        body: JSON.stringify({ action: 'start' }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: { token: 'worker-token' } },
    );

    expect(response.status).toBe(200);
    expect(mocks.requireScope).not.toHaveBeenCalled();
    expect(mocks.event).toHaveBeenCalledWith(expect.objectContaining({
      bookingId: 'booking-1',
      type: 'cleaner.task_started',
    }), undefined);
  });

  it('rejects an account-bound task whose object no longer matches the canonical property', async () => {
    database.state.task.object_id = 'property-b';

    await expect(PATCH(
      new NextRequest('https://example.test', {
        method: 'PATCH',
        body: JSON.stringify({ action: 'complete' }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: { token: 'worker-token' } },
    )).rejects.toThrow('booking_scope_mismatch');

    expect(database.state.task.status).toBe('pending');
    expect(mocks.event).not.toHaveBeenCalled();
  });
});
