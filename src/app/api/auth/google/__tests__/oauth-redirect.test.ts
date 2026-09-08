import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getSession = vi.fn();
const isSessionSecretConfigured = vi.fn(() => true);

vi.mock('@/lib/auth', () => ({
  getSession,
  isSessionSecretConfigured,
}));

vi.mock('@/lib/supabase', () => ({
  supabase: { from: vi.fn() },
}));

vi.mock('@/lib/accounts', () => ({
  ensureAccountForUser: vi.fn(),
}));

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  getSession.mockReset();
  isSessionSecretConfigured.mockReset();
  isSessionSecretConfigured.mockReturnValue(true);
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('GOOGLE_CLIENT_ID', 'google-client-id.apps.googleusercontent.com');
  vi.stubEnv('GOOGLE_CLIENT_SECRET', 'google-client-secret-value');
  vi.stubEnv('SESSION_SECRET', 'staging-or-prod-session-secret-32chars!!');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('Google OAuth start redirect_uri', () => {
  it('production APP_URL keeps www callback and stores redirect=/pilot', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://www.asi-global.ru');
    const session = {
      userId: undefined as string | undefined,
      googleOauthState: undefined as string | undefined,
      googleOauthPlan: undefined as unknown,
      googleOauthRedirect: undefined as string | undefined,
      save: vi.fn(async () => undefined),
    };
    getSession.mockResolvedValue(session);

    const { GET } = await import('../start/route');
    const res = await GET(
      new Request('https://www.asi-global.ru/api/auth/google/start?redirect=/pilot'),
    );
    expect(res.status).toBe(307);
    const location = res.headers.get('location')!;
    expect(location.startsWith('https://accounts.google.com/')).toBe(true);
    const authUrl = new URL(location);
    expect(authUrl.searchParams.get('redirect_uri')).toBe(
      'https://www.asi-global.ru/api/auth/google/callback',
    );
    expect(session.googleOauthRedirect).toBe('/pilot');
    expect(session.save).toHaveBeenCalled();
  });

  it('staging APP_URL uses staging callback and stores redirect=/pilot', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://staging.asi-global.ru');
    const session = {
      userId: undefined as string | undefined,
      googleOauthState: undefined as string | undefined,
      googleOauthPlan: undefined as unknown,
      googleOauthRedirect: undefined as string | undefined,
      save: vi.fn(async () => undefined),
    };
    getSession.mockResolvedValue(session);

    const { GET } = await import('../start/route');
    const res = await GET(
      new Request('https://staging.asi-global.ru/api/auth/google/start?redirect=/pilot', {
        headers: {
          host: 'staging.asi-global.ru',
          'x-forwarded-proto': 'https',
        },
      }),
    );
    expect(res.status).toBe(307);
    const authUrl = new URL(res.headers.get('location')!);
    expect(authUrl.searchParams.get('redirect_uri')).toBe(
      'https://staging.asi-global.ru/api/auth/google/callback',
    );
    expect(session.googleOauthRedirect).toBe('/pilot');
  });
});

describe('Google OAuth callback uses env-derived redirect_uri', () => {
  it('token exchange uses staging redirect when APP_URL is staging', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://staging.asi-global.ru');
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const session = {
      userId: undefined as string | undefined,
      email: undefined as string | undefined,
      googleOauthState: 'state-abc',
      googleOauthPlan: undefined as unknown,
      googleOauthRedirect: '/pilot',
      save: vi.fn(async () => undefined),
    };
    getSession.mockResolvedValue(session);

    const { GET } = await import('../callback/route');
    const res = await GET(
      new Request(
        'https://staging.asi-global.ru/api/auth/google/callback?code=c&state=state-abc',
        {
          headers: {
            host: 'staging.asi-global.ru',
            'x-forwarded-proto': 'https',
          },
        },
      ),
    );
    expect(res.status).toBe(307);
    expect(fetchMock).toHaveBeenCalled();
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = new URLSearchParams(String(call[1].body));
    expect(body.get('redirect_uri')).toBe(
      'https://staging.asi-global.ru/api/auth/google/callback',
    );
  });

  it('token exchange uses www redirect when APP_URL is production www', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://www.asi-global.ru');
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const session = {
      userId: undefined as string | undefined,
      email: undefined as string | undefined,
      googleOauthState: 'state-www',
      googleOauthPlan: undefined as unknown,
      googleOauthRedirect: '/pilot',
      save: vi.fn(async () => undefined),
    };
    getSession.mockResolvedValue(session);

    const { GET } = await import('../callback/route');
    await GET(
      new Request('https://www.asi-global.ru/api/auth/google/callback?code=c&state=state-www'),
    );
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = new URLSearchParams(String(call[1].body));
    expect(body.get('redirect_uri')).toBe(
      'https://www.asi-global.ru/api/auth/google/callback',
    );
  });
});
