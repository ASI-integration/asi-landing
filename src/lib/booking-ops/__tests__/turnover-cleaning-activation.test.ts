import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  previous: { id: '00000000-0000-4000-8000-000000000001', booking_id: 'source-1', account_id: 'account-a', property_id: 'property-a', check_out_at: '2026-07-13T10:00:00.000Z', normalized_status: 'checked_out', ops_status: 'in_stay' } as Record<string, unknown>,
  candidates: [] as Record<string, unknown>[],
  cleaning: { id: '00000000-0000-4000-8000-000000000099', booking_id: '00000000-0000-4000-8000-000000000002', status: 'pending', report_payload: {} } as Record<string, unknown>,
  cleaningUpdates: [] as Record<string, unknown>[],
  fallbackTask: null as null | { id: string },
  ensurePhysicalTasks: vi.fn(),
  createBookingOpsTask: vi.fn(),
  recordProcessedBookingAuditEvent: vi.fn(),
  requireBookingOpsRecordScope: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from(table: string) {
      let operation = 'select';
      let updatePayload: Record<string, unknown> | null = null;
      const filters: Record<string, unknown> = {};
      const query = {
        select() { operation = 'select'; return query; },
        update(payload: Record<string, unknown>) { operation = 'update'; updatePayload = payload; return query; },
        eq(column: string, value: unknown) { filters[column] = value; return query; },
        neq() { return query; }, gte() { return query; }, order() { return query; }, limit() { return query; },
        async maybeSingle() {
          if (table === 'booking_ops_records') {
            const matches = Object.entries(filters).every(([column, value]) => mocks.previous[column] === value);
            return { data: matches ? mocks.previous : null, error: null };
          }
          if (table === 'booking_cleaning_tasks') return { data: mocks.cleaning, error: null };
          return { data: null, error: null };
        },
        then(resolve: (value: unknown) => void) {
          if (operation === 'update' && table === 'booking_cleaning_tasks' && updatePayload) {
            mocks.cleaningUpdates.push(updatePayload);
            Object.assign(mocks.cleaning, updatePayload);
            resolve({ error: null });
            return;
          }
          resolve({ data: table === 'booking_ops_records' ? mocks.candidates : [], error: null });
        },
      };
      return query;
    },
  },
}));
vi.mock('../physical-readiness-execution', () => ({ ensurePhysicalTasks: mocks.ensurePhysicalTasks }));
vi.mock('../repository', () => ({ requireBookingOpsRecordScope: mocks.requireBookingOpsRecordScope }));
vi.mock('../tasks', () => ({ createBookingOpsTask: mocks.createBookingOpsTask }));
vi.mock('../lifecycle-autopilot-service', () => ({
  durableEventId: (...parts: string[]) => parts.join(':'),
  recordProcessedBookingAuditEvent: mocks.recordProcessedBookingAuditEvent,
}));

import { activateTurnoverCleaningAfterCheckout, selectEarliestEligibleUpcomingBooking } from '../turnover-cleaning-activation';

const candidate = (id: string, checkIn: string, account = 'account-a', property = 'property-a', status = 'confirmed') => ({
  id, account_id: account, property_id: property, check_in_at: checkIn, normalized_status: status, ops_status: 'created',
});

