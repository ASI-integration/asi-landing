import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  member: { account_id: 'account-A', role: 'operator' } as { account_id: string; role: string } | null,
  error: null as { message: string } | null,
  save: vi.fn(), activate: vi.fn(), workspace: vi.fn(),
}));
vi.mock('@/lib/cabinet/api-auth', () => ({
  requireCabinetSession: async () => ({ session: { userId: 'user-A' } }),
}));
vi.mock('@/lib/crm/api-auth', () => ({ requireOpsAdminSession: vi.fn() }));
vi.mock('@/lib/ops-v17/service', () => ({
  saveOnboardingStep: state.save, activatePilot: state.activate, getWorkspace: state.workspace,
  bootstrapPilot: vi.fn(), createVerificationIssue: vi.fn(),
}));
vi.mock('@/lib/supabase', () => ({ supabase: { from: () => {
  let roles: string[] | undefined;
  const query = {
    select: () => query, eq: () => query, order: () => query, limit: () => query,
    in: (_field: string, allowed: string[]) => { roles = allowed; return query; },
    maybeSingle: async () => ({
      data: state.member && (!roles || roles.includes(state.member.role)) ? state.member : null,
      error: state.error,
    }),
  };
  return query;
} } }));
beforeEach(() => {
  vi.clearAllMocks(); state.member = { account_id: 'account-A', role: 'operator' }; state.error = null;
});
describe('OPS owner role is an authorization boundary', () => {
  it('operator membership cannot read owner intake or activate/edit setup', async () => {
    const { GET, PATCH } = await import('../route');
    const { POST } = await import('../action/route');
    expect((await GET()).status).toBe(403);
    expect((await PATCH(new Request('http://local', {
      method: 'PATCH', body: JSON.stringify({ step: 'business', data: { business: { name: 'forged' } } }),
    }))).status).toBe(403);
    expect((await POST(new Request('http://local', {
      method: 'POST', body: JSON.stringify({ action: 'activate', accountId: 'account-B' }),
    }))).status).toBe(403);
    expect(state.save).not.toHaveBeenCalled(); expect(state.activate).not.toHaveBeenCalled();
    expect(state.workspace).not.toHaveBeenCalled();
  });
  it.each(['owner', 'manager'])('%s can edit only their resolved account', async (role) => {
    state.member = { account_id: 'account-A', role };
    const { PATCH } = await import('../route');
    expect((await PATCH(new Request('http://local', {
      method: 'PATCH', body: JSON.stringify({ step: 'business', accountId: 'account-B', data: { business: { name: 'Owner' } } }),
    }))).status).toBe(200);
    expect(state.save).toHaveBeenCalledWith(expect.objectContaining({ accountId: 'account-A' }));
  });
  it('revoked membership denies the next request', async () => {
    state.member = null;
    const { GET } = await import('../route');
    expect((await GET()).status).toBe(403);
    expect(state.workspace).not.toHaveBeenCalled();
  });
});
