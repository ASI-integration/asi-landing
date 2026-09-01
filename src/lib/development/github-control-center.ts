import 'server-only';
import { isExactGitSha } from './baseline-sha';
import { parseAllowlistedPullRequestUrl } from './pr-url';
import type {
  ControlCenterMergeDependencies,
  ControlCenterPullRequest,
  OwnerDecisionBusRecord,
} from './owner-merge-gate';
import { OWNER_DECISION_BUS_ISSUE_NUMBER } from './owner-merge-gate';
import {
  DEVELOPMENT_REPOSITORY_ALLOWLIST,
  type DevelopmentRepositoryDefinition,
} from './repositories';

const API_VERSION = '2022-11-28';

export class GitHubProviderReadinessError extends Error {
  constructor(public readonly code:
    | 'github_provider_missing'
    | 'github_provider_unauthenticated'
    | 'github_provider_repository_mismatch'
    | 'github_provider_unreachable') {
    super(code);
  }
}

export class GitHubControlCenterError extends Error {
  constructor(
    public readonly code:
      | 'pull_request_invalid'
      | 'pull_request_unavailable'
      | 'owner_gate_unavailable'
      | 'merge_provider_not_configured'
      | 'merge_provider_rejected',
    public readonly status: number,
  ) {
    super(code);
  }
}

function parsePullRequestUrl(value: string): {
  safeUrl: string;
  repository: DevelopmentRepositoryDefinition['fullName'];
  owner: DevelopmentRepositoryDefinition['githubOwner'];
  repo: DevelopmentRepositoryDefinition['githubRepo'];
  pullRequestNumber: number;
} {
  const parsed = parseAllowlistedPullRequestUrl(value);
  if (!parsed) throw new GitHubControlCenterError('pull_request_invalid', 400);
  return {
    safeUrl: parsed.safeUrl,
    repository: parsed.repository.fullName,
    owner: parsed.repository.githubOwner,
    repo: parsed.repository.githubRepo,
    pullRequestNumber: parsed.pullRequestNumber,
  };
}

