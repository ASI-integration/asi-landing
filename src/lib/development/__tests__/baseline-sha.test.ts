import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isExactGitSha, resolveAllowlistedBaselineSha } from '../baseline-sha';
import { DEVELOPMENT_REPOSITORY_ALLOWLIST } from '../repositories';

vi.mock('server-only', () => ({}));

describe('baseline SHA helpers', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubEnv('GITHUB_TOKEN', '');
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

  it('resolves the landing main SHA without authentication when the token is absent', async () => {
    const sha = 'b'.repeat(40);
    const fetchImpl = vi.fn(async (_input: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) =>
      new Response(JSON.stringify({ sha }), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    const resolved = await resolveAllowlistedBaselineSha(DEVELOPMENT_REPOSITORY_ALLOWLIST[0], fetchImpl as typeof fetch);
    expect(resolved).toBe(sha);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.github.com/repos/ASI-integration/asi-landing/commits/main',
      expect.objectContaining({ method: 'GET', cache: 'no-store' }),
    );
    expect(fetchImpl.mock.calls[0]?.[1]?.headers).not.toHaveProperty('Authorization');
  });

  it('authenticates the asi-os-runtime main SHA request without placing the token in the URL', async () => {
    const token = 'github-token-for-test';
    const sha = 'c'.repeat(40);
    vi.stubEnv('GITHUB_TOKEN', token);
    const fetchImpl = vi.fn(async (_input: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) =>
      new Response(JSON.stringify({ sha }), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    const runtimeRepository = DEVELOPMENT_REPOSITORY_ALLOWLIST.find(({ id }) => id === 'asi-os-runtime');
    expect(runtimeRepository).toBeDefined();

    const resolved = await resolveAllowlistedBaselineSha(runtimeRepository!, fetchImpl as typeof fetch);

    expect(resolved).toBe(sha);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.github.com/repos/ASI-integration/asi-os-runtime/commits/main',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: `Bearer ${token}` }),
      }),
    );
    expect(String(fetchImpl.mock.calls[0]?.[0])).not.toContain(token);
  });

  it('rejects malformed SHA from GitHub', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ sha: 'SHORT' }), { status: 200 }),
    );
    await expect(
      resolveAllowlistedBaselineSha(DEVELOPMENT_REPOSITORY_ALLOWLIST[0], fetchImpl as typeof fetch),
    ).rejects.toMatchObject({ code: 'baseline_sha_invalid' });
  });

  it('maps a non-OK GitHub response to baseline_sha_unavailable', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 404 }));

    await expect(
      resolveAllowlistedBaselineSha(DEVELOPMENT_REPOSITORY_ALLOWLIST[1], fetchImpl as typeof fetch),
    ).rejects.toMatchObject({ code: 'baseline_sha_unavailable' });
  });
});
