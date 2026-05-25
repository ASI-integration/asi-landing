import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.resetModules();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.clearAllMocks();
  vi.resetModules();
});

describe('/api/auth/session', () => {
  it('returns empty session when SESSION_SECRET is not configured', async () => {
    delete process.env.SESSION_SECRET;

    vi.doMock('next/headers', () => ({
      headers: () => ({
        get: () => '',
      }),
    }));

    const mod = await import('../route');
    const res = await mod.GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ user: null, subscription: null, account: null });
  });
});
