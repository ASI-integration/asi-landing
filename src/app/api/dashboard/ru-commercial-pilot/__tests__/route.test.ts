import { beforeEach, describe, expect, it, vi } from 'vitest';

const getPilotLifecycle = vi.fn();
const deriveReady = vi.fn();
const startPilot = vi.fn();
const hasCurrentRuLegalAcceptance = vi.fn();

vi.mock('@/lib/crm/api-auth', () => ({
  requireCrmOperatorSession: vi.fn(async () => ({ session: { email: 'ops@example.com' } })),
  requireOpsAdminSession: vi.fn(async () => ({ session: { email: 'ops@example.com' } })),
}));
vi.mock('@/lib/crm/access', () => ({ isOpsAdminEmail: vi.fn(() => true) }));
vi.mock('@/lib/ru-legal', () => ({
  LEGAL_ACCEPTANCE_REQUIRED_CODE: 'RU_LEGAL_ACCEPTANCE_REQUIRED',
  hasCurrentRuLegalAcceptance,
}));
vi.mock('@/lib/ru-commercial-pilot', () => ({
  beginSetup: vi.fn(),
  completePilot: vi.fn(),
  createSupabaseRuCommercialPilotStore: vi.fn(() => ({})),
  deriveReady,
  ensureApplication: vi.fn(),
  getPilotLifecycle,
  startPilot,
  supabaseOwnsProperty: vi.fn(),
  supabaseReadinessProbe: vi.fn(),
}));
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => {
      const query: any = {
        select: () => query,
        eq: (key: string, value: unknown) => { query._eq = { ...(query._eq ?? {}), [key]: value }; return query; },
        maybeSingle: async () => query._eq?.id === 'property-404'
          ? { data: null, error: null }
          : { data: { account_id: 'account-A' }, error: null },
      };
      return query;
    }),
  },
}));

beforeEach(() => {
  vi.resetModules();
  getPilotLifecycle.mockReset();
  deriveReady.mockReset();
  startPilot.mockReset();
  hasCurrentRuLegalAcceptance.mockReset();
  hasCurrentRuLegalAcceptance.mockResolvedValue(true);
  getPilotLifecycle.mockResolvedValue({ ok: true, state: null });
  deriveReady.mockResolvedValue({ ok: true, changed: true, state: { accountId: 'account-A', propertyId: 'property-A', status: 'ready', timestamps: {} } });
  startPilot.mockResolvedValue({ ok: true, changed: true, state: { accountId: 'account-A', propertyId: 'property-A', status: 'pilot_active', timestamps: {} } });
});

describe('/api/dashboard/ru-commercial-pilot', () => {
  it('derives canonical account from property for operator reads', async () => {
    const { GET } = await import('../route');
    const res = await GET(new Request('http://local/api/dashboard/ru-commercial-pilot?propertyId=property-A'));
    expect(res.status).toBe(200);
    expect(getPilotLifecycle).toHaveBeenCalledWith(expect.anything(), 'account-A', 'property-A');
    const body = await res.json();
    expect(body.canManage).toBe(true);
  });

  it('rejects a forged account/property mismatch', async () => {
    const { POST } = await import('../route');
    const res = await POST(new Request('http://local/api/dashboard/ru-commercial-pilot', {
      method: 'POST',
      body: JSON.stringify({ action: 'derive_ready', propertyId: 'property-A', accountId: 'account-B' }),
    }));
    expect(res.status).toBe(409);
    expect(deriveReady).not.toHaveBeenCalled();
  });

  it('starts the canonical pilot without accepting a client account id', async () => {
    const { POST } = await import('../route');
    const res = await POST(new Request('http://local/api/dashboard/ru-commercial-pilot', {
      method: 'POST',
      body: JSON.stringify({ action: 'start_pilot', propertyId: 'property-A' }),
    }));
    expect(res.status).toBe(200);
    expect(startPilot).toHaveBeenCalledWith(expect.anything(), 'account-A', 'property-A');
  });

  it('fails closed when the property cannot be resolved', async () => {
    const { POST } = await import('../route');
    const res = await POST(new Request('http://local/api/dashboard/ru-commercial-pilot', {
      method: 'POST',
      body: JSON.stringify({ action: 'start_pilot', propertyId: 'property-404' }),
    }));
    expect(res.status).toBe(404);
    expect(startPilot).not.toHaveBeenCalled();
  });
});