describe('checkout turnover cleaning activation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireBookingOpsRecordScope.mockImplementation(async () => ({}));
    mocks.candidates = [];
    mocks.cleaning = { id: '00000000-0000-4000-8000-000000000099', booking_id: '00000000-0000-4000-8000-000000000002', status: 'pending', report_payload: {} };
    mocks.cleaningUpdates = [];
    mocks.fallbackTask = null;
    mocks.createBookingOpsTask.mockImplementation(async () => {
      if (mocks.fallbackTask) return { ok: true, task: mocks.fallbackTask, created: false };
      mocks.fallbackTask = { id: 'fallback-1' };
      return { ok: true, task: mocks.fallbackTask, created: true };
    });
  });

  it('selects the earliest upcoming booking for the same account and property', () => {
    const selected = selectEarliestEligibleUpcomingBooking({ previousBookingId: 'previous', accountId: 'account-a', propertyId: 'property-a', boundary: '2026-07-13T10:00:00Z', candidates: [candidate('later', '2026-07-15T10:00:00Z'), candidate('earlier', '2026-07-14T10:00:00Z')] });
    expect(selected?.id).toBe('earlier');
  });

  it('never selects a booking from another account', () => {
    const selected = selectEarliestEligibleUpcomingBooking({ previousBookingId: 'previous', accountId: 'account-a', propertyId: 'property-a', boundary: '2026-07-13T10:00:00Z', candidates: [candidate('wrong', '2026-07-14T10:00:00Z', 'account-b')] });
    expect(selected).toBeNull();
  });

  it('ignores terminal upcoming bookings', () => {
    for (const status of ['cancelled', 'canceled', 'completed', 'closed', 'archived', 'inactive']) {
      const selected = selectEarliestEligibleUpcomingBooking({ previousBookingId: 'previous', accountId: 'account-a', propertyId: 'property-a', boundary: '2026-07-13T10:00:00Z', candidates: [candidate(status, '2026-07-14T10:00:00Z', 'account-a', 'property-a', status)] });
      expect(selected).toBeNull();
    }
  });

  it('fails closed before turnover work when canonical checkout scope changed', async () => {
    await expect(activateTurnoverCleaningAfterCheckout(
      String(mocks.previous.id),
      undefined,
      { expectedScope: { accountId: 'account-b', propertyId: 'property-a' } },
    )).rejects.toThrow('booking_scope_mismatch');

    expect(mocks.ensurePhysicalTasks).not.toHaveBeenCalled();
    expect(mocks.createBookingOpsTask).not.toHaveBeenCalled();
    expect(mocks.recordProcessedBookingAuditEvent).not.toHaveBeenCalled();
  });

  it('fails closed before next-booking physical work when its canonical scope changed', async () => {
    const nextId = '00000000-0000-4000-8000-000000000002';
    mocks.candidates = [candidate(nextId, '2026-07-14T10:00:00Z')];
    mocks.requireBookingOpsRecordScope.mockImplementation(async (bookingId: string) => {
      if (bookingId === nextId) throw new Error('booking_scope_mismatch');
      return {};
    });

    await expect(activateTurnoverCleaningAfterCheckout(String(mocks.previous.id))).rejects.toThrow('booking_scope_mismatch');
    expect(mocks.ensurePhysicalTasks).not.toHaveBeenCalled();
    expect(mocks.cleaningUpdates).toHaveLength(0);
    expect(mocks.recordProcessedBookingAuditEvent).not.toHaveBeenCalled();
  });

  it('ensures physical tasks and links exactly one cleaning row to the next booking', async () => {
    mocks.candidates = [candidate('00000000-0000-4000-8000-000000000002', '2026-07-14T10:00:00Z')];
    const result = await activateTurnoverCleaningAfterCheckout(String(mocks.previous.id));
    expect(result).toMatchObject({ kind: 'upcoming_booking', nextBookingId: mocks.candidates[0].id, cleaningTaskId: mocks.cleaning.id });
    expect(mocks.ensurePhysicalTasks).toHaveBeenCalledWith(mocks.candidates[0].id, { accountId: 'account-a', propertyId: 'property-a' });
    expect(mocks.cleaningUpdates).toHaveLength(1);
    expect(mocks.recordProcessedBookingAuditEvent).toHaveBeenCalledWith(expect.any(Object), { accountId: 'account-a', propertyId: 'property-a' });
  });

  it('repeated checkout processing creates no duplicate cleaning linkage or event id', async () => {
    mocks.candidates = [candidate('00000000-0000-4000-8000-000000000002', '2026-07-14T10:00:00Z')];
    await activateTurnoverCleaningAfterCheckout(String(mocks.previous.id));
    await activateTurnoverCleaningAfterCheckout(String(mocks.previous.id));
    expect(mocks.cleaningUpdates).toHaveLength(1);
    expect(mocks.recordProcessedBookingAuditEvent.mock.calls[0][0].id).toBe(mocks.recordProcessedBookingAuditEvent.mock.calls[1][0].id);
  });

  it('does not reset existing assigned or in-progress cleaning work', async () => {
    mocks.candidates = [candidate('00000000-0000-4000-8000-000000000002', '2026-07-14T10:00:00Z')];
    mocks.cleaning.status = 'in_progress';
    mocks.cleaning.assigned_to_name = 'Анна';
    await activateTurnoverCleaningAfterCheckout(String(mocks.previous.id));
    expect(mocks.cleaning.status).toBe('in_progress');
    expect(mocks.cleaning.assigned_to_name).toBe('Анна');
    expect(mocks.cleaningUpdates[0]).not.toHaveProperty('status');
  });

  it('creates once and then reuses the no-next-booking fallback task', async () => {
    const first = await activateTurnoverCleaningAfterCheckout(String(mocks.previous.id));
    const second = await activateTurnoverCleaningAfterCheckout(String(mocks.previous.id));
    expect(first).toMatchObject({ kind: 'fallback_task', taskId: 'fallback-1', created: true });
    expect(second).toMatchObject({ kind: 'fallback_task', taskId: 'fallback-1', created: false });
  });

  it('stores only safe identifiers and performs no external-provider call', async () => {
    mocks.candidates = [candidate('00000000-0000-4000-8000-000000000002', '2026-07-14T10:00:00Z')];
    await activateTurnoverCleaningAfterCheckout(String(mocks.previous.id));
    const serialized = JSON.stringify({ update: mocks.cleaningUpdates[0], event: mocks.recordProcessedBookingAuditEvent.mock.calls[0][0] });
    expect(serialized).not.toMatch(/guest|phone|email|telegram/i);
    expect(mocks.ensurePhysicalTasks).toHaveBeenCalledOnce();
    expect(mocks.createBookingOpsTask).not.toHaveBeenCalled();
  });
});
