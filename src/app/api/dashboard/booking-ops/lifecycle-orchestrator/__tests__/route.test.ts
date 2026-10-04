import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
import * as auth from '@/lib/crm/api-auth';
import * as routeAccess from '../../access';
import * as orchestrator from '@/lib/booking-ops/lifecycle-orchestrator';

vi.mock('@/lib/crm/api-auth', () => ({ requireCrmOperatorSession: vi.fn(), requireOpsAdminSession: vi.fn() }));
vi.mock('../../access', () => ({
  requireBookingOpsApiAccess: vi.fn(async () => ({ ok: true, accountId: 'account-1', actorId: 'user-1', bookingId: '11111111-1111-4111-8111-111111111111', propertyId: 'property-1' })),
  requireBookingOpsApiAccount: vi.fn(async () => ({ ok: true, accountId: 'account-1', actorId: 'user-1' })),
}));
vi.mock('@/lib/booking-ops/lifecycle-orchestrator', () => ({
  applyBookingLifecycleManualOverride: vi.fn(), forceBookingLifecycleEscalation: vi.fn(),
  getBookingLifecycleOrchestratorSnapshot: vi.fn(), orchestrateBookingLifecycle: vi.fn(), orchestrateDueBookingLifecycles: vi.fn(),
}));

import { GET, POST } from '../route';
import { POST as POST_DUE } from '../due/route';

const unauthorized = () => NextResponse.json({ ok: false }, { status: 401 });

describe('Booking Lifecycle Orchestrator protected API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth.requireCrmOperatorSession).mockResolvedValue({ session: { userId: 'user-1', email: 'ops@asi.test' } } as never);
    vi.mocked(auth.requireOpsAdminSession).mockResolvedValue({ session: { userId: 'user-1', email: 'ops@asi.test' } } as never);
    vi.mocked(routeAccess.requireBookingOpsApiAccess).mockResolvedValue({ ok: true, accountId: 'account-1', actorId: 'user-1', bookingId: '11111111-1111-4111-8111-111111111111', propertyId: 'property-1' });
    vi.mocked(routeAccess.requireBookingOpsApiAccount).mockResolvedValue({ ok: true, accountId: 'account-1', actorId: 'user-1' });
  });

  it('returns 401 for an unauthorized state read', async () => {
    vi.mocked(auth.requireCrmOperatorSession).mockResolvedValue({ error: unauthorized() });
    const response = await GET(new Request('http://localhost/api/dashboard/booking-ops/lifecycle-orchestrator?bookingId=x'));
    expect(response.status).toBe(401);
  });

  it('returns 401 for an unauthorized single-booking run or override', async () => {
    vi.mocked(auth.requireOpsAdminSession).mockResolvedValue({ error: unauthorized() });
    const response = await POST(new Request('http://localhost/api/dashboard/booking-ops/lifecycle-orchestrator', { method: 'POST' }));
    expect(response.status).toBe(401);
  });

  it('returns 401 for an unauthorized due-bookings run', async () => {
    vi.mocked(auth.requireOpsAdminSession).mockResolvedValue({ error: unauthorized() });
    const response = await POST_DUE(new Request('http://localhost/api/dashboard/booking-ops/lifecycle-orchestrator/due', { method: 'POST' }));
    expect(response.status).toBe(401);
  });

  it('rejects a foreign booking before orchestrator reads or mutations', async () => {
    vi.mocked(routeAccess.requireBookingOpsApiAccess).mockResolvedValueOnce({
      ok: false,
      response: NextResponse.json({ ok: false }, { status: 403 }),
    });
    const response = await GET(new Request('http://localhost/api/dashboard/booking-ops/lifecycle-orchestrator?bookingId=foreign'));
    expect(response.status).toBe(403);
    expect(orchestrator.getBookingLifecycleOrchestratorSnapshot).not.toHaveBeenCalled();
  });

  it('passes canonical scope into single-booking reads and runs', async () => {
    vi.mocked(orchestrator.getBookingLifecycleOrchestratorSnapshot).mockResolvedValue({} as never);
    vi.mocked(orchestrator.orchestrateBookingLifecycle).mockResolvedValue({} as never);
    const read = await GET(new Request('http://localhost/api/dashboard/booking-ops/lifecycle-orchestrator?bookingId=11111111-1111-4111-8111-111111111111'));
    expect(read.status).toBe(200);
    expect(orchestrator.getBookingLifecycleOrchestratorSnapshot).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111', true,
      { accountId: 'account-1', propertyId: 'property-1' },
    );
    const run = await POST(new Request('http://localhost/api/dashboard/booking-ops/lifecycle-orchestrator', {
      method: 'POST', body: JSON.stringify({ bookingId: '11111111-1111-4111-8111-111111111111' }),
    }));
    expect(run.status).toBe(200);
    expect(orchestrator.orchestrateBookingLifecycle).toHaveBeenCalledWith({
      bookingId: '11111111-1111-4111-8111-111111111111', now: undefined,
      runType: 'manual_dashboard', actorId: 'ops@asi.test',
      expectedScope: { accountId: 'account-1', propertyId: 'property-1' },
    });
  });

  it('scopes the due-booking batch to the authenticated account', async () => {
    vi.mocked(orchestrator.orchestrateDueBookingLifecycles).mockResolvedValue({ processed: 0, succeeded: 0, failed: 0, results: [] });
    const response = await POST_DUE(new Request('http://localhost/api/dashboard/booking-ops/lifecycle-orchestrator/due', {
      method: 'POST',
      body: JSON.stringify({ limit: 12 }),
    }));
    expect(response.status).toBe(200);
    expect(orchestrator.orchestrateDueBookingLifecycles).toHaveBeenCalledWith({
      now: undefined,
      limit: 12,
      accountId: 'account-1',
    });
  });
});
