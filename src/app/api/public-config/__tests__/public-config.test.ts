import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type PublicConfig = {
  googleClientId: string;
  googleOAuthConfigured: boolean;
  googleOAuthEnv: string;
  googleOAuthMode: 'redirect' | 'gis' | 'disabled';
};

const ORIGINAL_ENV = { ...process.env };

async function runGet(sessionOk: boolean) {
  vi.resetModules();
  vi.doMock('@/lib/auth', () => ({
    isSessionSecretConfigured: () => sessionOk,
  }));

  const mod = await import('../route');
  const res = await mod.GET();
  const json = (await res.json()) as PublicConfig;
  return { res, json };
}

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.clearAllMocks();
  vi.resetModules();
});

describe('/api/public-config', () => {
  it('returns googleOAuthConfigured=true when env present', async () => {
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    delete process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;

    const { json } = await runGet(true);

    expect(json.googleClientId).toBe('test-client-id');
    expect(json.googleOAuthConfigured).toBe(true);
    expect(json.googleOAuthMode).toBe('gis');
    expect(json.googleOAuthEnv).toBe('ready_gis');
  });

  it('returns disabled state when env missing', async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;

    const { json } = await runGet(true);

    expect(json.googleClientId).toBe('');
    expect(json.googleOAuthConfigured).toBe(false);
    expect(json.googleOAuthMode).toBe('disabled');
    expect(json.googleOAuthEnv).toBe('missing_client_id');
  });
});

