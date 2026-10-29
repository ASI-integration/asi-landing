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
  mocks.isRu.mockResolvedValue(true);
  mocks.save.mockResolvedValue(undefined);
});
afterEach(() => { vi.unstubAllEnvs(); });

describe('RU Yandex OAuth callback cannot cancel a pending flow by CSRF', () => {
  it('leaves a pending link intact on a missing or unrelated state, without provider or DB calls', async () => {
    const session = pendingSession();
    mocks.getSession.mockResolvedValue(session);
    for (const query of ['', '?state=' + 'Z'.repeat(43), '?error=access_denied']) {
      const response = await GET(new Request(origin + '/api/auth/yandex/callback' + query));
      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toContain('yandex_error=invalid_state');
      expect(session.yandexOauthState).toBe(state);
      expect(session.yandexOauthVerifier).toBe('B'.repeat(64));
    }
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.ensure).not.toHaveBeenCalled();
  });

  it('burns a matching-state flow on provider error, so it cannot be reused', async () => {
    const session = pendingSession();
    mocks.getSession.mockResolvedValue(session);
    const response = await GET(new Request(
      origin + '/api/auth/yandex/callback?state=' + state + '&error=access_denied',
    ));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('yandex_error=invalid_state');
    expect(session.yandexOauthState).toBeUndefined();
    expect(session.yandexOauthVerifier).toBeUndefined();
    expect(session.yandexOauthMode).toBeUndefined();
    expect(mocks.save).toHaveBeenCalledOnce();
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
