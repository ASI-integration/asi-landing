import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
import * as auth from '@/lib/crm/api-auth';

vi.mock('@/lib/crm/api-auth', () => ({
  requireCrmOperatorSession: vi.fn(),
  requireOpsAdminSession: vi.fn(),
}));
vi.mock('@/lib/booking-ops/physical-readiness-execution', () => ({
  approveFinalPhysicalReadiness: vi.fn(), createMaintenanceTicket: vi.fn(), createPhysicalCoordinationDraft: vi.fn(),
  ensurePhysicalTasks: vi.fn(), getPhysicalReadiness: vi.fn(), recomputePhysicalReadiness: vi.fn(),
  requirePhysicalReadinessBookingAccount: vi.fn(),
  updateCleaningTask: vi.fn(), updateLinenTask: vi.fn(), updateMaintenanceTicket: vi.fn(), updateSuppliesTask: vi.fn(),
}));

import { GET, POST } from '../route';

describe('physical readiness protected API', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 for an unauthorized GET', async () => {
    vi.mocked(auth.requireCrmOperatorSession).mockResolvedValue({
      error: NextResponse.json({ ok: false }, { status: 401 }),
    });
    const response = await GET(new Request('http://localhost/api/dashboard/booking-ops/physical-readiness?bookingId=x'));
    expect(response.status).toBe(401);
  });

  it('returns 401 for an unauthorized POST', async () => {
    vi.mocked(auth.requireOpsAdminSession).mockResolvedValue({
      error: NextResponse.json({ ok: false }, { status: 401 }),
    });
    const response = await POST(new Request('http://localhost/api/dashboard/booking-ops/physical-readiness', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'ensure_tasks', bookingId: 'x' }),
    }));
    expect(response.status).toBe(401);
  });
});
