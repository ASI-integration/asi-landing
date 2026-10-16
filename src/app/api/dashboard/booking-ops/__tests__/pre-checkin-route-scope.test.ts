import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ access: vi.fn(), identity: vi.fn(), read: vi.fn(), list: vi.fn() }));
vi.mock('@/lib/crm/api-auth', () => ({ requireCrmOperatorSession: vi.fn(async () => ({ session: { userId: 'operator' } })) }));
vi.mock('@/lib/reservations/access', () => ({ resolveReservationAccess: vi.fn(async () => ({ accountId: 'account-a' })) }));
vi.mock('../access', () => ({ requireBookingOpsApiAccess: mocks.access }));
vi.mock('@/lib/platform/residential-booking-scope', () => ({ resolveResidentialBookingIdentity: mocks.identity }));
vi.mock('@/lib/platform/ops-decision', () => ({ adaptResidentialOpsDecision: vi.fn(() => ({})) }));
vi.mock('@/lib/booking-ops/pre-checkin-control-center', () => ({
  readPreCheckinStatus: mocks.read, listBookingsByReadinessStatus: mocks.list,
  PRE_CHECKIN_READINESS_STATUSES: [],
}));
import { GET } from '../pre-checkin/route';
const identity = { kind: 'identified', accountId: 'account-a', propertyId: 'property-a', bookingId: 'canonical-booking' };
const request = () => new Request('https://asi.test/api/dashboard/booking-ops/pre-checkin?bookingId=request-booking');
describe('pre-check-in booking access', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.access.mockResolvedValue({ ok: true, ...identity });
    mocks.identity.mockResolvedValue(identity);
    mocks.read.mockResolvedValue({ lastRecomputedAt: '2026-10-16T00:00:00.000Z' });
  });
  it('denies before identity and readiness reads', async () => {
    mocks.access.mockResolvedValue({ ok: false, response: new Response('{}', { status: 403 }) });
    expect((await GET(request())).status).toBe(403);
    expect(mocks.identity).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it('uses the access helper canonical booking and property scope', async () => {
    expect((await GET(request())).status).toBe(200);
    expect(mocks.access).toHaveBeenCalledWith(expect.any(Object), 'request-booking');
    expect(mocks.read).toHaveBeenCalledWith('canonical-booking', { accountId: 'account-a', propertyId: 'property-a' });
    expect(mocks.identity).toHaveBeenCalledTimes(2);
    expect(mocks.identity).toHaveBeenCalledWith('canonical-booking', 'account-a');
  });
  it('withholds readiness if ownership changes during the read', async () => {
    mocks.identity.mockResolvedValueOnce(identity).mockResolvedValueOnce({ ...identity, propertyId: 'property-b' });
    const response = await GET(request());
    expect(response.status).toBe(409);
    expect(await response.json()).not.toHaveProperty('readiness');
  });
  it('propagates a scoped domain denial without returning readiness', async () => {
    mocks.read.mockRejectedValue(new Error('booking_scope_mismatch'));
    const response = await GET(request());
    expect(response.status).toBe(403);
    expect(await response.json()).not.toHaveProperty('readiness');
  });
});
