import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  routeAccess: vi.fn(),
  intents: new Map<string, { booking_ops_record_id: string }>(),
  deliveries: new Map<string, { communication_intent_id: string }>(),
}));

function maybeSingleFor(table: string, id: string) {
  if (table === 'booking_ops_communication_intents') {
    return { data: state.intents.get(id) ?? null, error: null };
  }
  if (table === 'booking_ops_communication_deliveries') {
    return { data: state.deliveries.get(id) ?? null, error: null };
  }
  return { data: null, error: { message: 'unexpected_table' } };
}

vi.mock('@/lib/booking-ops/route-access', () => ({
  requireBookingOpsPropertyAccess: vi.fn(),
  resolveBookingOpsAccount: vi.fn(async () => ({ accountId: 'account-1', actorId: 'user-1' })),
  requireBookingOpsRouteAccess: state.routeAccess,
}));

vi.mock('@/lib/reservations/access', () => ({
  resolveReservationAccess: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn((table: string) => ({
      select: vi.fn(() => {
        let id = '';
        const query = {
          eq: vi.fn((field: string, value: unknown) => {
            if (field === 'id') id = String(value);
            return query;
          }),
          maybeSingle: vi.fn(async () => maybeSingleFor(table, id)),
        };
        return query;
      }),
    })),
  },
}));

describe('Booking Ops auto-send API access', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.intents.clear();
    state.deliveries.clear();
    state.routeAccess.mockResolvedValue({
      kind: 'identified',
      accountId: 'account-1',
      propertyId: 'property-1',
      bookingId: 'booking-1',
    });
  });

  it('resolves communication access through the canonical booking route scope', async () => {
    state.intents.set('communication-1', { booking_ops_record_id: 'booking-1' });
    const { requireBookingOpsApiCommunicationAccess } = await import('../access');

    const result = await requireBookingOpsApiCommunicationAccess(
      { userId: 'user-1', email: 'ops@asi.test' },
      'communication-1',
    );

    expect(result).toMatchObject({
      ok: true,
      communicationId: 'communication-1',
      accountId: 'account-1',
      propertyId: 'property-1',
      bookingId: 'booking-1',
    });
    expect(state.routeAccess).toHaveBeenCalledWith(
      { userId: 'user-1', email: 'ops@asi.test' },
      'booking-1',
    );
  });

  it('fails a foreign communication before any send operation can use it', async () => {
    state.intents.set('communication-1', { booking_ops_record_id: 'booking-1' });
    state.routeAccess.mockRejectedValueOnce(new Error('booking_scope_mismatch'));
    const { requireBookingOpsApiCommunicationAccess } = await import('../access');

    const result = await requireBookingOpsApiCommunicationAccess(
      { userId: 'user-1', email: 'ops@asi.test' },
      'communication-1',
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
  });

  it('resolves delivery ownership through delivery -> communication -> booking', async () => {
    state.deliveries.set('delivery-1', { communication_intent_id: 'communication-1' });
    state.intents.set('communication-1', { booking_ops_record_id: 'booking-1' });
    const { requireBookingOpsApiDeliveryAccess } = await import('../access');

    const result = await requireBookingOpsApiDeliveryAccess(
      { userId: 'user-1', email: 'ops@asi.test' },
      'delivery-1',
    );

    expect(result).toMatchObject({
      ok: true,
      deliveryId: 'delivery-1',
      communicationId: 'communication-1',
      bookingId: 'booking-1',
      accountId: 'account-1',
    });
  });

  it('fails a delivery whose booking belongs to another account', async () => {
    state.deliveries.set('delivery-1', { communication_intent_id: 'communication-1' });
    state.intents.set('communication-1', { booking_ops_record_id: 'booking-1' });
    state.routeAccess.mockRejectedValueOnce(new Error('booking_scope_mismatch'));
    const { requireBookingOpsApiDeliveryAccess } = await import('../access');

    const result = await requireBookingOpsApiDeliveryAccess(
      { userId: 'user-1', email: 'ops@asi.test' },
      'delivery-1',
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
  });
});
