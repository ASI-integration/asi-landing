import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireOpsAdminSession: vi.fn(),
  requireBookingOpsRouteAccess: vi.fn(),
  requireBookingOpsRecordScope: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock('@/lib/crm/api-auth', () => ({
  requireOpsAdminSession: mocks.requireOpsAdminSession,
}));
vi.mock('@/lib/booking-ops/route-access', () => ({
  requireBookingOpsRouteAccess: mocks.requireBookingOpsRouteAccess,
}));
vi.mock('@/lib/booking-ops/repository', () => ({
  requireBookingOpsRecordScope: mocks.requireBookingOpsRecordScope,
}));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: mocks.rpc } }));
import { POST } from '../route';

const PINNED = '5477f7dd-2d60-4a3d-9212-c74e8d36119e';
const APP = 'https://staging.example.test';
const body = () => ({
  bookingOpsRecordId: PINNED, confirm: true, noSend: true,
  acknowledgeSyntheticOnly: true,
});
const request = (payload: unknown = body(), origin = APP) => new Request(APP + '/api/admin/booking-ops-acceptance-fixture', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: origin },
  body: JSON.stringify(payload),
});

describe('owner-scoped staging acceptance fixture authorization', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    for (const [k, v] of Object.entries({
      NODE_ENV: 'production',
      ASI_DEPLOYMENT_TIER: 'staging',
      ASI_SYNTHETIC_NO_SEND: 'YES',
      EMAIL_AUTO_SEND: 'false',
      EMAIL_DRAFT_ONLY: 'true',
      DRY_RUN_TELEGRAM_OUTBOUND: 'true',
      ALLOW_REAL_TELEGRAM_SYNTHETIC: 'false',
      YOOKASSA_ENABLED: 'false',
      OPS_ACCEPTANCE_FIXTURE_MARKING_ENABLED: 'true',
      OPS_ACCEPTANCE_FIXTURE_RECORD_ID: PINNED,
      NEXT_PUBLIC_APP_URL: APP,
    })) vi.stubEnv(k, v);
    mocks.requireOpsAdminSession.mockResolvedValue({ session: { userId: 'actor-a' } });
    mocks.requireBookingOpsRouteAccess.mockResolvedValue({
      actorId: 'actor-a', accountId: 'tenant-a', propertyId: 'property-a',
      bookingId: PINNED,
    });
    mocks.requireBookingOpsRecordScope.mockResolvedValue({});
    mocks.rpc.mockResolvedValue({ data: true, error: null });
  });
  afterEach(() => vi.unstubAllEnvs());

  it('marks only the owner-pinned record and persists through atomic audited RPC', async () => {
    const result = await POST(request());
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ ok: true, acceptanceSafe: true, auditPersisted: true });
    expect(mocks.requireBookingOpsRouteAccess).toHaveBeenCalledWith({ userId: 'actor-a' }, PINNED);
    expect(mocks.requireBookingOpsRecordScope).toHaveBeenCalledWith(PINNED, {
      accountId: 'tenant-a', propertyId: 'property-a',
    });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('asi_mark_acceptance_fixture', {
      p_record_id: PINNED, p_account_id: 'tenant-a',
      p_property_id: 'property-a', p_actor_id: 'actor-a',
    });
  });
  it('denies unverified admin access before any record lookup', async () => {
    mocks.requireOpsAdminSession.mockResolvedValueOnce({ error: new Response('denied', { status: 403 }) });
    expect((await POST(request())).status).toBe(403);
    expect(mocks.requireBookingOpsRouteAccess).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(['ASI_DEPLOYMENT_TIER','ASI_SYNTHETIC_NO_SEND','EMAIL_AUTO_SEND','EMAIL_DRAFT_ONLY','DRY_RUN_TELEGRAM_OUTBOUND','ALLOW_REAL_TELEGRAM_SYNTHETIC','YOOKASSA_ENABLED','OPS_ACCEPTANCE_FIXTURE_MARKING_ENABLED'])(
    'fails closed if %s is not in its approved state', async (variable) => {
      vi.stubEnv(variable, 'disabled');
      expect((await POST(request())).status).toBe(403);
      expect(mocks.rpc).not.toHaveBeenCalled();
    },
  );
  it('rejects wrong target even with an admin session', async () => {
    expect((await POST(request({ ...body(), bookingOpsRecordId: 'another-record' }))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('rejects missing explicit no-send and test-only consent', async () => {
    expect((await POST(request({ ...body(), acknowledgeSyntheticOnly: false }))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('rejects extra request fields', async () => {
    expect((await POST(request({ ...body(), extra: 'unexpected' }))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('enforces same-origin JSON instead of cross-site requests', async () => {
    expect((await POST(request(body(), 'https://attacker.example'))).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('requires verified booking/account/property ownership', async () => {
    mocks.requireBookingOpsRouteAccess.mockRejectedValueOnce(new Error('booking_scope_mismatch'));
    expect((await POST(request())).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('does not claim success after database failure', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'error' } });
    expect((await POST(request())).status).toBe(422);
  });
  it('does not claim success without atomic audit confirmation', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: false, error: null });
    expect((await POST(request())).status).toBe(422);
  });
});
