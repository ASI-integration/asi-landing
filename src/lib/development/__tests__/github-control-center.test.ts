import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loadControlCenterPullRequest,
  loadOwnerDecisionBusRecords,
} from '../github-control-center';
import { resolveAllowlistedPullRequestIdentity } from '../pr-url';
import { isExactGitSha } from '../baseline-sha';

vi.mock('server-only', () => ({}));

const TOKEN = 'github-test-token-never-exposed';
const LANDING_SHA = 'a'.repeat(40);
const RUNTIME_SHA = 'b'.repeat(40);
const LANDING_PR = 'https://github.com/ASI-integration/asi-landing/pull/123';
const RUNTIME_PR = 'https://github.com/ASI-integration/asi-os-runtime/pull/45';

describe('github control center repository identity', () => {
  it('G: resolves landing PR identity from the server allowlist', () => {
    expect(resolveAllowlistedPullRequestIdentity(LANDING_PR)).toMatchObject({
      repository: 'ASI-integration/asi-landing',
      owner: 'ASI-integration',
      repo: 'asi-landing',
      pullRequestNumber: 123,
    });
  });

  it('H: resolves runtime PR identity from the server allowlist', () => {
    expect(resolveAllowlistedPullRequestIdentity(RUNTIME_PR)).toMatchObject({
      repository: 'ASI-integration/asi-os-runtime',
      owner: 'ASI-integration',
      repo: 'asi-os-runtime',
      pullRequestNumber: 45,
    });
  });

  it('I: rejects non-allowlisted PR URLs', () => {
    expect(() => resolveAllowlistedPullRequestIdentity(
      'https://github.com/ASI-integration/other-repo/pull/1',
    )).toThrow('pull_request_invalid');
  });
});

