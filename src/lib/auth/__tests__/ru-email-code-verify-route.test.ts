import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isRu: vi.fn(), getSession: vi.fn(), from: vi.fn(), ensure: vi.fn(),
  consume: vi.fn(),
}));
vi.mock('@/lib/getIsRuHost', () => ({ getIsRuHost: mocks.isRu }));
vi.mock('@/lib/auth', () => ({ getSession: mocks.getSession }));
vi.mock('@/lib/accounts', () => ({ ensureAccountForUser: mocks.ensure }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: mocks.from } }));
vi.mock('@/lib/auth/ru-email-code-server', () => ({
  consumeRuEmailCode: mocks.consume,
  ruEmailCodeReady: () => true,
}));

import { POST } from '@/app/api/auth/email-code/verify/route';

const origin = 'https://www.asi-global.ru';
function request() {
  return new Request(origin + '/api/auth/email-code/verify', {
    method: 'POST',
    headers: { origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'user@example.ru', code: '12345678' }),
  });
}
function oldSession() {
  return {
    userId: 'different-user',
    email: 'previous@example.ru',
    googleOauthState: 'stale-google-state',
    googleOauthPlan: 'enterprise',
    googleOauthRedirect: '/billing',
    yandexOauthState: 'stale-state',
    yandexOauthVerifier: 'stale-verifier',
    yandexOauthStartedAt: Date.now(),
    yandexOauthRedirect: '/dashboard/settings',
    yandexOauthMode: 'link',
    yandexOauthLinkUserId: 'different-user',
    lastStrongAuthUserId: 'different-user',
    lastStrongAuthAt: 1,
    save: vi.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('ASI_RU_EMAIL_CODE_ORIGIN', origin);
  mocks.isRu.mockResolvedValue(true);
  mocks.consume.mockResolvedValue('user@example.ru');
  mocks.ensure.mockResolvedValue({ accountId: 'existing', created: false });
  mocks.from.mockReturnValue({
    select: () => ({ ilike: () => ({ limit: async () => ({
      data: [{ id: 'verified-user', email: 'user@example.ru' }], error: null,
    }) }) }),
  });
});
afterEach(() => { vi.unstubAllEnvs(); });

describe('RU OTP completion supersedes stale Yandex OAuth state', () => {
  it('invalidates the pending login/link without clearing the successful ASI login', async () => {
    const session = oldSession();
    mocks.getSession.mockResolvedValue(session);
    const res = await POST(request());
    expect(res.status).toBe(200);
    expect(session.userId).toBe('verified-user');
    expect(session.lastStrongAuthUserId).toBe('verified-user');
    expect(session.lastStrongAuthAt).toBeGreaterThan(1);
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
    expect(mocks.ensure).toHaveBeenCalledWith({
      userId: 'verified-user', email: 'user@example.ru', ruCommercial: true,
    });
  });

  it('rejects oversized unauthenticated JSON before OTP consume or session mutation', async () => {
    const tooLarge = new Request(origin + '/api/auth/email-code/verify', {
      method: 'POST',
      headers: { origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'user@example.ru', code: '12345678', padding: 'X'.repeat(2048),
      }),
    });
    const res = await POST(tooLarge);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: 'INVALID_BODY' });
    expect(mocks.consume).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.ensure).not.toHaveBeenCalled();
    expect(mocks.getSession).not.toHaveBeenCalled();
  });

  it('preserves the existing browser session and pending flow on an invalid code', async () => {
    const session = oldSession();
    mocks.getSession.mockResolvedValue(session);
    mocks.consume.mockResolvedValueOnce(null);
    const res = await POST(request());
    expect(res.status).toBe(401);
    expect(session.userId).toBe('different-user');
    expect(session.googleOauthState).toBe('stale-google-state');
    expect(session.yandexOauthState).toBe('stale-state');
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(mocks.ensure).not.toHaveBeenCalled();
    expect(session.save).not.toHaveBeenCalled();
  });
  it('reuses the existing mixed-case email identity without creating a second user', async () => {
    const session = oldSession();
    mocks.getSession.mockResolvedValue(session);
    const insert = vi.fn();
    mocks.from.mockReturnValue({
      select: () => ({ ilike: (column: string, pattern: string) => {
        expect(column).toBe('email');
        expect(pattern).toBe('user@example.ru');
        return { limit: async (n: number) => {
          expect(n).toBe(3);
          return { data: [{ id: 'existing-user', email: 'User@Example.RU' }], error: null };
        } };
      } }),
      insert,
    });
    const res = await POST(request());
    expect(res.status).toBe(200);
    expect(session.userId).toBe('existing-user');
    expect(session.email).toBe('User@Example.RU');
    expect(insert).not.toHaveBeenCalled();
  });

  it('rejects a collision between two case-fold-equivalent existing user records', async () => {
    const session = oldSession();
    mocks.getSession.mockResolvedValue(session);
    mocks.from.mockReturnValue({
      select: () => ({ ilike: () => ({ limit: async () => ({
        data: [
          { id: 'lower-user', email: 'user@example.ru' },
          { id: 'mixed-user', email: 'User@Example.RU' },
        ], error: null,
      }) }) }),
    });
    const res = await POST(request());
    expect(res.status).toBe(503);
    expect(session.userId).toBe('different-user');
    expect(mocks.ensure).not.toHaveBeenCalled();
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(session.save).not.toHaveBeenCalled();
  });

  it('escapes SQL ILIKE patterns and never authenticates a wildcard-only row', async () => {
    const session = oldSession();
    mocks.getSession.mockResolvedValue(session);
    mocks.consume.mockResolvedValueOnce('buyer_100%@example.ru');
    mocks.from.mockReturnValue({
      select: () => ({ ilike: (column: string, pattern: string) => {
        expect(column).toBe('email');
        expect(pattern).toBe('buyer\\_100\\%@example.ru');
        return { limit: async () => ({
          data: [{ id: 'unrelated', email: 'buyerX100Y@example.ru' }], error: null,
        }) };
      } }),
    });
    const res = await POST(request());
    expect(res.status).toBe(503);
    expect(session.userId).toBe('different-user');
    expect(mocks.ensure).not.toHaveBeenCalled();
    expect(mocks.getSession).not.toHaveBeenCalled();
  });

});
