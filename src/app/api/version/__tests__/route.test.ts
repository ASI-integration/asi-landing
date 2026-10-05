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

  it('falls back to Vercel commit metadata when release-meta.json is unavailable', async () => {
    process.env = {
      ...process.env,
      ASI_DEPLOY_ENV: '',
      VERCEL_ENV: 'production',
      VERCEL_GIT_COMMIT_SHA: 'vercel-sha-123',
      ASI_RELEASE_DEPLOYED_AT_ISO: '',
      ASI_RELEASE_PATH: '',
    };

    vi.doMock('@/lib/runtimeRelease', () => ({
      resolveRuntimeReleaseInfo: () => {
        throw new Error('ENOENT release-meta.json');
      },
    }));

    const mod = await import('../route');
    const res = await mod.GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toMatchObject({
      environment: 'production',
      sha: 'vercel-sha-123',
      appRoot: null,
      releaseMetaPath: null,
      resolvedReleasePath: null,
    });
    expect(typeof json.processCwd).toBe('string');
  });

  it('keeps non-Vercel release metadata failures fail-closed', async () => {
    process.env = {
      ...process.env,
      VERCEL_GIT_COMMIT_SHA: '',
    };

    vi.doMock('@/lib/runtimeRelease', () => ({
      resolveRuntimeReleaseInfo: () => {
        throw new Error('release metadata unavailable');
      },
    }));

    const mod = await import('../route');
    await expect(mod.GET()).rejects.toThrow('release metadata unavailable');
  });
});
