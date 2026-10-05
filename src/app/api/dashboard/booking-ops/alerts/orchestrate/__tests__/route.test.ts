import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireOpsAdminSession: vi.fn(),
  requireAccount: vi.fn(),
  requireBookingAccess: vi.fn(),
  requirePropertyAccess: vi.fn(),
  orchestrateBooking: vi.fn(),
  orchestrateProperty: vi.fn(),
  orchestrateAll: vi.fn(),
}));

vi.mock('@/lib/crm/api-auth', () => ({ requireOpsAdminSession: mocks.requireOpsAdminSession }));
vi.mock('../../../access', () => ({
  requireBookingOpsApiAccount: mocks.requireAccount,
  requireBookingOpsApiAccess: mocks.requireBookingAccess,
  requireBookingOpsApiPropertyAccess: mocks.requirePropertyAccess,
}));
vi.mock('@/lib/booking-ops/ops-alert-orchestrator', () => ({
  orchestrateBookingAutomationAndAlertsForBooking: mocks.orchestrateBooking,
  orchestrateOpsAlertsForProperty: mocks.orchestrateProperty,
  orchestrateAllRelevantOpsAlerts: mocks.orchestrateAll,
}));

import { POST } from '../route';

const BOOKING_ID = '11111111-1111-4111-8111-111111111111';
const summary = { evaluated: 1, alertsCreated: 0, alertsUpdated: 0, alertsEscalated: 0, alertsResolved: 0, skipped: 0, unchanged: 1, errors: [] };

function request(body: Record<string, unknown>) {
  return new Request('http://localhost/api/dashboard/booking-ops/alerts/orchestrate', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
}

describe('targeted booking automation rollout route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    mocks.requireOpsAdminSession.mockResolvedValue({ session: { email: 'ops@asi.test' } });
    mocks.requireAccount.mockResolvedValue({ ok: true, accountId: 'account-1' });
    mocks.requireBookingAccess.mockResolvedValue({
      ok: true,
      accountId: 'account-1',
      propertyId: 'property-1',
      bookingId: BOOKING_ID,
    });
    mocks.requirePropertyAccess.mockResolvedValue({ ok: true, accountId: 'account-1', propertyId: 'property-1' });
    mocks.orchestrateBooking.mockResolvedValue(summary);
    mocks.orchestrateProperty.mockResolvedValue(summary);
    mocks.orchestrateAll.mockResolvedValue(summary);
  });

  it('makes dryRun win over executeAutomation and performs preview-only orchestration', async () => {
    vi.stubEnv('BOOKING_OPS_AUTOMATION_MODE', 'active');
    const response = await POST(request({ bookingId: BOOKING_ID, dryRun: true, executeAutomation: true }));
    expect(response.status).toBe(200);
    expect(mocks.orchestrateBooking).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true, executeAutomation: false, reconcileLegacyInPreview: false }));
  });

  it('rejects targeted execution in shadow mode', async () => {
    vi.stubEnv('BOOKING_OPS_AUTOMATION_MODE', 'shadow');
    const response = await POST(request({ bookingId: BOOKING_ID, executeAutomation: true }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ ok: false, rollout: { mode: 'shadow', executionAllowed: false }, result: { errors: ['automation_execution_disabled'] } });
    expect(mocks.orchestrateBooking).not.toHaveBeenCalled();
  });

  it('rejects a non-allowlisted canary booking', async () => {
    vi.stubEnv('BOOKING_OPS_AUTOMATION_MODE', 'canary');
    vi.stubEnv('BOOKING_OPS_AUTOMATION_CANARY_BOOKING_IDS', 'other');
    const response = await POST(request({ bookingId: BOOKING_ID, executeAutomation: true }));
    expect(response.status).toBe(409);
    expect(mocks.orchestrateBooking).not.toHaveBeenCalled();
  });

  it('allows an exact canary booking and reports the match', async () => {
    vi.stubEnv('BOOKING_OPS_AUTOMATION_MODE', 'canary');
    vi.stubEnv('BOOKING_OPS_AUTOMATION_CANARY_BOOKING_IDS', BOOKING_ID);
    const response = await POST(request({ bookingId: BOOKING_ID, executeAutomation: true }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ rollout: { mode: 'canary', executionAllowed: true, canaryMatched: true } });
    expect(mocks.orchestrateBooking).toHaveBeenCalledWith(expect.objectContaining({ executeAutomation: true }));
  });

  it('pins targeted booking orchestration to the canonical booking property', async () => {
    vi.stubEnv('BOOKING_OPS_AUTOMATION_MODE', 'active');
    await POST(request({ bookingId: BOOKING_ID, accountId: 'attacker-account', propertyId: 'attacker-property', executeAutomation: true }));
    expect(mocks.requireBookingAccess).toHaveBeenCalledWith(expect.any(Object), BOOKING_ID);
    expect(mocks.orchestrateBooking).toHaveBeenCalledWith(expect.objectContaining({
      expectedAccountId: 'account-1',
      expectedPropertyId: 'property-1',
    }));
    expect(mocks.orchestrateBooking).not.toHaveBeenCalledWith(expect.objectContaining({ expectedAccountId: 'attacker-account' }));
  });

  it('rejects a targeted booking before orchestration when canonical route access fails', async () => {
    vi.stubEnv('BOOKING_OPS_AUTOMATION_MODE', 'active');
    mocks.requireBookingAccess.mockResolvedValueOnce({
      ok: false,
      response: new Response('forbidden', { status: 403 }),
    });
    const response = await POST(request({ bookingId: BOOKING_ID, executeAutomation: true }));
    expect(response.status).toBe(403);
    expect(mocks.orchestrateBooking).not.toHaveBeenCalled();
  });

  it('validates a property-targeted run through canonical property access', async () => {
    vi.stubEnv('BOOKING_OPS_AUTOMATION_MODE', 'active');
    await POST(request({ propertyId: 'property-1', dryRun: true }));
    expect(mocks.requirePropertyAccess).toHaveBeenCalledWith(expect.any(Object), 'property-1');
    expect(mocks.orchestrateProperty).toHaveBeenCalledWith(
      'property-1',
      undefined,
      'account-1',
      expect.objectContaining({ dryRun: true }),
    );
  });

  it('keeps execution restricted to an Ops Admin session', async () => {
    mocks.requireOpsAdminSession.mockResolvedValue({ error: new Response('forbidden', { status: 403 }) });
    const response = await POST(request({ bookingId: BOOKING_ID, executeAutomation: true }));
    expect(response.status).toBe(403);
    expect(mocks.orchestrateBooking).not.toHaveBeenCalled();
  });
});
