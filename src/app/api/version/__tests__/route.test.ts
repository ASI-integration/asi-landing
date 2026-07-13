import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env = {
    ...ORIGINAL_ENV,
    ASI_DEPLOY_ENV: 'staging',
    ASI_APP_VERSION: '0.1.0',
    ASI_RELEASE_DEPLOYED_AT_ISO: '2026-06-04T10:00:00Z',
    ASI_RELEASE_PATH: '/var/www/asi/releases/abc1234',
  };
  vi.resetModules();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.clearAllMocks();
  vi.resetModules();
});

describe('/api/version', () => {
  it('returns release diagnostics from runtime release info', async () => {
    vi.doMock('@/lib/runtimeRelease', () => ({
      resolveRuntimeReleaseInfo: () => ({
        gitSha: 'abc1234',
        appRoot: '/var/www/asi/current',
        cwd: '/var/www/asi/current',
        releaseMetaPath: '/var/www/asi/current/release-meta.json',
        releaseRealPath: '/var/www/asi/releases/abc1234',
      }),
    }));

    const mod = await import('../route');
    const res = await mod.GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({
      environment: 'staging',
      sha: 'abc1234',
      appVersion: '0.1.0',
      deployedAt: '2026-06-04T10:00:00Z',
      releasePath: '/var/www/asi/releases/abc1234',
      appRoot: '/var/www/asi/current',
      processCwd: '/var/www/asi/current',
      releaseMetaPath: '/var/www/asi/current/release-meta.json',
      resolvedReleasePath: '/var/www/asi/releases/abc1234',
    });
  });
});
