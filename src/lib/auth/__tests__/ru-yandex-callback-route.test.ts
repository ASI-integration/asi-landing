import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isRu: vi.fn(), getSession: vi.fn(), save: vi.fn(), from: vi.fn(), ensure: vi.fn(),
}));
vi.mock('@/lib/getIsRuHost', () => ({ getIsRuHost: mocks.isRu }));
vi.mock('@/lib/auth', () => ({ getSession: mocks.getSession }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: mocks.from } }));
vi.mock('@/lib/accounts', () => ({ ensureAccountForUser: mocks.ensure }));

import { GET } from '@/app/api/auth/yandex/callback/route';

const origin = 'https://www.asi-global.ru';
const state = 'A'.repeat(43);
function pendingSession() {
  return {
    yandexOauthState: state,
    yandexOauthVerifier: 'B'.repeat(64),
    yandexOauthStartedAt: Date.now(),
    yandexOauthMode: 'link' as const,
    yandexOauthLinkUserId: 'owner-a',
    yandexOauthRedirect: '/dashboard/settings',
    userId: 'owner-a',
    lastStrongAuthUserId: 'owner-a',
    lastStrongAuthAt: Date.now(),
    save: mocks.save,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('ASI_RU_YANDEX_ID_ENABLED', 'true');
  vi.stubEnv('ASI_RU_YANDEX_LINKS_READY', 'true');
  vi.stubEnv('ASI_RU_YANDEX_ORIGIN', origin);
  vi.stubEnv('ASI_RU_YANDEX_CLIENT_ID', 'inert-test-client');
  vi.stubEnv('ASI_RU_YANDEX_CLIENT_SECRET', 'inert-test-secret');
  vi.stubEnv('SESSION_SECRET', 'inert-session-secret-at-least-32-characters');
  vi.stubEnv('SUPABASE_URL', 'https://fixture.invalid');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'inert-test-role-key');
  mocks.isRu.mockResolvedValue(true);
  mocks.save.mockResolvedValue(undefined);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('RU Yandex OAuth callback cannot cancel a pending flow by CSRF', () => {
  it('does not redirect to attacker-controlled callback host or touch an existing session', async () => {
    mocks.getSession.mockResolvedValue(pendingSession());
    const response = await GET(new Request(
      'https://attacker.example/api/auth/yandex/callback?state=' + state + '&code=fixture-code',
    ));
    expect(response.status).toBe(503);
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('location')).toBeNull();
    expect(await response.json()).toEqual({ ok: false, error: 'YANDEX_LOGIN_UNAVAILABLE' });
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('uses only non-redirecting provider requests before linking the verified subject', async () => {
    const session = pendingSession();
    mocks.getSession.mockResolvedValue(session);
    const insert = vi.fn().mockResolvedValue({ error: null });
    mocks.from.mockImplementation((table: string) => {
      expect(table).toBe('ru_auth_yandex_links');
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
        insert,
      };
    });
    const providerFetch = vi.fn(async (providerUrl: string, opts: RequestInit): Promise<Response> => {
      expect(opts.redirect).toBe('error');
      if (providerUrl === 'https://oauth.yandex.ru/token') {
        const body = new URLSearchParams(String(opts.body));
        expect(body.get('code_verifier')).toBe('B'.repeat(64));
        expect(body.has('redirect_uri')).toBe(false);
        return new Response(JSON.stringify({
          token_type: 'bearer', access_token: 'isolated-test-access-token', scope: 'login:info',
        }), { status: 200 });
      }
      if (providerUrl === 'https://login.yandex.ru/info?format=json') {
        expect((opts.headers as Record<string, string>).Authorization).toBe('OAuth isolated-test-access-token');
        return new Response(JSON.stringify({ id: '123456', client_id: 'inert-test-client' }), { status: 200 });
      }
      throw new Error('UNEXPECTED_PROVIDER_ENDPOINT');
    });
    vi.stubGlobal('fetch', providerFetch);

    const response = await GET(new Request(
      origin + '/api/auth/yandex/callback?state=' + state + '&code=fixture-auth-code',
    ));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(origin + '/dashboard/settings');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(providerFetch).toHaveBeenCalledTimes(2);
    expect(insert).toHaveBeenCalledWith({ yandex_subject: '123456', user_id: 'owner-a' });
    expect(mocks.ensure).not.toHaveBeenCalled();
    expect(mocks.save).toHaveBeenCalledOnce();
  });

  it('clears stale Google flow when a linked Yandex subject completes a new RU login', async () => {
    const session = {
      ...pendingSession(),
      email: 'previous@example.ru',
      yandexOauthMode: 'login' as const,
      yandexOauthLinkUserId: undefined,
      googleOauthState: 'old-google-state',
      googleOauthPlan: 'enterprise',
      googleOauthRedirect: '/billing',
    };
    mocks.getSession.mockResolvedValue(session);
    mocks.ensure.mockResolvedValue({ accountId: 'existing', created: false });
    mocks.from.mockImplementation((table: string) => {
      if (table === 'ru_auth_yandex_links') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () =>
          ({ data: { user_id: 'linked-user' }, error: null }) }) }) };
      }
      if (table === 'users') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () =>
          ({ data: { id: 'linked-user', email: 'linked@example.ru' }, error: null }) }) }) };
      }
      throw new Error('unexpected table ' + table);
    });
    vi.stubGlobal('fetch', vi.fn(async (providerUrl: string) => {
      if (providerUrl === 'https://oauth.yandex.ru/token') {
        return new Response(JSON.stringify({
          token_type: 'bearer', access_token: 'isolated-test-access-token', scope: 'login:info',
        }), { status: 200 });
      }
      if (providerUrl === 'https://login.yandex.ru/info?format=json') {
        return new Response(JSON.stringify({ id: '123456', client_id: 'inert-test-client' }), { status: 200 });
      }
      throw new Error('unexpected endpoint');
    }));
    const response = await GET(new Request(
      origin + '/api/auth/yandex/callback?state=' + state + '&code=fixture-auth-code',
    ));
    expect(response.status).toBe(307);
    expect(session.userId).toBe('linked-user');
    expect(session.email).toBe('linked@example.ru');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(session.googleOauthState).toBeUndefined();
    expect(session.googleOauthPlan).toBeUndefined();
    expect(session.googleOauthRedirect).toBeUndefined();
    expect(mocks.ensure).toHaveBeenCalledWith({
      userId: 'linked-user', email: 'linked@example.ru', ruCommercial: true,
    });
    expect(mocks.save).toHaveBeenCalledTimes(2);
  });

  it('leaves a pending link intact on a missing or unrelated state, without provider or DB calls', async () => {
    const session = pendingSession();
    mocks.getSession.mockResolvedValue(session);
    for (const query of ['', '?state=' + 'Z'.repeat(43), '?error=access_denied']) {
      const response = await GET(new Request(origin + '/api/auth/yandex/callback' + query));
      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toContain('yandex_error=invalid_state');
      expect(response.headers.get('referrer-policy')).toBe('no-referrer');
      expect(session.yandexOauthState).toBe(state);
      expect(session.yandexOauthVerifier).toBe('B'.repeat(64));
    }
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.ensure).not.toHaveBeenCalled();
  });

  it('does not consume a link when the OAuth callback contains repeated state', async () => {
    const session = pendingSession();
    mocks.getSession.mockResolvedValue(session);
    const providerFetch = vi.fn();
    vi.stubGlobal('fetch', providerFetch);
    const response = await GET(new Request(
      origin + '/api/auth/yandex/callback?state=' + state + '&state=' + state + '&code=fixture-auth-code',
    ));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('yandex_error=invalid_state');
    expect(session.yandexOauthState).toBe(state);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it.each([
    '?state=' + state + '&code=fixture-auth-code&code=other-auth-code',
    '?state=' + state + '&code=fixture-auth-code&error=access_denied',
  ])('burns an ambiguous state-matched OAuth callback without a token exchange: %s', async (query) => {
    const session = pendingSession();
    mocks.getSession.mockResolvedValue(session);
    const providerFetch = vi.fn();
    vi.stubGlobal('fetch', providerFetch);
    const response = await GET(new Request(origin + '/api/auth/yandex/callback' + query));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('yandex_error=invalid_state');
    expect(session.yandexOauthState).toBeUndefined();
    expect(mocks.save).toHaveBeenCalledOnce();
    expect(mocks.from).not.toHaveBeenCalled();
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it('burns a matching-state flow on provider error, so it cannot be reused', async () => {
    const session = pendingSession();
    mocks.getSession.mockResolvedValue(session);
    const response = await GET(new Request(
      origin + '/api/auth/yandex/callback?state=' + state + '&error=access_denied',
    ));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('yandex_error=access_denied');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(session.yandexOauthState).toBeUndefined();
    expect(session.yandexOauthVerifier).toBeUndefined();
    expect(session.yandexOauthMode).toBeUndefined();
    expect(mocks.save).toHaveBeenCalledOnce();
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it.each([
    '?state=' + state + '&error=unexpected_provider_error',
    '?state=' + state + '&error=access_denied&error=access_denied',
  ])('burns a matched but untrusted provider error without reflecting its value: %s', async (query) => {
    const session = pendingSession();
    mocks.getSession.mockResolvedValue(session);
    const providerFetch = vi.fn();
    vi.stubGlobal('fetch', providerFetch);
    const response = await GET(new Request(origin + '/api/auth/yandex/callback' + query));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('yandex_error=invalid_state');
    expect(response.headers.get('location')).not.toContain('unexpected_provider_error');
    expect(session.yandexOauthState).toBeUndefined();
    expect(mocks.save).toHaveBeenCalledOnce();
    expect(providerFetch).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('refuses a Yandex account link after the current ASI session switches identities, without provider calls', async () => {
    const session = { ...pendingSession(), userId: 'different-user', email: 'different@example.ru' };
    mocks.getSession.mockResolvedValue(session);
    const providerFetch = vi.fn();
    vi.stubGlobal('fetch', providerFetch);
    const response = await GET(new Request(
      origin + '/api/auth/yandex/callback?state=' + state + '&code=fixture-auth-code',
    ));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('yandex_error=link_requires_recent_auth');
    expect(providerFetch).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.ensure).not.toHaveBeenCalled();
    expect(session.userId).toBe('different-user');
    expect(session.email).toBe('different@example.ru');
    expect(session.yandexOauthState).toBeUndefined();
    expect(mocks.save).toHaveBeenCalledOnce();
  });

  it.each([
    ['expired proof', { lastStrongAuthAt: Date.now() - 11 * 60 * 1000 }],
    ['proof belongs to another user', { lastStrongAuthUserId: 'other-user' }],
    ['missing link identity', { yandexOauthLinkUserId: undefined }],
  ])('rejects Yandex link with %s before token exchange or registry access', async (_case, patch) => {
    const session = { ...pendingSession(), ...patch };
    mocks.getSession.mockResolvedValue(session);
    const providerFetch = vi.fn();
    vi.stubGlobal('fetch', providerFetch);
    const response = await GET(new Request(
      origin + '/api/auth/yandex/callback?state=' + state + '&code=fixture-auth-code',
    ));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('yandex_error=link_requires_recent_auth');
    expect(providerFetch).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.ensure).not.toHaveBeenCalled();
    expect(session.yandexOauthState).toBeUndefined();
    expect(mocks.save).toHaveBeenCalledOnce();
  });

  it('fails closed when Yandex rejects code exchange: no ASI DB access or user switch', async () => {
    const session = pendingSession();
    mocks.getSession.mockResolvedValue(session);
    const providerFetch = vi.fn(async (providerUrl: string) => {
      expect(providerUrl).toBe('https://oauth.yandex.ru/token');
      return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 });
    });
    vi.stubGlobal('fetch', providerFetch);
    const response = await GET(new Request(
      origin + '/api/auth/yandex/callback?state=' + state + '&code=fixture-auth-code',
    ));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('yandex_error=temporary_failure');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(session.userId).toBe('owner-a');
    expect(session.yandexOauthState).toBeUndefined();
    expect(mocks.save).toHaveBeenCalledOnce();
    expect(providerFetch).toHaveBeenCalledOnce();
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.ensure).not.toHaveBeenCalled();
  });

  it('denies unlinked provider login without creating an ASI user or resetting the session', async () => {
    const session = {
      ...pendingSession(), yandexOauthMode: 'login' as const,
      yandexOauthLinkUserId: undefined, email: 'existing@example.ru',
    };
    mocks.getSession.mockResolvedValue(session);
    mocks.from.mockImplementation((table: string) => {
      expect(table).toBe('ru_auth_yandex_links');
      return { select: () => ({ eq: () => ({ maybeSingle: async () =>
        ({ data: null, error: null }) }) }) };
    });
    vi.stubGlobal('fetch', vi.fn(async (providerUrl: string) => {
      if (providerUrl === 'https://oauth.yandex.ru/token')
        return new Response(JSON.stringify({
          token_type: 'bearer', access_token: 'isolated-test-access-token', scope: 'login:info',
        }), { status: 200 });
      if (providerUrl === 'https://login.yandex.ru/info?format=json')
        return new Response(JSON.stringify({ id: '123456', client_id: 'inert-test-client' }), { status: 200 });
      throw new Error('unexpected provider endpoint');
    }));
    const response = await GET(new Request(
      origin + '/api/auth/yandex/callback?state=' + state + '&code=fixture-auth-code',
    ));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('yandex_error=link_first');
    expect(session.userId).toBe('owner-a');
    expect(session.email).toBe('existing@example.ru');
    expect(mocks.from).toHaveBeenCalledTimes(1);
    expect(mocks.ensure).not.toHaveBeenCalled();
    expect(mocks.save).toHaveBeenCalledOnce();
  });

  it('rejects a profile belonging to another Yandex OAuth app before ASI data access', async () => {
    const session = pendingSession();
    mocks.getSession.mockResolvedValue(session);
    const providerFetch = vi.fn(async (providerUrl: string) => {
      if (providerUrl === 'https://oauth.yandex.ru/token')
        return new Response(JSON.stringify({
          token_type: 'bearer', access_token: 'isolated-test-access-token', scope: 'login:info',
        }), { status: 200 });
      if (providerUrl === 'https://login.yandex.ru/info?format=json')
        return new Response(JSON.stringify({ id: '123456', client_id: 'another-app' }), { status: 200 });
      throw new Error('unexpected provider endpoint');
    });
    vi.stubGlobal('fetch', providerFetch);
    const response = await GET(new Request(
      origin + '/api/auth/yandex/callback?state=' + state + '&code=fixture-auth-code',
    ));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('yandex_error=temporary_failure');
    expect(providerFetch).toHaveBeenCalledTimes(2);
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.ensure).not.toHaveBeenCalled();
    expect(session.yandexOauthState).toBeUndefined();
    expect(mocks.save).toHaveBeenCalledOnce();
  });
});
