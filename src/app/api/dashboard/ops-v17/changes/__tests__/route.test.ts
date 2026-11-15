import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  ownerAuth: vi.fn(),
  resolveAccount: vi.fn(),
  rpc: vi.fn(),
  filters: [] as [string, string][],
  records: [] as unknown[],
  listError: null as null | { message: string },
}));
vi.mock('@/lib/cabinet/api-auth', () => ({ requireCabinetSession: state.ownerAuth }));
vi.mock('@/lib/accounts', () => ({ resolveOwnerAccountIdForUser: state.resolveAccount }));
vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: state.rpc,
    from: () => {
      const query = {
        select: () => query,
        eq: (key: string, value: string) => { state.filters.push([key, value]); return query; },
        order: () => query,
        limit: async () => ({ data: state.records, error: state.listError }),
      };
      return query;
    },
  },
}));

const requestId = '123e4567-e89b-42d3-a456-426614174000';
const post = (payload: unknown) => new Request('http://local/api/dashboard/ops-v17/changes', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(payload),
});

describe('owner change API access and receipt flow', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    state.filters = [];
    state.records = [];
    state.listError = null;
    state.ownerAuth.mockResolvedValue({ session: { userId: 'user-1' } });
    state.resolveAccount.mockResolvedValue('account-A');
    state.rpc.mockResolvedValue({ data: {
      status: 'applied_internal', requestId, externalStatus: 'not_required',
      explanation: 'Внутреннее изменение подтверждено.',
    }, error: null });
  });

  it('uses only the server-resolved owner account to apply a verified request', async () => {
    const { POST } = await import('../route');
    const res = await POST(post({ requestId, section: 'business', values: { name: 'ASI 1' }, expected: {} }));
    expect(res.status).toBe(200);
    expect(state.rpc).toHaveBeenCalledWith('apply_ops_v17_owner_change', {
      p_account_id: 'account-A',
      p_actor_id: 'user-1',
      p_request_id: requestId,
      p_section: 'business',
      p_values: { name: 'ASI 1' },
      p_expected: {},
    });
  });

  it('does not allow account spoofing, unknown property fields or unexpected request ids', async () => {
    const { POST } = await import('../route');
    expect((await POST(post({ requestId, section: 'business', values: { name: 'x' }, expected: {}, accountId: 'account-B' }))).status).toBe(400);
    expect((await POST(post({ requestId, section: 'business', values: { password: 'x' }, expected: {} }))).status).toBe(400);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it('fails closed without owner membership', async () => {
    state.resolveAccount.mockResolvedValue(null);
    const { GET, POST } = await import('../route');
    expect((await GET()).status).toBe(403);
    expect((await POST(post({ requestId, section: 'owner', values: { name: 'A' }, expected: {} }))).status).toBe(403);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it('distinguishes stale data from successful application', async () => {
    state.rpc.mockResolvedValue({ data: { status: 'conflict', explanation: 'Конфликт' }, error: null });
    const { POST } = await import('../route');
    expect((await POST(post({ requestId, section: 'operations', values: { checkInTime: '13:00' }, expected: {} }))).status).toBe(409);
  });

  it('returns immutable receipt summaries only from the canonical account', async () => {
    const { GET } = await import('../route');
    const response = await GET();
    expect(response.status).toBe(200);
    expect(state.filters).toEqual([['account_id', 'account-A']]);
    expect((await response.json()).changes).toEqual([]);
  });

  it('rejects missing schema/function as unavailable rather than claiming success', async () => {
    state.rpc.mockResolvedValue({ data: null, error: { message: 'function not found' } });
    const { POST } = await import('../route');
    expect((await POST(post({ requestId, section: 'owner', values: { name: 'A' }, expected: {} }))).status).toBe(503);
  });
});
