import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ requireCrmOperatorSession: vi.fn(), requireOpsAdminSession: vi.fn() }));
vi.mock('@/lib/crm/api-auth', () => auth);
vi.mock('@/lib/booking-ops/pilot-autorun-orchestrator', () => ({
  getPilotAutorunStatus: vi.fn(), explainPilotAutorun: vi.fn(), runPilotAutorunForLead: vi.fn(),
  runPilotAutorunForPropertySetup: vi.fn(), runPilotAutorunForBooking: vi.fn(), runPilotAutorunBatch: vi.fn(),
  createPilotAutorunFallbackIfNeeded: vi.fn(),
}));

describe('pilot autorun protected API', () => {
  beforeEach(() => {
    const error = new Response(JSON.stringify({ ok: false }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    auth.requireCrmOperatorSession.mockResolvedValue({ error }); auth.requireOpsAdminSession.mockResolvedValue({ error });
  });

  it('returns 401 for unauthenticated run', async () => {
    const { POST } = await import('../run/route');
    expect((await POST(new Request('http://localhost/api/dashboard/pilot-autorun/run', { method: 'POST' }))).status).toBe(401);
  });

  it('returns 401 for unauthenticated status', async () => {
    const { GET } = await import('../status/route');
    expect((await GET(new Request('http://localhost/api/dashboard/pilot-autorun/status'))).status).toBe(401);
  });

  it('returns 401 for unauthenticated explanation', async () => {
    const { GET } = await import('../explain/route');
    expect((await GET(new Request('http://localhost/api/dashboard/pilot-autorun/explain'))).status).toBe(401);
  });
});
