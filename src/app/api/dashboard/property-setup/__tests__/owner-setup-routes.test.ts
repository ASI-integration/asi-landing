import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/crm/api-auth', () => ({
  requireCrmOperatorSession: vi.fn(async () => ({
    error: Response.json({ ok: false }, { status: 401 }),
  })),
  requireOpsAdminSession: vi.fn(async () => ({
    error: Response.json({ ok: false }, { status: 401 }),
  })),
}));

vi.mock('@/lib/booking-ops/owner-object-setup-autopilot', () => ({
  initializeOwnerSetupFromLead: vi.fn(),
  getOwnerSetupStatus: vi.fn(async () => ({ ownerSetup: null, propertySetups: [], communications: [], blockers: null })),
  listPropertySetups: vi.fn(async () => []),
  getPropertySetupById: vi.fn(),
  getOwnerObjectSetupBlockers: vi.fn(),
}));

describe('Owner setup dashboard API auth', () => {
  it('lead owner-setup GET returns 401 unauthenticated', async () => {
    const { GET } = await import('@/app/api/dashboard/leads/[leadId]/owner-setup/route');
    const res = await GET(new Request('http://localhost'), { params: { leadId: 'x' } });
    expect(res.status).toBe(401);
  });

  it('lead owner-setup initialize POST returns 401 unauthenticated', async () => {
    const { POST } = await import('@/app/api/dashboard/leads/[leadId]/owner-setup/initialize/route');
    const res = await POST(new Request('http://localhost', { method: 'POST' }), { params: { leadId: 'x' } });
    expect(res.status).toBe(401);
  });

  it('property-setup action POST returns 401 unauthenticated', async () => {
    const { POST } = await import('@/app/api/dashboard/property-setup/action/route');
    const res = await POST(new Request('http://localhost', { method: 'POST', body: '{}' }));
    expect(res.status).toBe(401);
  });

  it('property-setup status GET returns 401 unauthenticated', async () => {
    const { GET } = await import('@/app/api/dashboard/property-setup/status/route');
    const res = await GET(new Request('http://localhost'));
    expect(res.status).toBe(401);
  });

  it('property-setup list GET returns 401 unauthenticated', async () => {
    const { GET } = await import('@/app/api/dashboard/property-setup/list/route');
    const res = await GET(new Request('http://localhost'));
    expect(res.status).toBe(401);
  });
});
