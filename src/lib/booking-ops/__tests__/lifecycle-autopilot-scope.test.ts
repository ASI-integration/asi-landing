import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireScope: vi.fn(),
  from: vi.fn(),
}));

vi.mock('../repository', () => ({
  requireBookingOpsRecordScope: mocks.requireScope,
}));

vi.mock('@/lib/supabase', () => ({
  supabase: { from: mocks.from },
}));

import {
  getBookingLifecycleSummary,
  recordAndProcessBookingEvent,
} from '../lifecycle-autopilot-service';

const expectedScope = { accountId: 'account-a', propertyId: 'property-a' };
const eventRow = {
  id: 'event-a',
  booking_id: 'booking-a',
  object_id: 'property-a',
  event_type: 'manual.override',
  actor_type: 'operator',
  actor_id: 'ops@asi.test',
  payload: {},
  source: 'test',
  correlation_id: 'correlation-a',
  causation_id: null,
  created_at: '2026-10-03T17:00:00.000Z',
};

function queryFor(table: string) {
  const result = table === 'booking_ops_autopilot_states'
    ? { data: null, error: null }
    : table === 'booking_ops_domain_events'
      ? { data: [], error: null, count: 0 }
      : { data: [], error: null, count: 0 };
  const query: Record<string, unknown> = {};
  query.select = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  query.not = vi.fn(() => query);
  query.order = vi.fn(() => query);
  query.limit = vi.fn(() => query);
  query.insert = vi.fn(async () => ({ data: null, error: null }));
  query.update = vi.fn(() => query);
  query.upsert = vi.fn(async () => ({ data: null, error: null }));
  query.single = vi.fn(async () => ({ data: eventRow, error: null }));
  query.maybeSingle = vi.fn(async () => result);
  query.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return query;
}

describe('lifecycle autopilot canonical scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireScope.mockResolvedValue({ id: 'booking-a' });
    mocks.from.mockImplementation((table: string) => queryFor(table));
  });

  it('rejects a scoped event before persistence when canonical ownership mismatches', async () => {
    mocks.requireScope.mockRejectedValueOnce(new Error('booking_scope_mismatch'));
    await expect(recordAndProcessBookingEvent({
      id: 'event-a',
      bookingId: 'booking-a',
      objectId: 'property-a',
      type: 'manual.override',
      actorType: 'operator',
      source: 'test',
    }, expectedScope)).rejects.toThrow('booking_scope_mismatch');
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('stops event processing when ownership changes after event insertion', async () => {
    mocks.requireScope
      .mockResolvedValueOnce({ id: 'booking-a' })
      .mockRejectedValueOnce(new Error('booking_scope_mismatch'));

    await expect(recordAndProcessBookingEvent({
      id: 'event-a',
      bookingId: 'booking-a',
      objectId: 'property-a',
      type: 'manual.override',
      actorType: 'operator',
      source: 'test',
    }, expectedScope)).rejects.toThrow('booking_scope_mismatch');

    expect(mocks.from).toHaveBeenCalledTimes(2);
    expect(mocks.from.mock.calls.map(([table]) => table)).toEqual([
      'booking_ops_domain_events',
      'booking_ops_domain_events',
    ]);
  });

  it('revalidates lifecycle summary ownership after asynchronous reads', async () => {
    mocks.requireScope
      .mockResolvedValueOnce({ id: 'booking-a' })
      .mockRejectedValueOnce(new Error('booking_scope_mismatch'));

    await expect(getBookingLifecycleSummary('booking-a', expectedScope))
      .rejects.toThrow('booking_scope_mismatch');

    expect(mocks.requireScope).toHaveBeenNthCalledWith(1, 'booking-a', expectedScope);
    expect(mocks.requireScope).toHaveBeenNthCalledWith(2, 'booking-a', expectedScope);
  });
});
