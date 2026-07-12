import { beforeEach, describe, expect, it, vi } from 'vitest';
const requireCrmOperatorSession = vi.fn(); const requireOpsAdminSession = vi.fn(); const activatePilot = vi.fn(); const bootstrapPilot = vi.fn(); const createVerificationIssue = vi.fn();
vi.mock('@/lib/crm/api-auth', () => ({ requireCrmOperatorSession, requireOpsAdminSession }));
vi.mock('@/lib/ops-v17/service', () => ({ activatePilot, bootstrapPilot, createVerificationIssue }));
describe('OPS v17 protected actions', () => {
  beforeEach(() => { vi.resetAllMocks(); requireOpsAdminSession.mockResolvedValue({ error: new Response('forbidden', { status: 403 }) }); });
  it('requires an ops admin to activate a pilot', async () => { const { POST } = await import('../action/route'); const response = await POST(new Request('http://local', { method: 'POST', body: JSON.stringify({ action: 'activate' }) })); expect(response.status).toBe(403); expect(activatePilot).not.toHaveBeenCalled(); });
  it('keeps the existing detailed Booking Ops dashboard route untouched', async () => { const source = await import('@/app/dashboard/booking-ops/page'); expect(source.default).toBeTypeOf('function'); });
});
