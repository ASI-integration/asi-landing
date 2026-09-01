import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GitHubControlCenterError,
  loadControlCenterPullRequest,
  mergeControlCenterPullRequest,
} from '../github-control-center';
import { DEVELOPMENT_REPOSITORY_ALLOWLIST } from '../repositories';

vi.mock('server-only', () => ({}));

const landing = DEVELOPMENT_REPOSITORY_ALLOWLIST[0];
const runtime = DEVELOPMENT_REPOSITORY_ALLOWLIST[1];
const landingSha = 'a'.repeat(40);
const runtimeSha = 'b'.repeat(40);
const token = 'github-test-token-never-exposed';

describe('GitHub control center repository identity', () => {
  beforeEach(() => {
    vi.stubEnv('GITHUB_TOKEN', token);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('F: resolves runtime PR URL to runtime repository identity', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ head: { sha: runtimeSha }, merged: false }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const loaded = await loadControlCenterPullRequest(
      'https://github.com/ASI-integration/asi-os-runtime/pull/42',
      fetchImpl as typeof fetch,
    );
    expect(loaded).toMatchObject({
      repository: 'ASI-integration/asi-os-runtime',
      pullRequestNumber: 42,
      headSha: runtimeSha,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.github.com/repos/ASI-integration/asi-os-runtime/pulls/42',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: `Bearer ${token}` }),
      }),
    );
    expect(JSON.stringify(loaded)).not.toContain(token);
  });

  it('G: keeps landing PR identity for landing repository', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ head: { sha: landingSha }, merged: false }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const loaded = await loadControlCenterPullRequest(
      'https://github.com/ASI-integration/asi-landing/pull/116',
      fetchImpl as typeof fetch,
    );
    expect(loaded).toMatchObject({
      repository: 'ASI-integration/asi-landing',
      pullRequestNumber: 116,
      headSha: landingSha,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.github.com/repos/ASI-integration/asi-landing/pulls/116',
      expect.any(Object),
    );
  });

  it('H: rejects non-allowlisted GitHub PR URLs', async () => {
    const fetchImpl = vi.fn();
    await expect(
      loadControlCenterPullRequest(
        'https://github.com/ASI-integration/other-repo/pull/1',
        fetchImpl as typeof fetch,
      ),
    ).rejects.toMatchObject({ code: 'pull_request_invalid', status: 400 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('J: exact-head merge protection uses the parsed runtime repository', async () => {
    const pullRequest = {
      repository: runtime.fullName,
      pullRequestNumber: 7,
      pullRequestUrl: 'https://github.com/ASI-integration/asi-os-runtime/pull/7',
      headSha: runtimeSha,
      merged: false,
      mergeCommitSha: null,
    };
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/merge') && init?.method === 'PUT') {
        const body = JSON.parse(String(init.body));
        expect(body.sha).toBe(runtimeSha);
        return new Response(JSON.stringify({ merged: true, sha: 'c'.repeat(40) }), { status: 200 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    const merged = await mergeControlCenterPullRequest(pullRequest, runtimeSha, fetchImpl as typeof fetch);
    expect(merged.merged).toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.github.com/repos/ASI-integration/asi-os-runtime/pulls/7/merge',
      expect.objectContaining({ method: 'PUT' }),
    );
  });

  it('J: exact-head merge protection uses the parsed landing repository', async () => {
    const pullRequest = {
      repository: landing.fullName,
      pullRequestNumber: 123,
      pullRequestUrl: 'https://github.com/ASI-integration/asi-landing/pull/123',
      headSha: landingSha,
      merged: false,
      mergeCommitSha: null,
    };
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/merge') && init?.method === 'PUT') {
        return new Response(JSON.stringify({ merged: true, sha: 'd'.repeat(40) }), { status: 200 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    await mergeControlCenterPullRequest(pullRequest, landingSha, fetchImpl as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.github.com/repos/ASI-integration/asi-landing/pulls/123/merge',
      expect.objectContaining({ method: 'PUT' }),
    );
  });

  it('I: runtime task PR keeps runtime identity through owner gate target matching', async () => {
    const { evaluateControlCenterMergeGate } = await import('../owner-merge-gate');
    const pullRequest = {
      repository: runtime.fullName,
      pullRequestNumber: 55,
      pullRequestUrl: 'https://github.com/ASI-integration/asi-os-runtime/pull/55',
      headSha: runtimeSha,
      merged: false,
      mergeCommitSha: null,
    };
    const gate = evaluateControlCenterMergeGate({
      pullRequest,
      expectedSha: runtimeSha,
      records: [{
        sourceId: 'runtime-approval',
        body: `\`\`\`json\n${JSON.stringify({
          schemaVersion: 'asi.agent-os.owner-gate.v1',
          taskId: 'runtime-merge-task',
          status: 'approved',
          action: 'merge',
          target: 'ASI-integration/asi-os-runtime#55',
          identity: { sha: runtimeSha },
          allowedSideEffect: 'Merge only the exact reviewed PR head into main.',
          postActionVerification: ['GitHub reports the PR merged at the reviewed head SHA.'],
          authorization: {
            source: 'explicit_owner_message',
            owner: 'Nikolay',
            scope: 'Approve merge for the exact reviewed PR head.',
            taskCycle: 'runtime-merge-task',
          },
          typedConfirmation: { present: false, countsAsOwnerApproval: false },
        })}\n\`\`\``,
      }],
    });
    expect(gate).toMatchObject({
      gateState: 'passed',
      mergeState: 'merge_allowed',
      repository: 'ASI-integration/asi-os-runtime',
      pullRequestNumber: 55,
      approvedSha: runtimeSha,
    });
  });

  it('fail-closed when GITHUB_TOKEN is missing for private PR load', async () => {
    vi.stubEnv('GITHUB_TOKEN', '');
    await expect(
      loadControlCenterPullRequest(
        'https://github.com/ASI-integration/asi-os-runtime/pull/42',
        vi.fn() as typeof fetch,
      ),
    ).rejects.toBeInstanceOf(GitHubControlCenterError);
  });
});
