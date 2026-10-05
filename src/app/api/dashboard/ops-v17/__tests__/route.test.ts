import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireCabinetSession = vi.fn();
const requireOpsAdminSession = vi.fn();
const resolveAccountIdForUser = vi.fn();
const getWorkspace = vi.fn();
const saveOnboardingStep = vi.fn();
const activatePilot = vi.fn();
const bootstrapPilot = vi.fn();
const createVerificationIssue = vi.fn();

vi.mock('@/lib/cabinet/api-auth', () => ({ requireCabinetSession }));
vi.mock('@/lib/crm/api-auth', () => ({ requireOpsAdminSession }));
vi.mock('@/lib/accounts', () => ({ resolveAccountIdForUser, resolveOwnerAccountIdForUser: resolveAccountIdForUser }));
vi.mock('@/lib/ops-v17/service', () => ({
  getWorkspace,
  saveOnboardingStep,
  activatePilot,
  bootstrapPilot,
  createVerificationIssue,
}));

describe('OPS v17 owner zero-touch boundary', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    requireCabinetSession.mockResolvedValue({ session: { userId: 'user-1', email: 'owner@example.test' } });
    requireOpsAdminSession.mockResolvedValue({ session: { userId: 'admin-1', email: 'admin@asi-global.ru' } });
    resolveAccountIdForUser.mockImplementation(async (userId: string) => userId === 'admin-1' ? 'account-admin' : 'account-owner');
  });

  it('loads the owner workspace by canonical account id', async () => {
    getWorkspace.mockResolvedValue({ onboarding: { id: 'o1' } });
    const { GET } = await import('../route');
    const response = await GET();
    expect(response.status).toBe(200);
    expect(resolveAccountIdForUser).toHaveBeenCalledWith('user-1');
    expect(getWorkspace).toHaveBeenCalledWith('account-owner');
    expect(getWorkspace).not.toHaveBeenCalledWith('user-1');
  });

  it('saves onboarding against the canonical owner account', async () => {
    saveOnboardingStep.mockResolvedValue({ id: 'o1' });
    const { PATCH } = await import('../route');
    const response = await PATCH(new Request('http://local', {
      method: 'PATCH',
      body: JSON.stringify({ step: 'business', data: { business: { name: 'Owner Co' } } }),
    }));
    expect(response.status).toBe(200);
    expect(saveOnboardingStep).toHaveBeenCalledWith(expect.objectContaining({
      accountId: 'account-owner',
      actorId: 'user-1',
      step: 'business',
    }));
  });

  it('allows a normal owner to activate only their ready workspace', async () => {
    activatePilot.mockResolvedValue({ activatedAt: '2026-09-30T20:00:00.000Z' });
    const { POST } = await import('../action/route');
    const response = await POST(new Request('http://local', {
      method: 'POST',
      body: JSON.stringify({ action: 'activate' }),
    }));
    expect(response.status).toBe(200);
    expect(requireOpsAdminSession).not.toHaveBeenCalled();
    expect(activatePilot).toHaveBeenCalledWith('account-owner', 'user-1');
  });

  it('ignores forged account/property identifiers during owner activation', async () => {
    activatePilot.mockResolvedValue({ activatedAt: '2026-10-01T08:00:00.000Z' });
    const { POST } = await import('../action/route');
    const response = await POST(new Request('http://local', {
      method: 'POST',
      body: JSON.stringify({ action: 'activate', accountId: 'account-foreign', propertyId: 'property-foreign' }),
    }));
    expect(response.status).toBe(200);
    expect(activatePilot).toHaveBeenCalledWith('account-owner', 'user-1');
  });

  it('keeps bootstrap admin-only and canonical-account scoped', async () => {
    bootstrapPilot.mockResolvedValue({ dryRun: true });
    const { POST } = await import('../action/route');
    const response = await POST(new Request('http://local', {
      method: 'POST',
      body: JSON.stringify({ action: 'bootstrap', confirm: false }),
    }));
    expect(response.status).toBe(200);
    expect(requireOpsAdminSession).toHaveBeenCalledOnce();
    expect(requireCabinetSession).not.toHaveBeenCalled();
    expect(bootstrapPilot).toHaveBeenCalledWith({
      accountId: 'account-admin',
      actorId: 'admin-1',
      confirm: false,
    });
  });

  it('fails closed when the owner has no canonical workspace', async () => {
    resolveAccountIdForUser.mockResolvedValue(null);
    const { POST } = await import('../action/route');
    const response = await POST(new Request('http://local', {
      method: 'POST',
      body: JSON.stringify({ action: 'activate' }),
    }));
    expect(response.status).toBe(403);
    expect(activatePilot).not.toHaveBeenCalled();
    expect(createVerificationIssue).not.toHaveBeenCalled();
  });
});