describe('github control center authenticated reads', () => {
  beforeEach(() => {
    process.env.GITHUB_TOKEN = TOKEN;
    vi.restoreAllMocks();
  });

  afterEach(() => {
    delete process.env.GITHUB_TOKEN;
    vi.restoreAllMocks();
  });

  it('E: loads a runtime PR with authenticated GitHub access', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ Authorization: `Bearer ${TOKEN}` });
      if (url.endsWith('/pulls/45')) {
        return new Response(JSON.stringify({
          head: { sha: RUNTIME_SHA },
          merged: false,
          merge_commit_sha: null,
        }), { status: 200 });
      }
      throw new Error(`unexpected url: ${url}`);
    });

    const pullRequest = await loadControlCenterPullRequest(RUNTIME_PR, fetchImpl as typeof fetch);
    expect(pullRequest).toMatchObject({
      repository: 'ASI-integration/asi-os-runtime',
      pullRequestNumber: 45,
      headSha: RUNTIME_SHA,
    });
    expect(JSON.stringify(pullRequest)).not.toContain(TOKEN);
  });

  it('F: loads runtime owner-decision records with authenticated GitHub access', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ Authorization: `Bearer ${TOKEN}` });
      if (url.includes('/repos/ASI-integration/asi-landing/issues/106/comments')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (url.includes('/repos/ASI-integration/asi-os-runtime/issues/45/comments')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (url.includes('/repos/ASI-integration/asi-os-runtime/pulls/45/reviews')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      throw new Error(`unexpected url: ${url}`);
    });

    const records = await loadOwnerDecisionBusRecords({
      repository: 'ASI-integration/asi-os-runtime',
      pullRequestNumber: 45,
      pullRequestUrl: RUNTIME_PR,
      headSha: RUNTIME_SHA,
      merged: false,
      mergeCommitSha: null,
    }, fetchImpl as typeof fetch);

    expect(records).toEqual([]);
    expect(fetchImpl.mock.calls.map(([url]) => String(url))).toEqual(expect.arrayContaining([
      expect.stringContaining('/repos/ASI-integration/asi-landing/issues/106/comments'),
      expect.stringContaining('/repos/ASI-integration/asi-os-runtime/issues/45/comments'),
      expect.stringContaining('/repos/ASI-integration/asi-os-runtime/pulls/45/reviews'),
    ]));
    expect(fetchImpl.mock.calls.some(([url]) =>
      String(url).includes('/repos/ASI-integration/asi-os-runtime/issues/106/comments'),
    )).toBe(false);
    expect(fetchImpl.mock.calls.every(([, init]) => {
      const headers = init?.headers as Record<string, string> | undefined;
      return headers?.Authorization === `Bearer ${TOKEN}`;
    })).toBe(true);
    expect(JSON.stringify(records)).not.toContain(TOKEN);
  });

  it('reads Runtime PR decisions without requiring Runtime issue #106', async () => {
    const approvalBody = [
      '```json',
      JSON.stringify({
        schemaVersion: 'asi.agent-os.owner-gate.v1',
        taskId: 'runtime-merge-45',
        status: 'approved',
        action: 'merge',
        target: 'ASI-integration/asi-os-runtime#45',
        identity: { sha: RUNTIME_SHA },
        allowedSideEffect: 'Merge only the exact reviewed PR head into main.',
        postActionVerification: ['GitHub reports the PR merged at the reviewed head SHA.'],
        authorization: {
          source: 'explicit_owner_message',
          owner: 'Nikolay',
          scope: 'Approve merge for the exact reviewed PR head.',
          taskCycle: 'runtime-merge-45',
        },
        typedConfirmation: { present: false, countsAsOwnerApproval: false },
      }),
      '```',
    ].join('\n');

    const fetchImpl = vi.fn(async (url: string) => {
      const href = String(url);
      if (href.includes('/repos/ASI-integration/asi-os-runtime/issues/106/comments')) {
        throw new Error('must not query Runtime owner-bus issue #106');
      }
      if (href.includes('/repos/ASI-integration/asi-landing/issues/106/comments')) {
        // Production-shaped gap: landing bus may be empty or absent; PR comments remain valid.
        return new Response('Not Found', { status: 404 });
      }
      if (href.includes('/repos/ASI-integration/asi-os-runtime/issues/45/comments')) {
        return new Response(JSON.stringify([
          { id: 9001, body: approvalBody, user: { login: 'ASI-integration' } },
        ]), { status: 200 });
      }
      if (href.includes('/repos/ASI-integration/asi-os-runtime/pulls/45/reviews')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      throw new Error(`unexpected url: ${href}`);
    });

    const records = await loadOwnerDecisionBusRecords({
      repository: 'ASI-integration/asi-os-runtime',
      pullRequestNumber: 45,
      pullRequestUrl: RUNTIME_PR,
      headSha: RUNTIME_SHA,
      merged: false,
      mergeCommitSha: null,
    }, fetchImpl as typeof fetch);

    expect(records).toEqual([
      { sourceId: 'pr-comment:9001', body: approvalBody },
    ]);
  });

  it('keeps fail-closed GitHub/transport errors for required PR decision sources', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      const href = String(url);
      if (href.includes('/repos/ASI-integration/asi-landing/issues/106/comments')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (href.includes('/repos/ASI-integration/asi-os-runtime/issues/45/comments')) {
        return new Response('Bad Gateway', { status: 502 });
      }
      if (href.includes('/repos/ASI-integration/asi-os-runtime/pulls/45/reviews')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      throw new Error(`unexpected url: ${href}`);
    });

    await expect(loadOwnerDecisionBusRecords({
      repository: 'ASI-integration/asi-os-runtime',
      pullRequestNumber: 45,
      pullRequestUrl: RUNTIME_PR,
      headSha: RUNTIME_SHA,
      merged: false,
      mergeCommitSha: null,
    }, fetchImpl as typeof fetch)).rejects.toMatchObject({ code: 'owner_gate_unavailable' });
  });

  it('O: preserves exact-head merge protection for both repositories', async () => {
    for (const [prUrl, sha] of [[LANDING_PR, LANDING_SHA], [RUNTIME_PR, RUNTIME_SHA]] as const) {
      const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
        head: { sha },
        merged: false,
        merge_commit_sha: null,
      }), { status: 200 }));
      const pullRequest = await loadControlCenterPullRequest(prUrl, fetchImpl as typeof fetch);
      expect(isExactGitSha(pullRequest.headSha)).toBe(true);
      expect(pullRequest.headSha).toBe(sha);
    }
  });

  it('fails closed when GITHUB_TOKEN is missing', async () => {
    delete process.env.GITHUB_TOKEN;
    await expect(loadControlCenterPullRequest(LANDING_PR, vi.fn() as typeof fetch))
      .rejects.toMatchObject({ code: 'pull_request_unavailable' });
  });
});
