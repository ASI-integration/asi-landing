import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/crm/api-auth', () => ({ requireOpsAdminSession: vi.fn() }));
vi.mock('@/lib/reservations/access', () => ({ resolveReservationAccess: vi.fn() }));
vi.mock('@/lib/booking-ops/golden-path-acceptance', () => ({ runGoldenPathAcceptance: vi.fn() }));

import { requireOpsAdminSession } from '@/lib/crm/api-auth';
import { resolveReservationAccess } from '@/lib/reservations/access';
import { runGoldenPathAcceptance } from '@/lib/booking-ops/golden-path-acceptance';
import { POST } from '../route';

const request = (body: Record<string, unknown>) => new Request('http://localhost/api/admin/booking-ops-golden-path-acceptance', { method: 'POST', body: JSON.stringify(body) });

describe('golden-path acceptance admin API', () => {
  beforeEach(() => {
    vi.resetAllMocks(); delete process.env.OPS_GOLDEN_PATH_ACCEPTANCE_ENABLED;
    vi.mocked(requireOpsAdminSession).mockResolvedValue({ session: { userId: 'actor-1', email: 'admin@example.test' } } as never);
    vi.mocked(resolveReservationAccess).mockResolvedValue({ accountId: 'account-1', actorId: 'actor-1', operatorRole: 'admin', isOpsAdmin: true });
    vi.mocked(runGoldenPathAcceptance).mockResolvedValue({ overall: 'PLANNED' } as never);
  });

  it('rejects non-admin access before resolving an account', async () => {
    vi.mocked(requireOpsAdminSession).mockResolvedValue({ error: Response.json({ ok: false }, { status: 403 }) } as never);
    expect((await POST(request({ bookingOpsRecordId: 'x' }))).status).toBe(403);
    expect(resolveReservationAccess).not.toHaveBeenCalled();
  });

  it('defaults to dry-run and does not require the feature flag', async () => {
    await POST(request({ asiReference: 'ASI-100002' }));
    expect(runGoldenPathAcceptance).toHaveBeenCalledWith(expect.objectContaining({ identifier: 'ASI-100002', accountId: 'account-1', dryRun: true, confirm: false, featureEnabled: false }));
  });

  it('passes explicit confirmation and the enabled feature flag', async () => {
    process.env.OPS_GOLDEN_PATH_ACCEPTANCE_ENABLED = 'true';
    await POST(request({ bookingOpsRecordId: 'record-1', dryRun: false, confirm: true }));
    expect(runGoldenPathAcceptance).toHaveBeenCalledWith(expect.objectContaining({ dryRun: false, confirm: true, featureEnabled: true }));
  });

  it.each(['reservation_account_mismatch', 'reservation_account_not_found'])('rejects invalid account scope: %s', async (message) => {
    vi.mocked(runGoldenPathAcceptance).mockRejectedValue(new Error(message));
    expect((await POST(request({ bookingOpsRecordId: 'record-1' }))).status).toBe(403);
  });
});
