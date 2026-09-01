import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEVELOPMENT_REPOSITORY_ALLOWLIST } from '../repositories';
import {
  GitHubControlCenterError,
  GitHubProviderReadinessError,
  loadControlCenterPullRequest,
  loadOwnerDecisionBusRecords,
  mergeControlCenterPullRequest,
  probeGitHubMergeProvider,
} from '../github-control-center';

vi.mock('server-only', () => ({}));

const landing = DEVELOPMENT_REPOSITORY_ALLOWLIST[0];
const runtime = DEVELOPMENT_REPOSITORY_ALLOWLIST[1];
const headSha = 'a'.repeat(40);

beforeEach(() => {
  vi.stubEnv('GITHUB_TOKEN', 'github-test-token');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('probeGitHubMergeProvider', () => {
  it('probes only the selected asi-landing repository', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toBe('https://api.github.com/repos/ASI-integration/asi-landing');
      return new Response(JSON.stringify({ full_name: 'ASI-integration/asi-landing' }), { status: 200 });
    });

    await probeGitHubMergeProvider(landing, fetchImpl as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('probes only the selected asi-os-runtime repository', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toBe('https://api.github.com/repos/ASI-integration/asi-os-runtime');
      return new Response(JSON.stringify({ full_name: 'ASI-integration/asi-os-runtime' }), { status: 200 });
    });

    await probeGitHubMergeProvider(runtime, fetchImpl as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('does not couple landing readiness to runtime availability', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('asi-os-runtime')) {
        return new Response('missing', { status: 404 });
      }
      return new Response(JSON.stringify({ full_name: 'ASI-integration/asi-landing' }), { status: 200 });
    });

    await expect(probeGitHubMergeProvider(landing, fetchImpl as typeof fetch)).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0][0])).not.toContain('asi-os-runtime');
  });
});

describe('loadControlCenterPullRequest', () => {
  it('resolves an ASI-integration/asi-landing PR with exact owner/repo identity', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toBe('https://api.github.com/repos/ASI-integration/asi-landing/pulls/241');
      return new Response(JSON.stringify({
        merged: false,
        head: { sha: headSha },
        merge_commit_sha: null,
      }), { status: 200 });
    });

    const pullRequest = await loadControlCenterPullRequest(
      'https://github.com/ASI-integration/asi-landing/pull/241',
      fetchImpl as typeof fetch,
    );
    expect(pullRequest).toMatchObject({
      repository: 'ASI-integration/asi-landing',
      pullRequestNumber: 241,
      headSha,
    });
  });

  it('resolves an ASI-integration/asi-os-runtime PR with exact owner/repo identity', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toBe('https://api.github.com/repos/ASI-integration/asi-os-runtime/pulls/60');
      return new Response(JSON.stringify({
        merged: false,
        head: { sha: headSha },
        merge_commit_sha: null,
      }), { status: 200 });
    });

    const pullRequest = await loadControlCenterPullRequest(
      'https://github.com/ASI-integration/asi-os-runtime/pull/60',
      fetchImpl as typeof fetch,
    );
    expect(pullRequest).toMatchObject({
      repository: 'ASI-integration/asi-os-runtime',
      pullRequestNumber: 60,
      headSha,
    });
  });

  it('rejects a non-allowlisted repository PR', async () => {
    const fetchImpl = vi.fn();
    await expect(
      loadControlCenterPullRequest(
        'https://github.com/ASI-integration/other-repo/pull/1',
        fetchImpl as typeof fetch,
      ),
    ).rejects.toMatchObject({ code: 'pull_request_invalid' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a forged repository id in the PR URL', async () => {
    const fetchImpl = vi.fn();
    await expect(
      loadControlCenterPullRequest(
        'https://github.com/evil/asi-landing/pull/1',
        fetchImpl as typeof fetch,
      ),
    ).rejects.toMatchObject({ code: 'pull_request_invalid' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('owner gate and merge dependency routing', () => {
  it('routes owner-gate and merge calls through the runtime repository identity', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      calls.push(url);
      if (url.includes('/pulls/60/reviews')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (url.endsWith('/pulls/60') || url.includes('/pulls/60?')) {
        return new Response(JSON.stringify({
          merged: false,
          head: { sha: headSha },
          merge_commit_sha: null,
        }), { status: 200 });
      }
      if (url.includes('/comments')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response('[]', { status: 404 });
    });

    const pullRequest = await loadControlCenterPullRequest(
      'https://github.com/ASI-integration/asi-os-runtime/pull/60',
      fetchImpl as typeof fetch,
    );
    await loadOwnerDecisionBusRecords(pullRequest, fetchImpl as typeof fetch);

    expect(calls.some((url) => url.includes('/repos/ASI-integration/asi-os-runtime/'))).toBe(true);
    expect(calls.some((url) => url.includes('/repos/ASI-integration/asi-landing/'))).toBe(false);
  });

  it('merges through the exact runtime repository endpoint', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/merge') && init?.method === 'PUT') {
        return new Response(JSON.stringify({ merged: true, sha: headSha }), { status: 200 });
      }
      return new Response(JSON.stringify({
        merged: false,
        head: { sha: headSha },
        merge_commit_sha: null,
      }), { status: 200 });
    });

    const pullRequest = await loadControlCenterPullRequest(
      'https://github.com/ASI-integration/asi-os-runtime/pull/60',
      fetchImpl as typeof fetch,
    );
    const result = await mergeControlCenterPullRequest(pullRequest, headSha, fetchImpl as typeof fetch);

    expect(result.merged).toBe(true);
    expect(fetchImpl.mock.calls.some(([url, init]) =>
      String(url) === 'https://api.github.com/repos/ASI-integration/asi-os-runtime/pulls/60/merge'
      && init?.method === 'PUT')).toBe(true);
  });
});

describe('GitHub provider readiness errors', () => {
  it('fails closed when the token is missing', async () => {
    vi.stubEnv('GITHUB_TOKEN', '');
    await expect(probeGitHubMergeProvider(landing)).rejects.toBeInstanceOf(GitHubProviderReadinessError);
  });

  it('fails closed on repository mismatch', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ full_name: 'ASI-integration/other-repo' }), { status: 200 }),
    );
    await expect(probeGitHubMergeProvider(landing, fetchImpl as typeof fetch)).rejects.toMatchObject({
      code: 'github_provider_repository_mismatch',
    });
  });

  it('maps unavailable GitHub API to pull_request_unavailable', async () => {
    const fetchImpl = vi.fn(async () => new Response('offline', { status: 502 }));
    await expect(
      loadControlCenterPullRequest(
        'https://github.com/ASI-integration/asi-landing/pull/1',
        fetchImpl as typeof fetch,
      ),
    ).rejects.toBeInstanceOf(GitHubControlCenterError);
  });
});
