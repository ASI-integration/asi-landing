import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isExactGitSha, resolveAllowlistedBaselineSha } from '../baseline-sha';
import { DEVELOPMENT_REPOSITORY_ALLOWLIST } from '../repositories';

vi.mock('server-only', () => ({}));

describe('baseline SHA helpers', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('accepts exact 40 lowercase hex SHA values', () => {
    expect(isExactGitSha('a'.repeat(40))).toBe(true);
    expect(isExactGitSha('A'.repeat(40))).toBe(false);
    expect(isExactGitSha('a'.repeat(39))).toBe(false);
    expect(isExactGitSha('g'.repeat(40))).toBe(false);
  });

  it('resolves the server-side baseline SHA for an allowlisted repository', async () => {
    const sha = 'b'.repeat(40);
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ sha }), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    const resolved = await resolveAllowlistedBaselineSha(DEVELOPMENT_REPOSITORY_ALLOWLIST[0], fetchImpl as typeof fetch);
    expect(resolved).toBe(sha);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.github.com/repos/ASI-integration/asi-landing/commits/main',
      expect.objectContaining({ method: 'GET', cache: 'no-store' }),
    );
  });

  it('resolves baseline SHA for asi-os-runtime using the server allowlist', async () => {
    const sha = 'c'.repeat(40);
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ sha }), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    const resolved = await resolveAllowlistedBaselineSha(DEVELOPMENT_REPOSITORY_ALLOWLIST[1], fetchImpl as typeof fetch);
    expect(resolved).toBe(sha);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.github.com/repos/ASI-integration/asi-os-runtime/commits/main',
      expect.objectContaining({ method: 'GET', cache: 'no-store' }),
    );
  });

  it('rejects malformed SHA from GitHub', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ sha: 'SHORT' }), { status: 200 }),
    );
    await expect(
      resolveAllowlistedBaselineSha(DEVELOPMENT_REPOSITORY_ALLOWLIST[0], fetchImpl as typeof fetch),
    ).rejects.toMatchObject({ code: 'baseline_sha_invalid' });
  });
});
