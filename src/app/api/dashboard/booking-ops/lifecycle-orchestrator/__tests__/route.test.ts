import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
import * as auth from '@/lib/crm/api-auth';

vi.mock('@/lib/crm/api-auth', () => ({ requireCrmOperatorSession: vi.fn(), requireOpsAdminSession: vi.fn() }));
vi.mock('@/lib/booking-ops/lifecycle-orchestrator', () => ({
  applyBookingLifecycleManualOverride: vi.fn(), forceBookingLifecycleEscalation: vi.fn(),
  getBookingLifecycleOrchestratorSnapshot: vi.fn(), orchestrateBookingLifecycle: vi.fn(), orchestrateDueBookingLifecycles: vi.fn(),
}));

import { GET, POST } from '../route';
import { POST as POST_DUE } from '../due/route';

const unauthorized = () => NextResponse.json({ ok: false }, { status: 401 });

describe('Booking Lifecycle Orchestrator protected API', () => {
  beforeEach(() => vi.clearAllMocks());

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
});
