import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isExactGitSha, resolveAllowlistedBaselineSha } from '../baseline-sha';
import { DEVELOPMENT_REPOSITORY_ALLOWLIST } from '../repositories';

vi.mock('server-only', () => ({}));

const TOKEN = 'github-test-token-never-exposed';

describe('baseline SHA helpers', () => {
  beforeEach(() => {
    process.env.GITHUB_TOKEN = TOKEN;
    vi.restoreAllMocks();
  });

  afterEach(() => {
    delete process.env.GITHUB_TOKEN;
    vi.restoreAllMocks();
  });

  it('accepts exact 40 lowercase hex SHA values', () => {
    expect(isExactGitSha('a'.repeat(40))).toBe(true);
    expect(isExactGitSha('A'.repeat(40))).toBe(false);
    expect(isExactGitSha('a'.repeat(39))).toBe(false);
    expect(isExactGitSha('g'.repeat(40))).toBe(false);
  });

  it('A: resolves the authenticated landing baseline SHA', async () => {
    const sha = 'b'.repeat(40);
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ Authorization: `Bearer ${TOKEN}` });
      return new Response(JSON.stringify({ sha }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const resolved = await resolveAllowlistedBaselineSha(DEVELOPMENT_REPOSITORY_ALLOWLIST[0], fetchImpl as typeof fetch);
    expect(resolved).toBe(sha);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.github.com/repos/ASI-integration/asi-landing/commits/main',
      expect.objectContaining({ method: 'GET', cache: 'no-store' }),
    );
    expect(JSON.stringify({ resolved })).not.toContain(TOKEN);
  });

  it('B: resolves the authenticated private runtime baseline SHA', async () => {
    const sha = 'c'.repeat(40);
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ Authorization: `Bearer ${TOKEN}` });
      return new Response(JSON.stringify({ sha }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const resolved = await resolveAllowlistedBaselineSha(DEVELOPMENT_REPOSITORY_ALLOWLIST[1], fetchImpl as typeof fetch);
    expect(resolved).toBe(sha);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.github.com/repos/ASI-integration/asi-os-runtime/commits/main',
      expect.objectContaining({ method: 'GET', cache: 'no-store' }),
    );
  });

  it('C: fails closed when GITHUB_TOKEN is missing', async () => {
    delete process.env.GITHUB_TOKEN;
    const fetchImpl = vi.fn();
    await expect(
      resolveAllowlistedBaselineSha(DEVELOPMENT_REPOSITORY_ALLOWLIST[0], fetchImpl as typeof fetch),
    ).rejects.toMatchObject({ code: 'baseline_sha_unavailable' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('D: never exposes the token in thrown errors', async () => {
    const fetchImpl = vi.fn(async () => new Response('forbidden', { status: 403 }));
    await expect(
      resolveAllowlistedBaselineSha(DEVELOPMENT_REPOSITORY_ALLOWLIST[0], fetchImpl as typeof fetch),
    ).rejects.toMatchObject({ code: 'baseline_sha_unavailable' });
    try {
      await resolveAllowlistedBaselineSha(DEVELOPMENT_REPOSITORY_ALLOWLIST[0], fetchImpl as typeof fetch);
    } catch (error) {
      expect(String(error)).not.toContain(TOKEN);
    }
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
