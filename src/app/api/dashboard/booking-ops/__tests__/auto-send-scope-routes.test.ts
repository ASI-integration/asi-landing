import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  scopeAccess: vi.fn(),
  accountAccess: vi.fn(),
  setScope: vi.fn(),
  status: vi.fn(),
}));

vi.mock('@/lib/crm/api-auth', () => ({
  requireOpsAdminSession: vi.fn(async () => ({
    session: { userId: 'admin-1', email: 'admin@asi.test' },
  })),
}));

vi.mock('../access', () => ({
  requireBookingOpsApiAutoSendScopeAccess: mocks.scopeAccess,
  requireBookingOpsApiAccount: mocks.accountAccess,
}));

vi.mock('@/lib/booking-ops/communication-auto-send-scopes', () => ({
  AUTO_SEND_SCOPE_TYPES: ['global', 'owner', 'property', 'booking', 'pilot'],
  setAutoSendScope: mocks.setScope,
  getAutoSendOperationalStatus: mocks.status,
}));

describe('account-scoped auto-send scope routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.scopeAccess.mockResolvedValue({
      ok: true,
      accountId: 'account-1',
      actorId: 'admin-1',
      scopeType: 'booking',
      scopeRef: 'booking-1',
    });
    mocks.accountAccess.mockResolvedValue({
      ok: true,
      accountId: 'account-1',
      actorId: 'admin-1',
    });
    mocks.setScope.mockResolvedValue({
      ok: true,
      scope: {
        accountId: 'account-1',
        scopeType: 'booking',
        scopeRef: 'booking-1',
      },
    });
    mocks.status.mockResolvedValue({
      globalActualSendEnabled: false,
      emergencyStop: false,
      scopes: [],
      lastRun: null,
      counts: { queued: 0, sent: 0, failed: 0 },
    });
  });

  it('binds booking-scope enable to the authenticated account', async () => {
    const route = await import(
      '../communications/auto-send/scope/enable/route'
    );
    const response = await route.POST(new Request('https://asi.test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scopeType: 'booking',
        scopeRef: 'booking-1',
        dryRunOnly: true,
      }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.scopeAccess).toHaveBeenCalledWith(
      { userId: 'admin-1', email: 'admin@asi.test' },
      'booking',
      'booking-1',
    );
    expect(mocks.setScope).toHaveBeenCalledWith(expect.objectContaining({
      accountId: 'account-1',
      scopeType: 'booking',
      scopeRef: 'booking-1',
      enabled: true,
    }));
  });

  it('fails owner/pilot scope changes when canonical account ownership is unavailable', async () => {
    mocks.scopeAccess.mockResolvedValueOnce({
      ok: false,
      response: Response.json(
        { ok: false, message: 'scope_not_account_bound' },
        { status: 409 },
      ),
    });
    const route = await import(
      '../communications/auto-send/scope/enable/route'
    );
    const response = await route.POST(new Request('https://asi.test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scopeType: 'owner',
        scopeRef: 'owner-legacy',
      }),
    }));

    expect(response.status).toBe(409);
    expect(mocks.setScope).not.toHaveBeenCalled();
  });

  it('reads operational status only for the authenticated account', async () => {
    const route = await import(
      '../communications/auto-send/scope/status/route'
    );
    const response = await route.GET();

    expect(response.status).toBe(200);
    expect(mocks.status).toHaveBeenCalledWith('account-1');
  });
});
