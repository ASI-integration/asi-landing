import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const insert = vi.fn();
  const from = vi.fn(() => {
    const query: Record<string, unknown> = {};
    query.select = vi.fn(() => query);
    query.eq = vi.fn(() => query);
    query.in = vi.fn(() => query);
    query.maybeSingle = vi.fn(async () => ({ data: null, error: null }));
    query.insert = insert;
    return query;
  });
  return {
    from,
    insert,
    requireScope: vi.fn(),
  };
});

vi.mock('@/lib/supabase', () => ({
  supabase: { from: mocks.from },
}));

vi.mock('../repository', () => ({
  requireBookingOpsRecordScope: mocks.requireScope,
}));

import { createOperatorMissingDataRequestDraft } from '../communication-orchestrator';

const expectedScope = { accountId: 'account-a', propertyId: 'property-a' };
const input = {
  bookingOpsRecordId: 'booking-a',
  bookingId: 'reservation-a',
  alertId: 'alert-a',
  reason: 'guest_data' as const,
  actorId: 'operator-a',
};

describe('operator missing-data draft canonical scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireScope.mockResolvedValue({ id: 'booking-a' });
  });

  it('fails closed before reading communication state when canonical ownership mismatches', async () => {
    mocks.requireScope.mockRejectedValueOnce(new Error('booking_scope_mismatch'));

    await expect(createOperatorMissingDataRequestDraft(input, expectedScope))
      .rejects.toThrow('booking_scope_mismatch');

    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('revalidates ownership after the active-draft read and before insert', async () => {
    mocks.requireScope
      .mockResolvedValueOnce({ id: 'booking-a' })
      .mockRejectedValueOnce(new Error('booking_scope_mismatch'));

    await expect(createOperatorMissingDataRequestDraft(input, expectedScope))
      .rejects.toThrow('booking_scope_mismatch');

    expect(mocks.from).toHaveBeenCalledTimes(1);
    expect(mocks.insert).not.toHaveBeenCalled();
  });
});
