import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isRu: vi.fn(), getSession: vi.fn(), save: vi.fn(),
}));
vi.mock('@/lib/getIsRuHost', () => ({ getIsRuHost: mocks.isRu }));
vi.mock('@/lib/auth', () => ({ getSession: mocks.getSession }));

import { GET } from '@/app/api/auth/yandex/start/route';

const origin = 'https://www.asi-global.ru';
function startRequest(mode: 'login' | 'link', headers: Record<string, string>): Request {
  const modeQuery = mode === 'link' ? '?mode=link' : '';
  return new Request(origin + '/api/auth/yandex/start' + modeQuery, { headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('ASI_RU_YANDEX_ID_ENABLED', 'true');
  vi.stubEnv('ASI_RU_YANDEX_LINKS_READY', 'true');
  vi.stubEnv('ASI_RU_YANDEX_ORIGIN', origin);
  vi.stubEnv('ASI_RU_YANDEX_CLIENT_ID', 'test-client');
  vi.stubEnv('ASI_RU_YANDEX_CLIENT_SECRET', 'test-inert-secret');
  vi.stubEnv('SESSION_SECRET', 'test-session-secret-at-least-32-characters');
  vi.stubEnv('SUPABASE_URL', 'https://fixture.invalid');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'inert-test-role-key');
  mocks.isRu.mockResolvedValue(true);
  mocks.save.mockResolvedValue(undefined);
  mocks.getSession.mockImplementation(async () => ({ save: mocks.save }));
});
afterEach(() => { vi.unstubAllEnvs(); });

describe('Yandex start rejects unsolicited login CSRF as well as linking CSRF', () => {
  it.each(['login', 'link'] as const)(
    'denies cross-site %s GET before touching session or contacting Yandex',
    async (mode) => {
      const res = await GET(startRequest(mode, {
        'sec-fetch-site': 'cross-site', referer: origin + '/login',
      }));
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ ok: false, error: 'YANDEX_START_ORIGIN_REJECTED' });
      expect(mocks.getSession).not.toHaveBeenCalled();
      expect(mocks.save).not.toHaveBeenCalled();
    },
  );

  it.each(['login', 'link'] as const)(
    'denies same-site subdomain and absent navigation provenance for %s',
    async (mode) => {
      const hostileHeaders: Array<Record<string, string>> = [
        { 'sec-fetch-site': 'same-site' },
        { 'sec-fetch-site': 'none' },
        {},
        { referer: 'https://asi-global.ru/login' },
      ];
      for (const headers of hostileHeaders) {
        const response = await GET(startRequest(mode, headers));
        expect(response.status).toBe(403);
      }
      expect(mocks.getSession).not.toHaveBeenCalled();
    },
  );

  it.each([
    'mode=', 'mode=Link', 'mode=unknown', 'mode=link&mode=login', 'mode=login&mode=link',
  ])('rejects ambiguous or unknown Yandex start mode before session mutation: %s', async (query) => {
    const response = await GET(new Request(origin + '/api/auth/yandex/start?' + query, {
      headers: { 'sec-fetch-site': 'same-origin' },
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: 'YANDEX_INVALID_MODE' });
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('allows one explicit login mode without requiring an existing owner session', async () => {
    const response = await GET(new Request(origin + '/api/auth/yandex/start?mode=login', {
      headers: { 'sec-fetch-site': 'same-origin' },
    }));
    expect(response.status).toBe(307);
    expect(new URL(response.headers.get('location')!).origin).toBe('https://oauth.yandex.ru');
    expect(mocks.save).toHaveBeenCalledOnce();
  });

  it('retains normal same-origin first-party Yandex login redirect with fresh state/PKCE', async () => {
    const res = await GET(startRequest('login', { 'sec-fetch-site': 'same-origin' }));
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get('location')!);
    expect(location.origin).toBe('https://oauth.yandex.ru');
    expect(location.searchParams.get('response_type')).toBe('code');
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    expect(location.searchParams.get('scope')).toBe('login:info');
    expect(location.searchParams.get('state')).toMatch(/^[a-zA-Z0-9_-]{43}$/);
    expect(mocks.getSession).toHaveBeenCalledOnce();
    expect(mocks.save).toHaveBeenCalledOnce();
  });

  it('allows legacy browsers with exact first-party Referer, not arbitrary referers', async () => {
    const res = await GET(startRequest('login', { referer: origin + '/login' }));
    expect(res.status).toBe(307);
    expect(mocks.save).toHaveBeenCalledOnce();
  });

  it('still requires a fresh identity-bound proof for account linking', async () => {
    mocks.getSession.mockResolvedValueOnce({ userId: 'user-a', save: mocks.save });
    const res = await GET(startRequest('link', { 'sec-fetch-site': 'same-origin' }));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('recent_auth_required');
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
