import {
  DEVELOPMENT_REPOSITORY_ALLOWLIST,
  type DevelopmentRepositoryDefinition,
} from './repositories';

export type AllowlistedPullRequestIdentity = {
  safeUrl: string;
  repository: DevelopmentRepositoryDefinition;
  pullRequestNumber: number;
};

/**
 * Returns a safe HTTPS GitHub PR URL for an allowlisted ASI repository, or null.
 * Used by the Owner Development Console UI — never renders untrusted hosts/repos as links.
 */
export function safeAllowlistedPullRequestUrl(value: string | null | undefined): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;

  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return null;
    if (url.hostname !== 'github.com') return null;
    if (url.username || url.password) return null;
    if (url.search || url.hash) return null;

    for (const repo of DEVELOPMENT_REPOSITORY_ALLOWLIST) {
      const pattern = new RegExp(
        `^/${repo.githubOwner}/${repo.githubRepo}/pull/[1-9][0-9]*/?$`,
      );
      if (pattern.test(url.pathname)) {
        return `https://github.com/${repo.githubOwner}/${repo.githubRepo}/pull/${url.pathname.split('/').filter(Boolean)[3]}`;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** Server-side allowlist resolution for PR repository identity. */
export function resolveAllowlistedPullRequestRepository(
  value: string | null | undefined,
): DevelopmentRepositoryDefinition['fullName'] | null {
  return parseAllowlistedPullRequestUrl(value)?.repository.fullName ?? null;
}

export function parseAllowlistedPullRequestUrl(
  value: string | null | undefined,
): AllowlistedPullRequestIdentity | null {
  const safeUrl = safeAllowlistedPullRequestUrl(value);
  if (!safeUrl) return null;

  const parts = new URL(safeUrl).pathname.split('/').filter(Boolean);
  const pullRequestNumber = Number(parts[3]);
  if (!Number.isSafeInteger(pullRequestNumber) || pullRequestNumber < 1) return null;

  for (const repo of DEVELOPMENT_REPOSITORY_ALLOWLIST) {
    const pattern = new RegExp(
      `^/${repo.githubOwner}/${repo.githubRepo}/pull/[1-9][0-9]*/?$`,
    );
    if (pattern.test(new URL(safeUrl).pathname)) {
      return { safeUrl, repository: repo, pullRequestNumber };
    }
  }
  return null;
}
