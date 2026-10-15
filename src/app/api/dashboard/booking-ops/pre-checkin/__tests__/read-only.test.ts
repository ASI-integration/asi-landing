import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ read: vi.fn(), recompute: vi.fn(), identity: vi.fn(), same: vi.fn() }));
vi.mock('@/lib/crm/api-auth', () => ({ requireCrmOperatorSession: async () => ({ session: { userId: 'operator' } }) }));
vi.mock('@/lib/reservations/access', () => ({ resolveReservationAccess: async () => ({ accountId: 'account' }) }));
vi.mock('@/lib/platform/residential-booking-scope', () => ({ resolveResidentialBookingIdentity: mocks.identity }));
vi.mock('@/lib/platform/decision', () => ({ sameIdentity: mocks.same }));
vi.mock('@/lib/platform/ops-decision', () => ({ adaptResidentialOpsDecision: () => ({ status: 'synthetic-projection' }) }));
vi.mock('@/lib/booking-ops/pre-checkin-control-center', () => ({ readPreCheckinStatus: mocks.read, getPreCheckinStatus: mocks.recompute, listBookingsByReadinessStatus: vi.fn(), PRE_CHECKIN_READINESS_STATUSES: [] }));
import { GET } from '../route';
beforeEach(() => {
  vi.clearAllMocks();
  mocks.identity.mockResolvedValue({ kind: 'identified', accountId: 'account', propertyId: 'property', bookingId: 'booking' });
  mocks.same.mockReturnValue(true);
  mocks.read.mockResolvedValue({ lastRecomputedAt: '2026-10-15T00:00:00Z' });
  mocks.recompute.mockResolvedValue({ lastRecomputedAt: '2026-10-15T01:00:00Z' });
});
const request = () => new Request('http://localhost/api/dashboard/booking-ops/pre-checkin?bookingId=booking');
describe('operator pre-checkin GET', () => {
  it('reads persisted readiness without running mutations or refreshing evidence age', async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect((await response.json()).readiness.lastRecomputedAt).toBe('2026-10-15T00:00:00Z');
    expect(mocks.recompute).not.toHaveBeenCalled();
  });
  it('rejects a changed booking identity after the read', async () => {
    mocks.same.mockReturnValue(false);
    expect((await GET(request())).status).toBe(409);
    expect(mocks.recompute).not.toHaveBeenCalled();
  });
  it('reports unavailable persisted evidence without generating fresh evidence', async () => {
    mocks.read.mockRejectedValue(new Error('precheckin_readiness_unavailable'));
    expect((await GET(request())).status).toBe(503);
    expect(mocks.recompute).not.toHaveBeenCalled();
  });
});
