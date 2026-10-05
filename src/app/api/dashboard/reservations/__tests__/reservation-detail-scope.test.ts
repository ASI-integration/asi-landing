import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireOpsAdminSession: vi.fn(),
  requireBookingOpsApiAccess: vi.fn(),
  requireBookingOpsApiPropertyAccess: vi.fn(),
  updateBookingOpsRecord: vi.fn(),
  getUnifiedAvailability: vi.fn(),
  auditReservationMutation: vi.fn(),
  supabaseFrom: vi.fn(),
}));

vi.mock('@/lib/crm/api-auth', () => ({
  requireCrmOperatorSession: vi.fn(),
  requireOpsAdminSession: mocks.requireOpsAdminSession,
}));
vi.mock('@/app/api/dashboard/booking-ops/access', () => ({
  requireBookingOpsApiAccess: mocks.requireBookingOpsApiAccess,
  requireBookingOpsApiPropertyAccess: mocks.requireBookingOpsApiPropertyAccess,
}));
vi.mock('@/lib/booking-ops/repository', () => ({
  updateBookingOpsRecord: mocks.updateBookingOpsRecord,
}));
vi.mock('@/lib/reservations/ledger', () => ({
  getUnifiedAvailability: mocks.getUnifiedAvailability,
  auditReservationMutation: mocks.auditReservationMutation,
}));
vi.mock('@/lib/supabase', () => ({
  supabase: { from: (...args: unknown[]) => mocks.supabaseFrom(...args) },
}));

import { PATCH } from '../[id]/route';

const session = { userId: 'operator-1', email: 'operator@asi.test' };
const currentAccess = {
  ok: true as const,
  accountId: 'account-1',
  actorId: 'operator-1',
  bookingId: 'booking-1',
  propertyId: 'property-old',
};

function request(body: Record<string, unknown>) {
  return new Request('http://localhost/api/dashboard/reservations/booking-1', {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

function context() {
  return { params: Promise.resolve({ id: 'booking-1' }) };
}

function scopedQuery(row: Record<string, unknown> | null) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(async () => ({ data: row, error: null })),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  return query;
}

describe('reservation detail PATCH canonical scope transfer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireOpsAdminSession.mockResolvedValue({ session });
    mocks.requireBookingOpsApiAccess.mockResolvedValue(currentAccess);
    mocks.requireBookingOpsApiPropertyAccess.mockResolvedValue({
      ok: true,
      accountId: 'account-1',
      actorId: 'operator-1',
      propertyId: 'property-new',
    });
    mocks.getUnifiedAvailability.mockResolvedValue({ available: true, conflicts: [] });
    mocks.updateBookingOpsRecord.mockResolvedValue({
      ok: true,
      record: { id: 'booking-1', propertyId: 'property-new' },
    });
    mocks.auditReservationMutation.mockResolvedValue(undefined);
    mocks.supabaseFrom.mockImplementation(() => scopedQuery({
      id: 'booking-1',
      property_id: 'property-old',
      unit_id: 'unit-old',
      check_in_at: '2026-10-10T00:00:00.000Z',
      check_out_at: '2026-10-12T00:00:00.000Z',
      guest_count: 2,
      payment_status: 'pending',
      deposit_status: 'not_required',
      notes: null,
    }));
  });

  it('authorizes the old booking scope and target property before a transfer', async () => {
    const response = await PATCH(
      request({ propertyId: 'property-new', unitId: 'unit-new', guestName: 'Guest' }),
      context(),
    );

    expect(response.status).toBe(200);
    expect(mocks.requireBookingOpsApiAccess).toHaveBeenCalledWith(session, 'booking-1');
    expect(mocks.requireBookingOpsApiPropertyAccess).toHaveBeenCalledWith(session, 'property-new');
    expect(mocks.getUnifiedAvailability).toHaveBeenCalledWith(expect.objectContaining({
      accountId: 'account-1',
      propertyId: 'property-new',
      unitId: 'unit-new',
      excludeReservationId: 'booking-1',
    }));
    expect(mocks.updateBookingOpsRecord).toHaveBeenCalledWith(
      'booking-1',
      expect.objectContaining({
        propertyId: 'property-new',
        unitId: 'unit-new',
        guestName: 'Guest',
      }),
      {
        actorType: 'admin',
        expectedScope: { accountId: 'account-1', propertyId: 'property-old' },
        resultScope: { accountId: 'account-1', propertyId: 'property-new' },
      },
    );
  });

  it('clears the old unit when property changes without an explicit target unit', async () => {
    const response = await PATCH(
      request({ propertyId: 'property-new' }),
      context(),
    );

    expect(response.status).toBe(200);
    expect(mocks.getUnifiedAvailability).toHaveBeenCalledWith(expect.objectContaining({
      propertyId: 'property-new',
      unitId: null,
    }));
    expect(mocks.updateBookingOpsRecord).toHaveBeenCalledWith(
      'booking-1',
      expect.objectContaining({ propertyId: 'property-new', unitId: null }),
      expect.any(Object),
    );
  });

  it('fails closed before mutation when the target property is not authorized', async () => {
    mocks.requireBookingOpsApiPropertyAccess.mockResolvedValueOnce({
      ok: false,
      response: new Response('forbidden', { status: 403 }),
    });

    const response = await PATCH(
      request({ propertyId: 'foreign-property', unitId: 'foreign-unit' }),
      context(),
    );

    expect(response.status).toBe(403);
    expect(mocks.getUnifiedAvailability).not.toHaveBeenCalled();
    expect(mocks.updateBookingOpsRecord).not.toHaveBeenCalled();
    expect(mocks.auditReservationMutation).not.toHaveBeenCalled();
  });

  it('fails closed when the old booking scope changes before the guarded update', async () => {
    mocks.updateBookingOpsRecord.mockResolvedValueOnce({ ok: false, error: 'scope_mismatch' });

    const response = await PATCH(
      request({ propertyId: 'property-new' }),
      context(),
    );

    expect(response.status).toBe(409);
    expect(mocks.auditReservationMutation).not.toHaveBeenCalled();
  });

  it('keeps ordinary same-property mutations on the existing canonical scope', async () => {
    mocks.updateBookingOpsRecord.mockResolvedValueOnce({
      ok: true,
      record: { id: 'booking-1', propertyId: 'property-old' },
    });

    const response = await PATCH(
      request({ guestCount: 3 }),
      context(),
    );

    expect(response.status).toBe(200);
    expect(mocks.requireBookingOpsApiPropertyAccess).not.toHaveBeenCalled();
    expect(mocks.getUnifiedAvailability).not.toHaveBeenCalled();
    expect(mocks.updateBookingOpsRecord).toHaveBeenCalledWith(
      'booking-1',
      expect.objectContaining({ guestCount: 3 }),
      {
        actorType: 'admin',
        expectedScope: { accountId: 'account-1', propertyId: 'property-old' },
        resultScope: { accountId: 'account-1', propertyId: 'property-old' },
      },
    );
  });
});
