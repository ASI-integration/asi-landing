import 'server-only';
import type { DevelopmentRepositoryDefinition } from './repositories';

const SHA = /^[0-9a-f]{40}$/;

export class BaselineShaError extends Error {
  constructor(public readonly code: 'baseline_sha_unavailable' | 'baseline_sha_invalid') {
    super(code);
  }
}

export function isExactGitSha(value: string): boolean {
  return SHA.test(value);
}

/**
 * Resolve the exact tip SHA of the allowlisted repository branch via GitHub API.
 * Repository and branch come only from the server allowlist — never from the browser.
 */
export async function resolveAllowlistedBaselineSha(
  repository: DevelopmentRepositoryDefinition,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const owner = repository.githubOwner;
  const repo = repository.githubRepo;
  const branch = repository.defaultBranch;
  const url = `https://api.github.com/repos/${owner}/${repo}/commits/${encodeURIComponent(branch)}`;

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'asi-owner-development-console',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      cache: 'no-store',
    });
  } catch {
    throw new BaselineShaError('baseline_sha_unavailable');
  }

  if (!response.ok) {
    throw new BaselineShaError('baseline_sha_unavailable');
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new BaselineShaError('baseline_sha_unavailable');
  }

  const sha =
    payload && typeof payload === 'object' && 'sha' in payload
      ? String((payload as { sha?: unknown }).sha ?? '').trim().toLowerCase()
      : '';

  if (!isExactGitSha(sha)) {
    throw new BaselineShaError('baseline_sha_invalid');
  }

  return sha;
}
