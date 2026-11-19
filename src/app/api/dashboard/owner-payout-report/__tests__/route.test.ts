import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  configured: vi.fn(), getSession: vi.fn(), permission: vi.fn(),
  from: vi.fn(), predicates: [] as string[],
}));
vi.mock('@/lib/auth', () => ({
  isSessionSecretConfigured: mocks.configured, getSession: mocks.getSession,
}));
vi.mock('@/lib/booking-ops/property-role-access', () => ({
  requirePropertyPermission: mocks.permission,
}));
vi.mock('@/lib/supabase', () => ({ supabase: { from: mocks.from } }));

const uid = '11111111-1111-4111-8111-111111111111';
const aid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const pid = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const bid = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const request = (q = `bookingOpsRecordId=${bid}&accountId=${aid}&propertyId=${pid}`) =>
  new Request(`https://local.invalid/api/dashboard/owner-payout-report?${q}`);

function query(table: string, exists: boolean) {
  return {
    select() { return this; },
    eq(k: string, v: string) { mocks.predicates.push(`${table}.${k}=${v}`); return this; },
    maybeSingle() {
      return Promise.resolve({
        data: exists ? table === 'booking_ops_records' ? { id: bid } : { id: 'report' } : null,
        error: null,
      });
    },
    then(ok: (x: unknown) => unknown, fail?: (error: unknown) => unknown) {
      return Promise.resolve({ data: [], error: null }).then(ok, fail);
    },
  };
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.predicates.length = 0;
  mocks.configured.mockReturnValue(true);
  mocks.getSession.mockResolvedValue({ userId: uid });
  mocks.permission.mockResolvedValue('owner');
  mocks.from.mockImplementation((table: string) => query(table, true));
});

describe('owner payout scoped route', () => {
  it('rejects unauthenticated before DB reads', async () => {
    mocks.getSession.mockResolvedValue({});
    const { GET } = await import('../route');
    expect((await GET(request())).status).toBe(401);
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it('rejects invalid IDs before DB reads', async () => {
    const { GET } = await import('../route');
    expect((await GET(request('bookingOpsRecordId=bad&accountId=legacy'))).status).toBe(400);
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it('rejects foreign property before DB reads', async () => {
    mocks.permission.mockRejectedValue(new Error('property_access_denied'));
    const { GET } = await import('../route');
    expect((await GET(request())).status).toBe(403);
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it('does not return a booking not found in the scoped property', async () => {
    mocks.from.mockImplementation((table: string) => query(table, false));
    const { GET } = await import('../route');
    expect((await GET(request())).status).toBe(404);
    expect(mocks.from).toHaveBeenCalledTimes(1);
  });
  it('returns unverified payment status and scopes all service_role queries', async () => {
    const { GET } = await import('../route');
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect((await response.json()).settlementStatus).toBe('CALCULATED_NOT_BANK_VERIFIED');
    for (const table of ['booking_ops_records', 'owner_payout_reports', 'financial_ledger_entries']) {
      expect(mocks.predicates).toContain(`${table}.account_id=${aid}`);
      expect(mocks.predicates).toContain(`${table}.property_id=${pid}`);
      expect(mocks.predicates).toContain(`${table}.${table === 'booking_ops_records' ? 'id' : 'booking_id'}=${bid}`);
    }
  });
});
