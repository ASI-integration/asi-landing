import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  scope: vi.fn(),
  apply: vi.fn(),
}));

vi.mock('@/lib/crm/api-auth', () => ({
  requireOpsAdminSession: vi.fn(async () => ({
    session: { userId: 'admin-1', email: 'admin@asi.test' },
  })),
}));

vi.mock('@/lib/reservations/access', () => ({
  resolveReservationAccess: vi.fn(async () => ({
    accountId: 'account-1',
    actorId: 'admin-1',
    operatorRole: 'owner',
    isOpsAdmin: true,
  })),
}));

vi.mock('@/lib/platform/residential-booking-scope', () => ({
  resolveResidentialBookingIdentity: mocks.scope,
}));

vi.mock('@/lib/booking-ops/action-templates', () => ({
  applyBookingOpsOperatorAction: mocks.apply,
}));
describe('Booking Ops confirm-action tenant scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.scope.mockResolvedValue({
      kind: 'identified',
      accountId: 'account-1',
      propertyId: 'property-1',
      bookingId: 'ops-route',
    });
    mocks.apply.mockResolvedValue({
      ok: true,
      record: { id: 'ops-route', opsStatus: 'documents_requested' },
    });
  });

  it('checks account/property ownership before applying the mutation', async () => {
    const route = await import('../[id]/confirm-action/route');
    const response = await route.POST(new Request('https://asi.test', {
      method: 'POST',
      body: JSON.stringify({ actionId: 'request_guest_documents' }),
    }), { params: { id: 'ops-route' } });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.scope).toHaveBeenCalledWith('ops-route', 'account-1');
    expect(mocks.apply).toHaveBeenCalledWith('ops-route', 'request_guest_documents');
    expect(payload.ok).toBe(true);
  });
  it('rejects a foreign tenant before the legacy action engine can mutate', async () => {
    mocks.scope.mockRejectedValueOnce(new Error('booking_scope_mismatch'));

    const route = await import('../[id]/confirm-action/route');
    const response = await route.POST(new Request('https://asi.test', {
      method: 'POST',
      body: JSON.stringify({ actionId: 'request_guest_documents' }),
    }), { params: { id: 'ops-route' } });
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.message).toBe('Нет доступа к бронированию.');
    expect(mocks.apply).not.toHaveBeenCalled();
  });

  it('fails closed on unresolved booking scope before mutation', async () => {
    mocks.scope.mockRejectedValueOnce(new Error('booking_scope_unavailable'));

    const route = await import('../[id]/confirm-action/route');
    const response = await route.POST(new Request('https://asi.test', {
      method: 'POST',
      body: JSON.stringify({ actionId: 'request_guest_documents' }),
    }), { params: { id: 'ops-route' } });

    expect(response.status).toBe(409);
    expect(mocks.apply).not.toHaveBeenCalled();
  });
});
