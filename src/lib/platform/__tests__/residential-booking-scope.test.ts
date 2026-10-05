import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = {
  row: { id: 'booking-1', account_id: 'account-1', property_id: 'property-1' } as Record<string, unknown> | null,
  error: null as { message: string } | null,
};

const maybeSingle = vi.fn(async () => ({ data: state.row, error: state.error }));
const eq = vi.fn(() => ({ maybeSingle }));
const select = vi.fn(() => ({ eq }));
const from = vi.fn(() => ({ select }));

vi.mock('@/lib/supabase', () => ({ supabase: { from } }));

describe('resolveResidentialBookingIdentity', () => {
  beforeEach(() => {
    state.row = { id: 'booking-1', account_id: 'account-1', property_id: 'property-1' };
    state.error = null;
    vi.clearAllMocks();
  });

  it('derives identity only from the canonical booking row', async () => {
    const { resolveResidentialBookingIdentity } = await import('../residential-booking-scope');
    await expect(resolveResidentialBookingIdentity('booking-1', 'account-1')).resolves.toEqual({
      kind: 'identified', accountId: 'account-1', propertyId: 'property-1', bookingId: 'booking-1',
    });
    expect(from).toHaveBeenCalledWith('booking_ops_records');
    expect(select).toHaveBeenCalledWith('id, account_id, property_id');
  });

  it('fails closed for a foreign authenticated account', async () => {
    const { resolveResidentialBookingIdentity } = await import('../residential-booking-scope');
    await expect(resolveResidentialBookingIdentity('booking-1', 'account-2'))
      .rejects.toThrow('booking_scope_mismatch');
  });

  it.each([
    { id: 'booking-1', account_id: null, property_id: 'property-1' },
    { id: 'booking-1', account_id: 'account-1', property_id: null },
    { id: 'other-booking', account_id: 'account-1', property_id: 'property-1' },
    { id: 'booking-1', account_id: 'account with spaces', property_id: 'property-1' },
  ])('fails closed for incomplete or invalid canonical scope', async (row) => {
    state.row = row;
    const { resolveResidentialBookingIdentity } = await import('../residential-booking-scope');
    await expect(resolveResidentialBookingIdentity('booking-1', 'account-1'))
      .rejects.toThrow('booking_scope_unavailable');
  });

  it('maps provider failures to a stable scope error', async () => {
    state.error = { message: 'raw provider detail that must not escape' };
    const { resolveResidentialBookingIdentity } = await import('../residential-booking-scope');
    await expect(resolveResidentialBookingIdentity('booking-1', 'account-1'))
      .rejects.toThrow('booking_scope_unavailable');
  });
});
