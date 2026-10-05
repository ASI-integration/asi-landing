import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireOpsAdminSession: vi.fn(),
  requireBookingOpsApiAccount: vi.fn(),
  requireBookingOpsApiAccess: vi.fn(),
  requireBookingOpsApiPropertyAccess: vi.fn(),
  cancelReservation: vi.fn(),
  createAvailabilityBlock: vi.fn(),
  createDirectReservation: vi.fn(),
  getUnifiedAvailability: vi.fn(),
}));

vi.mock('@/lib/crm/api-auth', () => ({
  requireCrmOperatorSession: vi.fn(),
  requireOpsAdminSession: mocks.requireOpsAdminSession,
}));
vi.mock('@/app/api/dashboard/booking-ops/access', () => ({
  requireBookingOpsApiAccount: mocks.requireBookingOpsApiAccount,
  requireBookingOpsApiAccess: mocks.requireBookingOpsApiAccess,
  requireBookingOpsApiPropertyAccess: mocks.requireBookingOpsApiPropertyAccess,
}));
vi.mock('@/lib/reservations/ledger', () => ({
  cancelReservation: mocks.cancelReservation,
  createAvailabilityBlock: mocks.createAvailabilityBlock,
  createDirectReservation: mocks.createDirectReservation,
  getUnifiedAvailability: mocks.getUnifiedAvailability,
}));
vi.mock('@/lib/reservations/access', () => ({ resolveReservationAccess: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: vi.fn() } }));

import { POST } from '../route';

const session = { userId: 'operator-1', email: 'operator@asi.test' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireOpsAdminSession.mockResolvedValue({ session });
  mocks.requireBookingOpsApiAccount.mockResolvedValue({
    ok: true, accountId: 'account-1', actorId: 'operator-1',
  });
  mocks.requireBookingOpsApiPropertyAccess.mockResolvedValue({
    ok: true, accountId: 'account-1', actorId: 'operator-1', propertyId: 'property-1',
  });
  mocks.requireBookingOpsApiAccess.mockResolvedValue({
    ok: true, accountId: 'account-1', actorId: 'operator-1', bookingId: 'booking-1', propertyId: 'property-1',
  });
  mocks.createDirectReservation.mockResolvedValue({ blocked: false, reservationId: 'booking-1' });
  mocks.cancelReservation.mockResolvedValue({ changed: true });
});

function request(body: Record<string, unknown>) {
  return new Request('http://localhost/api/dashboard/reservations', {
    method: 'POST', body: JSON.stringify(body),
  });
}

describe('reservation route canonical access', () => {
  it('binds create to the authenticated account and canonical property', async () => {
    const res = await POST(request({
      action: 'create', idempotencyKey: 'retry-1', propertyId: 'property-1',
      checkIn: '2026-10-10', checkOut: '2026-10-12', guestName: 'Guest', guestCount: 1,
    }));

    expect(res.status).toBe(200);
    expect(mocks.requireBookingOpsApiPropertyAccess).toHaveBeenCalledWith(session, 'property-1');
    expect(mocks.createDirectReservation).toHaveBeenCalledWith(expect.objectContaining({
      accountId: 'account-1', actorId: 'operator-1', propertyId: 'property-1',
    }));
  });

  it('checks canonical booking ownership before cancellation', async () => {
    const res = await POST(request({ action: 'cancel', reservationId: 'booking-1' }));

    expect(res.status).toBe(200);
    expect(mocks.requireBookingOpsApiAccess).toHaveBeenCalledWith(session, 'booking-1');
    expect(mocks.cancelReservation).toHaveBeenCalledWith(expect.objectContaining({
      accountId: 'account-1', reservationId: 'booking-1', actorId: 'operator-1',
    }));
    expect(mocks.requireBookingOpsApiPropertyAccess).not.toHaveBeenCalled();
  });

  it('does not execute reservation creation when property access fails', async () => {
    mocks.requireBookingOpsApiPropertyAccess.mockResolvedValueOnce({
      ok: false, response: new Response('forbidden', { status: 403 }),
    });
    const res = await POST(request({ action: 'create', propertyId: 'foreign-property' }));

    expect(res.status).toBe(403);
    expect(mocks.createDirectReservation).not.toHaveBeenCalled();
  });
});
