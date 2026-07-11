import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/booking-ops/ops-alert-orchestrator', () => ({ orchestrateAllRelevantOpsAlerts: vi.fn() }));
vi.mock('@/lib/booking-ops/lifecycle-autopilot-service', () => ({ recoverUnprocessedBookingEvents: vi.fn() }));
import { orchestrateAllRelevantOpsAlerts } from '@/lib/booking-ops/ops-alert-orchestrator';
import { recoverUnprocessedBookingEvents } from '@/lib/booking-ops/lifecycle-autopilot-service';
import { POST } from '../route';

describe('scheduled OPS alert runner API', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.stubEnv('BOOKING_OPS_ALERT_RUNNER_SECRET', 'test-runner-secret'); });

  it('fails closed without a runner credential', async () => {
    const response = await POST(new Request('http://localhost/api/internal/booking-ops/alerts/run', { method: 'POST' }));
    expect(response.status).toBe(401);
    expect(orchestrateAllRelevantOpsAlerts).not.toHaveBeenCalled();
  });

  it('uses the shared full orchestration service with the scheduled trigger', async () => {
    vi.mocked(orchestrateAllRelevantOpsAlerts).mockResolvedValue({ runId: 'run-1', trigger: 'scheduled', lockAcquired: true, evaluated: 2, alertsCreated: 1, alertsUpdated: 0, alertsEscalated: 0, alertsResolved: 0, skipped: 0, unchanged: 1, errors: [] });
    vi.mocked(recoverUnprocessedBookingEvents).mockResolvedValue({ evaluated: 1, processed: 1, errors: [] });
    const response = await POST(new Request('http://localhost/api/internal/booking-ops/alerts/run', { method: 'POST', headers: { authorization: 'Bearer test-runner-secret' } }));
    expect(response.status).toBe(200);
    expect(orchestrateAllRelevantOpsAlerts).toHaveBeenCalledWith(expect.any(String), 'scheduled');
    expect(recoverUnprocessedBookingEvents).toHaveBeenCalledOnce();
  });

  it('reports a failed sweep without leaking credentials', async () => {
    vi.mocked(orchestrateAllRelevantOpsAlerts).mockResolvedValue({ lockAcquired: true, evaluated: 1, alertsCreated: 0, alertsUpdated: 0, alertsEscalated: 0, alertsResolved: 0, skipped: 0, unchanged: 0, errors: ['turnover_failed'] });
    vi.mocked(recoverUnprocessedBookingEvents).mockResolvedValue({ evaluated: 0, processed: 0, errors: [] });
    const response = await POST(new Request('http://localhost/api/internal/booking-ops/alerts/run', { method: 'POST', headers: { authorization: 'Bearer test-runner-secret' } }));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('test-runner-secret');
  });
});
