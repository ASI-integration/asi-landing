import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ requireCrmOperatorSession: vi.fn(), requireOpsAdminSession: vi.fn() }));
const access = vi.hoisted(() => ({ requireBookingOpsApiAccess: vi.fn(), requireBookingOpsApiAccount: vi.fn() }));
const pilot = vi.hoisted(() => ({
  getPilotAutorunStatus: vi.fn(), explainPilotAutorun: vi.fn(), runPilotAutorunForLead: vi.fn(),
  runPilotAutorunForPropertySetup: vi.fn(), runPilotAutorunForBooking: vi.fn(), runPilotAutorunBatch: vi.fn(),
  createPilotAutorunFallbackIfNeeded: vi.fn(),
}));
vi.mock('@/lib/crm/api-auth', () => auth);
vi.mock('../../booking-ops/access', () => access);
vi.mock('@/lib/booking-ops/pilot-autorun-orchestrator', () => pilot);

describe('pilot autorun protected API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it('authorizes booking runs and carries the authenticated account into autorun', async () => {
    auth.requireOpsAdminSession.mockResolvedValue({ session: { userId: 'user-1', email: 'ops@asi.test' } });
    access.requireBookingOpsApiAccess.mockResolvedValue({
      ok: true, accountId: 'account-1', actorId: 'user-1',
      bookingId: '11111111-1111-4111-8111-111111111111', propertyId: 'property-1',
    });
    pilot.runPilotAutorunForBooking.mockResolvedValue({});
    const { POST } = await import('../run/route');
    const response = await POST(new Request('http://localhost/api/dashboard/pilot-autorun/run', {
      method: 'POST', body: JSON.stringify({ scope: 'booking', ref: '11111111-1111-4111-8111-111111111111' }),
    }));
    expect(response.status).toBe(200);
    expect(access.requireBookingOpsApiAccess).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1' }), '11111111-1111-4111-8111-111111111111',
    );
    expect(pilot.runPilotAutorunForBooking).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111', expect.objectContaining({ accountId: 'account-1' }),
    );
  });

  it('scopes batch runs and batch status to the authenticated account', async () => {
    const session = { userId: 'user-1', email: 'ops@asi.test' };
    auth.requireOpsAdminSession.mockResolvedValue({ session });
    auth.requireCrmOperatorSession.mockResolvedValue({ session });
    access.requireBookingOpsApiAccount.mockResolvedValue({ ok: true, accountId: 'account-1', actorId: 'user-1' });
    pilot.runPilotAutorunBatch.mockResolvedValue({});
    pilot.getPilotAutorunStatus.mockResolvedValue(null);
    const { POST } = await import('../run/route');
    const run = await POST(new Request('http://localhost/api/dashboard/pilot-autorun/run', {
      method: 'POST', body: JSON.stringify({ scope: 'batch' }),
    }));
    expect(run.status).toBe(200);
    expect(pilot.runPilotAutorunBatch).toHaveBeenCalledWith(expect.objectContaining({ accountId: 'account-1' }));

    const { GET } = await import('../status/route');
    const status = await GET(new Request('http://localhost/api/dashboard/pilot-autorun/status?scope=batch&ref=batch%3Aaccount-1%3A2026-10-04'));
    expect(status.status).toBe(200);
    expect(pilot.getPilotAutorunStatus).toHaveBeenCalledWith({ scopeType: 'batch', scopeRef: 'batch:account-1:2026-10-04' });
    const denied = await GET(new Request('http://localhost/api/dashboard/pilot-autorun/status?scope=batch&ref=batch%3Aaccount-2%3A2026-10-04'));
    expect(denied.status).toBe(403);
  });
});
