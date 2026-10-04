import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireOpsAdminSession: vi.fn(),
  requireBookingOpsRouteAccess: vi.fn(),
  bootstrapBookingLifecycle: vi.fn(),
  getBookingLifecycleSummary: vi.fn(),
  requireBookingOpsRecordScope: vi.fn(),
  recordBookingOpsEvent: vi.fn(),
}));

vi.mock('@/lib/crm/api-auth', () => ({ requireOpsAdminSession: mocks.requireOpsAdminSession }));
vi.mock('@/lib/booking-ops/route-access', () => ({ requireBookingOpsRouteAccess: mocks.requireBookingOpsRouteAccess }));
vi.mock('@/lib/booking-ops/lifecycle-autopilot-service', () => ({
  bootstrapBookingLifecycle: mocks.bootstrapBookingLifecycle,
  getBookingLifecycleSummary: mocks.getBookingLifecycleSummary,
}));
vi.mock('@/lib/booking-ops/repository', () => ({ requireBookingOpsRecordScope: mocks.requireBookingOpsRecordScope }));
vi.mock('@/lib/booking-ops/events', () => ({ recordBookingOpsEvent: mocks.recordBookingOpsEvent }));

import { POST } from '../route';

describe('admin booking lifecycle bootstrap scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireOpsAdminSession.mockResolvedValue({ session: { userId: 'user-1' } });
    mocks.requireBookingOpsRouteAccess.mockResolvedValue({
      accountId: 'account-a', actorId: 'actor-a', bookingId: 'booking-1', propertyId: 'property-1',
    });
    mocks.bootstrapBookingLifecycle.mockResolvedValue({ eventId: 'event-1', processed: true, duplicate: false });
    mocks.requireBookingOpsRecordScope.mockResolvedValue({});
    mocks.recordBookingOpsEvent.mockResolvedValue({ ok: true });
    mocks.getBookingLifecycleSummary.mockResolvedValue({ stage: 'booking_received' });
  });
  it('propagates canonical account and property scope through bootstrap, audit and summary', async () => {
    const response = await POST(new Request('https://example.test', {
      method: 'POST',
      body: JSON.stringify({ bookingOpsRecordId: 'booking-1' }),
      headers: { 'content-type': 'application/json' },
    }));

    expect(response.status).toBe(200);
    expect(mocks.requireBookingOpsRouteAccess).toHaveBeenCalledWith({ userId: 'user-1' }, 'booking-1');
    const expectedScope = { accountId: 'account-a', propertyId: 'property-1' };
    expect(mocks.bootstrapBookingLifecycle).toHaveBeenCalledWith({
      bookingId: 'booking-1', objectId: 'property-1', actorId: 'actor-a',
    }, expectedScope);
    expect(mocks.requireBookingOpsRecordScope).toHaveBeenCalledWith('booking-1', expectedScope);
    expect(mocks.recordBookingOpsEvent).toHaveBeenCalledWith(expect.objectContaining({
      bookingOpsRecordId: 'booking-1',
      dedupeKey: 'ops-v16-bootstrap:booking-1',
    }));
    expect(mocks.getBookingLifecycleSummary).toHaveBeenCalledWith('booking-1', expectedScope);
  });

  it('fails closed before bootstrap when canonical route access is rejected', async () => {
    mocks.requireBookingOpsRouteAccess.mockRejectedValueOnce(new Error('booking_scope_mismatch'));

    const response = await POST(new Request('https://example.test', {
      method: 'POST',
      body: JSON.stringify({ bookingOpsRecordId: 'booking-1' }),
      headers: { 'content-type': 'application/json' },
    }));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ ok: false, message: 'booking_scope_mismatch' });
    expect(mocks.bootstrapBookingLifecycle).not.toHaveBeenCalled();
    expect(mocks.recordBookingOpsEvent).not.toHaveBeenCalled();
  });
  it('rejects an empty booking id before any scope lookup', async () => {
    const request = new Request('https://example.test', {
      method: 'POST',
      body: JSON.stringify({ bookingOpsRecordId: '' }),
      headers: { 'content-type': 'application/json' },
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
    expect(mocks.requireBookingOpsRouteAccess).not.toHaveBeenCalled();
  });
// end bootstrap route tests
});
