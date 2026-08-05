import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireDevelopmentOwnerSession,
  runChannelManagerLiveCoreAcceptance,
  cleanupLiveCoreAcceptanceHarness,
  probeChannelLiveCoreSchema,
} = vi.hoisted(() => ({
  requireDevelopmentOwnerSession: vi.fn(),
  runChannelManagerLiveCoreAcceptance: vi.fn(),
  cleanupLiveCoreAcceptanceHarness: vi.fn(),
  probeChannelLiveCoreSchema: vi.fn(),
}));

vi.mock('@/lib/development/api-auth', () => ({ requireDevelopmentOwnerSession }));
vi.mock('@/lib/booking-ops/channel-manager-live-core-acceptance', () => ({
  runChannelManagerLiveCoreAcceptance,
  cleanupLiveCoreAcceptanceHarness,
  describeLiveCoreAcceptanceUnavailable: () => 'schema blocker',
}));
vi.mock('@/lib/booking-ops/channel-manager-live-core', () => ({
  probeChannelLiveCoreSchema,
}));

import { GET, POST } from '../route';

function request(body: Record<string, unknown>) {
  return new Request('http://localhost/api/dashboard/channel-manager/live-core-acceptance', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('live-core-acceptance route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireDevelopmentOwnerSession.mockResolvedValue({ session: { email: 'owner@asi-global.ru', userId: 'u1' } });
    probeChannelLiveCoreSchema.mockResolvedValue({ ready: true, blocker: null });
    runChannelManagerLiveCoreAcceptance.mockResolvedValue({
      passed: true,
      schemaReady: true,
      steps: [],
      blocker: null,
    });
    cleanupLiveCoreAcceptanceHarness.mockResolvedValue({
      ok: true,
      deleted: { bookingOpsRecords: 1, connections: 1, propertySetups: 1, ownerSetups: 1, communicationIntents: 0 },
      preservedOrdinaryData: true,
    });
  });

  it('rejects ordinary users without development-owner access', async () => {
    requireDevelopmentOwnerSession.mockResolvedValue({
      error: Response.json({ ok: false, message: 'Нет доступа к консоли разработки ASI.' }, { status: 403 }),
    });
    const response = await POST(request({ action: 'run' }));
    expect(response.status).toBe(403);
    expect(runChannelManagerLiveCoreAcceptance).not.toHaveBeenCalled();
    expect(cleanupLiveCoreAcceptanceHarness).not.toHaveBeenCalled();
  });

  it('rejects ordinary users on GET status probe', async () => {
    requireDevelopmentOwnerSession.mockResolvedValue({
      error: Response.json({ ok: false, message: 'Нет доступа к консоли разработки ASI.' }, { status: 403 }),
    });
    const response = await GET();
    expect(response.status).toBe(403);
    expect(probeChannelLiveCoreSchema).not.toHaveBeenCalled();
  });

  it('runs acceptance for development owner', async () => {
    const response = await POST(request({ action: 'run' }));
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.evidence.passed).toBe(true);
    expect(runChannelManagerLiveCoreAcceptance).toHaveBeenCalledOnce();
  });

  it('requires explicit confirmation for cleanup', async () => {
    const response = await POST(request({ action: 'cleanup' }));
    const payload = await response.json();
    expect(response.status).toBe(400);
    expect(payload.ok).toBe(false);
    expect(cleanupLiveCoreAcceptanceHarness).not.toHaveBeenCalled();
  });

  it('cleans up harness after explicit confirmation', async () => {
    const response = await POST(request({ action: 'cleanup', confirm: true }));
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(cleanupLiveCoreAcceptanceHarness).toHaveBeenCalledOnce();
  });
});
