import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV, NODE_ENV: 'production' };
  vi.resetModules();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.clearAllMocks();
  vi.resetModules();
});

describe('/api/health', () => {
  it('returns a simple runtime-independent payload', async () => {
    const mod = await import('../route');
    const res = await mod.GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({
      ok: true,
      nodeEnv: 'production',
      timestamp: expect.any(String),
    });
    expect(json.sha).toBeUndefined();
    expect(Date.parse(json.timestamp)).not.toBeNaN();
  });
});
