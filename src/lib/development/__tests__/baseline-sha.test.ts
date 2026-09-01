import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isExactGitSha, resolveAllowlistedBaselineSha } from '../baseline-sha';
import { DEVELOPMENT_REPOSITORY_ALLOWLIST } from '../repositories';

vi.mock('server-only', () => ({}));

const landing = DEVELOPMENT_REPOSITORY_ALLOWLIST[0];
const runtime = DEVELOPMENT_REPOSITORY_ALLOWLIST[1];
const landingSha = 'a'.repeat(40);
const runtimeSha = 'b'.repeat(40);
const token = 'github-test-token-never-exposed';

describe('baseline SHA helpers', () => {
  beforeEach(() => {
    vi.stubEnv('GITHUB_TOKEN', token);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('accepts exact 40 lowercase hex SHA values', () => {
    expect(isExactGitSha('a'.repeat(40))).toBe(true);
    expect(isExactGitSha('A'.repeat(40))).toBe(false);
    expect(isExactGitSha('a'.repeat(39))).toBe(false);
    expect(isExactGitSha('g'.repeat(40))).toBe(false);
  });

  it('A: resolves authenticated landing baseline to exact main SHA', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ sha: landingSha }), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    const resolved = await resolveAllowlistedBaselineSha(landing, fetchImpl as typeof fetch);
    expect(resolved).toBe(landingSha);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.github.com/repos/ASI-integration/asi-landing/commits/main',
      expect.objectContaining({
        method: 'GET',
        cache: 'no-store',
        headers: expect.objectContaining({ Authorization: `Bearer ${token}` }),
      }),
    );
  });

  it('B: resolves authenticated asi-os-runtime baseline to exact main SHA', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ sha: runtimeSha }), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    const resolved = await resolveAllowlistedBaselineSha(runtime, fetchImpl as typeof fetch);
    expect(resolved).toBe(runtimeSha);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.github.com/repos/ASI-integration/asi-os-runtime/commits/main',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: `Bearer ${token}` }),
      }),
    );
  });

  it('C: sends Authorization but never returns the token outward', async () => {
    const fetchImpl = vi.fn(async (_url, init) => {
      expect((init as RequestInit).headers).toMatchObject({ Authorization: `Bearer ${token}` });
      return new Response(JSON.stringify({ sha: landingSha, token }), { status: 200 });
    });
    const resolved = await resolveAllowlistedBaselineSha(landing, fetchImpl as typeof fetch);
    expect(resolved).toBe(landingSha);
    expect(JSON.stringify(resolved)).not.toContain(token);
  });

  it('D: missing GITHUB_TOKEN fails closed', async () => {
    vi.stubEnv('GITHUB_TOKEN', '');
    const fetchImpl = vi.fn();
    await expect(
      resolveAllowlistedBaselineSha(landing, fetchImpl as typeof fetch),
    ).rejects.toMatchObject({ code: 'baseline_sha_unavailable' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('D: GitHub 401/403/404 fail closed as baseline_sha_unavailable', async () => {
    for (const status of [401, 403, 404]) {
      const fetchImpl = vi.fn(async () => new Response('denied', { status }));
      await expect(
        resolveAllowlistedBaselineSha(runtime, fetchImpl as typeof fetch),
      ).rejects.toMatchObject({ code: 'baseline_sha_unavailable' });
    }
  });

  it('rejects malformed SHA from GitHub', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ sha: 'SHORT' }), { status: 200 }),
    );
    await expect(
      resolveAllowlistedBaselineSha(landing, fetchImpl as typeof fetch),
    ).rejects.toMatchObject({ code: 'baseline_sha_invalid' });
  });
});
