import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  apply: vi.fn(),
  requireAccess: vi.fn(),
}));

vi.mock('@/lib/crm/api-auth', () => ({
  requireOpsAdminSession: vi.fn(async () => ({
    session: { userId: 'admin-1', email: 'admin@asi.test' },
  })),
}));

vi.mock('../access', () => ({
  requireBookingOpsApiAccess: mocks.requireAccess,
}));

vi.mock('@/lib/booking-ops/action-templates', () => ({
  applyBookingOpsOperatorAction: mocks.apply,
}));

describe('Booking Ops confirm-action tenant scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAccess.mockResolvedValue({
      ok: true,
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
    expect(mocks.requireAccess).toHaveBeenCalledWith(expect.any(Object), 'ops-route');
    expect(mocks.apply).toHaveBeenCalledWith('ops-route', 'request_guest_documents', {
      expectedScope: { accountId: 'account-1', propertyId: 'property-1' },
    });
    expect(payload.ok).toBe(true);
  });
  it('rejects a foreign tenant before the legacy action engine can mutate', async () => {
    mocks.requireAccess.mockResolvedValueOnce({
      ok: false,
      response: new Response(JSON.stringify({ ok: false, message: 'Нет доступа к бронированию.' }), { status: 403 }),
    });

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

  it('fails closed if ownership changes between route authorization and domain mutation', async () => {
    mocks.apply.mockResolvedValueOnce({ ok: false, error: 'scope_mismatch' });

    const route = await import('../[id]/confirm-action/route');
    const response = await route.POST(new Request('https://asi.test', {
      method: 'POST',
      body: JSON.stringify({ actionId: 'request_guest_documents' }),
    }), { params: { id: 'ops-route' } });

    expect(response.status).toBe(409);
    expect(mocks.apply).toHaveBeenCalledWith('ops-route', 'request_guest_documents', {
      expectedScope: { accountId: 'account-1', propertyId: 'property-1' },
    });
  });

  it('fails closed on unresolved booking scope before mutation', async () => {
    mocks.requireAccess.mockResolvedValueOnce({
      ok: false,
      response: new Response(JSON.stringify({ ok: false, message: 'Не удалось подтвердить область бронирования.' }), { status: 409 }),
    });

    const route = await import('../[id]/confirm-action/route');
    const response = await route.POST(new Request('https://asi.test', {
      method: 'POST',
      body: JSON.stringify({ actionId: 'request_guest_documents' }),
    }), { params: { id: 'ops-route' } });

    expect(response.status).toBe(409);
    expect(mocks.apply).not.toHaveBeenCalled();
  });
});