function headers(token?: string): HeadersInit {
  return {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'asi-owner-development-console',
    'X-GitHub-Api-Version': API_VERSION,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/** Non-destructive authenticated probe for the selected allowlisted repository. */
export async function probeGitHubMergeProvider(
  repository: DevelopmentRepositoryDefinition = DEVELOPMENT_REPOSITORY_ALLOWLIST[0],
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const token = String(process.env.GITHUB_TOKEN ?? '').trim();
  if (!token) throw new GitHubProviderReadinessError('github_provider_missing');

  let response: Response;
  try {
    response = await fetchImpl(
      `https://api.github.com/repos/${repository.githubOwner}/${repository.githubRepo}`,
      {
      method: 'GET',
      headers: headers(token),
      cache: 'no-store',
      signal: AbortSignal.timeout(5_000),
    },
    );
  } catch {
    throw new GitHubProviderReadinessError('github_provider_unreachable');
  }
  if (response.status === 401 || response.status === 403) {
    throw new GitHubProviderReadinessError('github_provider_unauthenticated');
  }
  if (!response.ok) throw new GitHubProviderReadinessError('github_provider_unreachable');

  const payload = await responseJson(response);
  if (payload.full_name !== repository.fullName) {
    throw new GitHubProviderReadinessError('github_provider_repository_mismatch');
  }
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const value = await response.json();
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

export async function loadControlCenterPullRequest(
  pullRequestUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ControlCenterPullRequest> {
  const parsed = parsePullRequestUrl(pullRequestUrl);
  let response: Response;
  try {
    response = await fetchImpl(
      `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/pulls/${parsed.pullRequestNumber}`,
      { method: 'GET', headers: headers(), cache: 'no-store' },
    );
  } catch {
    throw new GitHubControlCenterError('pull_request_unavailable', 502);
  }
  if (!response.ok) throw new GitHubControlCenterError('pull_request_unavailable', 502);
  const payload = await responseJson(response);
  const head = payload.head && typeof payload.head === 'object' && !Array.isArray(payload.head)
    ? payload.head as Record<string, unknown>
    : {};
  const headSha = String(head.sha ?? '').trim().toLowerCase();
  if (!isExactGitSha(headSha)) throw new GitHubControlCenterError('pull_request_unavailable', 502);
  return {
    repository: parsed.repository,
    pullRequestNumber: parsed.pullRequestNumber,
    pullRequestUrl: parsed.safeUrl,
    headSha,
    merged: payload.merged === true,
    mergeCommitSha: isExactGitSha(String(payload.merge_commit_sha ?? ''))
      ? String(payload.merge_commit_sha)
      : null,
  };
}

async function loadBodies(
  url: string,
  sourcePrefix: string,
  fetchImpl: typeof fetch,
): Promise<OwnerDecisionBusRecord[]> {
  const records: OwnerDecisionBusRecord[] = [];
  for (let page = 1; page <= 20; page += 1) {
    let response: Response;
    try {
      response = await fetchImpl(
        `${url}${url.includes('?') ? '&' : '?'}page=${page}`,
        { method: 'GET', headers: headers(), cache: 'no-store' },
      );
    } catch {
      throw new GitHubControlCenterError('owner_gate_unavailable', 502);
    }
    if (!response.ok) throw new GitHubControlCenterError('owner_gate_unavailable', 502);
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new GitHubControlCenterError('owner_gate_unavailable', 502);
    }
    if (!Array.isArray(payload)) throw new GitHubControlCenterError('owner_gate_unavailable', 502);
    records.push(...payload.flatMap((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
      const row = item as Record<string, unknown>;
      const user = row.user && typeof row.user === 'object' && !Array.isArray(row.user)
        ? row.user as Record<string, unknown>
        : {};
      if (user.login !== 'ASI-integration') return [];
      if (typeof row.body !== 'string' || row.body.trim().length === 0) return [];
      const id = String(row.id ?? row.node_id ?? 'unknown');
      return [{ sourceId: `${sourcePrefix}:${id}`, body: row.body }];
    }));
    if (payload.length < 100) break;
  }
  return records;
}

export async function loadOwnerDecisionBusRecords(
  pullRequest: ControlCenterPullRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<OwnerDecisionBusRecord[]> {
  const parsed = parsePullRequestUrl(pullRequest.pullRequestUrl);
  const root = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}`;
  const [busComments, pullRequestComments, reviews] = await Promise.all([
    loadBodies(`${root}/issues/${OWNER_DECISION_BUS_ISSUE_NUMBER}/comments?per_page=100`, 'owner-bus', fetchImpl),
    loadBodies(`${root}/issues/${parsed.pullRequestNumber}/comments?per_page=100`, 'pr-comment', fetchImpl),
    loadBodies(`${root}/pulls/${parsed.pullRequestNumber}/reviews?per_page=100`, 'pr-review', fetchImpl),
  ]);
  return [...busComments, ...pullRequestComments, ...reviews];
}

export async function mergeControlCenterPullRequest(
  pullRequest: ControlCenterPullRequest,
  exactHeadSha: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ merged: true; deduplicated: boolean; mergeCommitSha: string | null }> {
  if (pullRequest.merged) {
    return { merged: true, deduplicated: true, mergeCommitSha: pullRequest.mergeCommitSha };
  }
  if (!isExactGitSha(exactHeadSha)) throw new GitHubControlCenterError('merge_provider_rejected', 409);
  const token = String(process.env.GITHUB_TOKEN ?? '').trim();
  if (!token) throw new GitHubControlCenterError('merge_provider_not_configured', 503);
  const parsed = parsePullRequestUrl(pullRequest.pullRequestUrl);
  let response: Response;
  try {
    response = await fetchImpl(
      `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/pulls/${parsed.pullRequestNumber}/merge`,
      {
        method: 'PUT',
        headers: { ...headers(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ sha: exactHeadSha }),
        cache: 'no-store',
      },
    );
  } catch {
    throw new GitHubControlCenterError('merge_provider_rejected', 502);
  }
  const payload = await responseJson(response);
  if (response.ok && payload.merged === true) {
    return {
      merged: true,
      deduplicated: false,
      mergeCommitSha: isExactGitSha(String(payload.sha ?? '')) ? String(payload.sha) : null,
    };
  }

  if (response.status === 405 || response.status === 409) {
    const current = await loadControlCenterPullRequest(pullRequest.pullRequestUrl, fetchImpl);
    if (current.merged && current.headSha === exactHeadSha) {
      return { merged: true, deduplicated: true, mergeCommitSha: current.mergeCommitSha };
    }
  }
  throw new GitHubControlCenterError('merge_provider_rejected', response.status >= 500 ? 502 : 409);
}

export const controlCenterMergeDependencies: ControlCenterMergeDependencies = {
  loadPullRequest: loadControlCenterPullRequest,
  loadOwnerDecisionRecords: loadOwnerDecisionBusRecords,
  mergePullRequest: mergeControlCenterPullRequest,
};
