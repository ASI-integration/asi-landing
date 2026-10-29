import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMocks = vi.hoisted(() => ({
  isRu: vi.fn(), compare: vi.fn(), from: vi.fn(),
  ensureAccount: vi.fn(), getSession: vi.fn(),
}));

vi.mock('@/lib/getIsRuHost', () => ({ getIsRuHost: authMocks.isRu }));
vi.mock('bcryptjs', () => ({ default: { compare: authMocks.compare } }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: authMocks.from } }));
vi.mock('@/lib/accounts', () => ({ ensureAccountForUser: authMocks.ensureAccount }));
vi.mock('@/lib/auth', () => ({ getSession: authMocks.getSession }));

import { POST } from '@/app/api/auth/login/route';

function loginRequest(plan: string, ru: boolean): Request {
  const origin = ru ? 'https://www.asi-global.ru' : 'https://global.example';
  return new Request(origin + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ email: 'user@example.ru', password: 'isolated-only', plan }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  authMocks.compare.mockResolvedValue(true);
  authMocks.from.mockReturnValue({
    select: () => ({ eq: () => ({ single: async () => ({
      data: { id: 'existing-user', email: 'user@example.ru', password_hash: 'test-hash' },
      error: null,
    }) }) }),
  });
  authMocks.ensureAccount.mockResolvedValue({ accountId: 'existing', created: false });
  authMocks.getSession.mockResolvedValue({ save: vi.fn().mockResolvedValue(undefined) });
});

describe('RU password login cannot change plan entitlements', () => {
  it('ignores forged enterprise plan on RU password login, without starting a trial', async () => {
    authMocks.isRu.mockResolvedValue(true);
    const response = await POST(loginRequest('enterprise', true));
    expect(response.status).toBe(200);
    expect(authMocks.ensureAccount).toHaveBeenCalledTimes(1);
    expect(authMocks.ensureAccount).toHaveBeenCalledWith({
      userId: 'existing-user', email: 'user@example.ru', ruCommercial: true,
    });
    expect(authMocks.compare).toHaveBeenCalledOnce();
  });

  it('preserves the existing international password login behavior in this RU-only PR', async () => {
    authMocks.isRu.mockResolvedValue(false);
    const response = await POST(loginRequest('growth', false));
    expect(response.status).toBe(200);
    expect(authMocks.ensureAccount).toHaveBeenCalledTimes(1);
    expect(authMocks.ensureAccount).toHaveBeenCalledWith({
      userId: 'existing-user', email: 'user@example.ru',
      selectedPlan: 'growth', deferTrial: true,
    });
  });
});
