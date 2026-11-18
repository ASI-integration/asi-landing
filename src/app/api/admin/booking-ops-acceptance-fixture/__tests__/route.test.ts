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

const PINNED = '11111111-1111-4111-8111-111111111111';
const OWNER_ACCOUNT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OWNER_PROPERTY = '33333333-3333-4333-8333-333333333333';
const APP = 'https://staging.example.test';
const body = () => ({
  bookingOpsRecordId: PINNED, confirm: true, noSend: true,
  acknowledgeSyntheticOnly: true,
});
const request = (payload: unknown = body(), origin = APP) => new Request(APP + '/api/admin/booking-ops-acceptance-fixture', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: origin, 'Sec-Fetch-Site': 'same-origin' },
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
      OPS_ACCEPTANCE_FIXTURE_ACCOUNT_ID: OWNER_ACCOUNT,
      OPS_ACCEPTANCE_FIXTURE_PROPERTY_ID: OWNER_PROPERTY,
      OPS_ACCEPTANCE_FIXTURE_ALLOWED_RECORD_ID: PINNED,
      OPS_ACCEPTANCE_FIXTURE_ALLOWED_ACCOUNT_ID: OWNER_ACCOUNT,
      OPS_ACCEPTANCE_FIXTURE_ALLOWED_PROPERTY_ID: OWNER_PROPERTY,
      OPS_ACCEPTANCE_FIXTURE_RPC_V2_VERIFIED: 'YES',
      NEXT_PUBLIC_APP_URL: APP,
    })) vi.stubEnv(k, v);
    mocks.requireOpsAdminSession.mockResolvedValue({ session: { userId: 'actor-a' } });
    mocks.requireBookingOpsRouteAccess.mockResolvedValue({
      actorId: 'actor-a', accountId: OWNER_ACCOUNT, propertyId: OWNER_PROPERTY,
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
      accountId: OWNER_ACCOUNT, propertyId: OWNER_PROPERTY,
    });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('asi_mark_acceptance_fixture', {
      p_record_id: PINNED, p_account_id: OWNER_ACCOUNT,
      p_property_id: OWNER_PROPERTY, p_actor_id: 'actor-a',
      p_allowed_record_id: PINNED,
      p_allowed_account_id: OWNER_ACCOUNT,
      p_allowed_property_id: OWNER_PROPERTY,
    });
  });
  it('denies unverified admin access before any record lookup', async () => {
    mocks.requireOpsAdminSession.mockResolvedValueOnce({ error: new Response('denied', { status: 403 }) });
    expect((await POST(request())).status).toBe(403);
    expect(mocks.requireBookingOpsRouteAccess).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(['ASI_DEPLOYMENT_TIER','ASI_SYNTHETIC_NO_SEND','EMAIL_AUTO_SEND','EMAIL_DRAFT_ONLY','DRY_RUN_TELEGRAM_OUTBOUND','ALLOW_REAL_TELEGRAM_SYNTHETIC','YOOKASSA_ENABLED','OPS_ACCEPTANCE_FIXTURE_MARKING_ENABLED',
    'OPS_ACCEPTANCE_FIXTURE_RPC_V2_VERIFIED'])(
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
  it('requires Sec-Fetch-Site, never allows a missing fetch-metadata header', async () => {
    const unsafe = new Request(APP + '/api/admin/booking-ops-acceptance-fixture', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: APP },
      body: JSON.stringify(body()),
    });
    expect((await POST(unsafe)).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('rejects noncanonical uppercase UUIDs in environment configuration', async () => {
    vi.stubEnv('OPS_ACCEPTANCE_FIXTURE_ALLOWED_ACCOUNT_ID', OWNER_ACCOUNT.toUpperCase());
    expect((await POST(request())).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('requires verified booking/account/property ownership', async () => {
    mocks.requireBookingOpsRouteAccess.mockRejectedValueOnce(new Error('booking_scope_mismatch'));
    expect((await POST(request())).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('requires a canonical UUID for the owner-selected record', async () => {
    vi.stubEnv('OPS_ACCEPTANCE_FIXTURE_RECORD_ID', '5477f7dd-----------------------------');
    expect((await POST(request())).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(['OPS_ACCEPTANCE_FIXTURE_ACCOUNT_ID', 'OPS_ACCEPTANCE_FIXTURE_PROPERTY_ID'])(
    'refuses missing explicit owner tenant pin %s', async (name) => {
      vi.stubEnv(name, '');
      expect((await POST(request())).status).toBe(403);
      expect(mocks.rpc).not.toHaveBeenCalled();
    },
  );
  it.each([
    'OPS_ACCEPTANCE_FIXTURE_ALLOWED_RECORD_ID',
    'OPS_ACCEPTANCE_FIXTURE_ALLOWED_ACCOUNT_ID',
    'OPS_ACCEPTANCE_FIXTURE_ALLOWED_PROPERTY_ID',
  ])('fails closed without required allowed UUID parameter %s', async (key) => {
    vi.stubEnv(key, '');
    expect((await POST(request())).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([
    'OPS_ACCEPTANCE_FIXTURE_ALLOWED_RECORD_ID',
    'OPS_ACCEPTANCE_FIXTURE_ALLOWED_ACCOUNT_ID',
    'OPS_ACCEPTANCE_FIXTURE_ALLOWED_PROPERTY_ID',
  ])('rejects mismatched allowed UUID parameter %s', async (key) => {
    vi.stubEnv(key, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect((await POST(request())).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('refuses a cross-tenant or cross-property record even if the session is authorized', async () => {
    mocks.requireBookingOpsRouteAccess.mockResolvedValueOnce({
      actorId: 'actor-a', accountId: OWNER_ACCOUNT,
      propertyId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', bookingId: PINNED,
    });
    expect((await POST(request())).status).toBe(403);
    expect(mocks.requireBookingOpsRecordScope).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('requires explicit app and SQL owner scopes to agree', async () => {
    vi.stubEnv('OPS_ACCEPTANCE_FIXTURE_ACCOUNT_ID', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    expect((await POST(request())).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('denies cross-site fetch metadata even with a forged Origin header', async () => {
    const unsafe = new Request(APP + '/api/admin/booking-ops-acceptance-fixture', {
      method: 'POST', headers: {
        'Content-Type': 'application/json', Origin: APP, 'Sec-Fetch-Site': 'cross-site',
      }, body: JSON.stringify(body()),
    });
    expect((await POST(unsafe)).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('does not expose internal exception text or database identifiers', async () => {
    mocks.rpc.mockRejectedValueOnce(new Error('db_account_secret_internal'));
    const res = await POST(request());
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ ok: false, message: 'fixture_marking_failed' });
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
