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

  it('does not downgrade a real RU URL when a forwarded-host classifier says global', async () => {
    authMocks.isRu.mockResolvedValue(false);
    const response = await POST(loginRequest('enterprise', true));
    expect(response.status).toBe(200);
    expect(authMocks.ensureAccount).toHaveBeenCalledWith({
      userId: 'existing-user', email: 'user@example.ru', ruCommercial: true,
    });
  });

  it('still enforces same-origin CSRF on a real RU URL despite forwarded-host spoofing', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    authMocks.isRu.mockResolvedValue(false);
    const original = loginRequest('enterprise', true);
    const request = new Request(original.url, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
      body: JSON.stringify({ email: 'user@example.ru', password: 'isolated-only', plan: 'enterprise' }),
    });
    const response = await POST(request);
    expect(response.status).toBe(403);
    expect(authMocks.compare).not.toHaveBeenCalled();
    expect(authMocks.ensureAccount).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it('bounds RU password JSON before looking up any identity or modifying a session', async () => {
    // Trust the request URL, not a spoofed forwarded-host classifier.
    authMocks.isRu.mockResolvedValue(false);
    const origin = 'https://www.asi-global.ru';
    const response = await POST(new Request(origin + '/api/auth/login', {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'user@example.ru', password: 'isolated-only',
        padding: 'x'.repeat(4096) }),
    }));
    expect(response.status).toBe(400);
    expect(authMocks.from).not.toHaveBeenCalled();
    expect(authMocks.compare).not.toHaveBeenCalled();
    expect(authMocks.ensureAccount).not.toHaveBeenCalled();
    expect(authMocks.getSession).not.toHaveBeenCalled();
  });

  it('rejects non-string RU credentials before a database query or session mutation', async () => {
    authMocks.isRu.mockResolvedValue(true);
    const origin = 'https://www.asi-global.ru';
    for (const credentials of [
      { email: { value: 'user@example.ru' }, password: 'isolated-only' },
      { email: 'user@example.ru', password: ['isolated-only'] },
    ]) {
      const response = await POST(new Request(origin + '/api/auth/login', {
        method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
        body: JSON.stringify(credentials),
      }));
      expect(response.status).toBe(400);
    }
    expect(authMocks.from).not.toHaveBeenCalled();
    expect(authMocks.compare).not.toHaveBeenCalled();
    expect(authMocks.ensureAccount).not.toHaveBeenCalled();
    expect(authMocks.getSession).not.toHaveBeenCalled();
  });

  it('retains the existing international login parser for otherwise valid large payloads', async () => {
    authMocks.isRu.mockResolvedValue(false);
    const origin = 'https://global.example';
    const response = await POST(new Request(origin + '/api/auth/login', {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'user@example.ru', password: 'isolated-only',
        padding: 'x'.repeat(4096) }),
    }));
    expect(response.status).toBe(200);
    expect(authMocks.ensureAccount).toHaveBeenCalledWith({
      userId: 'existing-user', email: 'user@example.ru',
      selectedPlan: undefined, deferTrial: true,
    });
  });
  it('cancels a stale Yandex login/link flow after a successful password account switch', async () => {
    authMocks.isRu.mockResolvedValue(true);
    const session = {
      userId: 'old-user',
      googleOauthState: 'old-google-state',
      googleOauthPlan: 'enterprise',
      googleOauthRedirect: '/billing',
      yandexOauthState: 'stale-state',
      yandexOauthVerifier: 'stale-verifier',
      yandexOauthStartedAt: Date.now(),
      yandexOauthRedirect: '/dashboard',
      yandexOauthMode: 'link',
      yandexOauthLinkUserId: 'old-user',
      save: vi.fn().mockResolvedValue(undefined),
    };
    authMocks.getSession.mockResolvedValueOnce(session);
    const res = await POST(loginRequest('small', true));
    expect(res.status).toBe(200);
    expect(session.userId).toBe('existing-user');
    expect(session.googleOauthState).toBeUndefined();
    expect(session.googleOauthPlan).toBeUndefined();
    expect(session.googleOauthRedirect).toBeUndefined();
    expect(session.yandexOauthState).toBeUndefined();
    expect(session.yandexOauthVerifier).toBeUndefined();
    expect(session.yandexOauthStartedAt).toBeUndefined();
    expect(session.yandexOauthRedirect).toBeUndefined();
    expect(session.yandexOauthMode).toBeUndefined();
    expect(session.yandexOauthLinkUserId).toBeUndefined();
    expect(session.save).toHaveBeenCalledOnce();
  });

});
