import { DEVELOPMENT_REPOSITORY_ALLOWLIST } from './repositories';

export type AllowlistedPullRequestIdentity = {
  safeUrl: string;
  repository: (typeof DEVELOPMENT_REPOSITORY_ALLOWLIST)[number]['fullName'];
  owner: (typeof DEVELOPMENT_REPOSITORY_ALLOWLIST)[number]['githubOwner'];
  repo: (typeof DEVELOPMENT_REPOSITORY_ALLOWLIST)[number]['githubRepo'];
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

/** Resolve canonical allowlisted repository identity for a safe PR URL. */
export function resolveAllowlistedPullRequestIdentity(value: string): AllowlistedPullRequestIdentity {
  const safeUrl = safeAllowlistedPullRequestUrl(value);
  if (!safeUrl) {
    throw new Error('pull_request_invalid');
  }
  const parts = new URL(safeUrl).pathname.split('/').filter(Boolean);
  const owner = parts[0];
  const repo = parts[1];
  const pullRequestNumber = Number(parts[3]);
  if (!Number.isSafeInteger(pullRequestNumber) || pullRequestNumber < 1) {
    throw new Error('pull_request_invalid');
  }
  const allowlisted = DEVELOPMENT_REPOSITORY_ALLOWLIST.find(
    (entry) => entry.githubOwner === owner && entry.githubRepo === repo,
  );
  if (!allowlisted) {
    throw new Error('pull_request_invalid');
  }
  return {
    safeUrl,
    repository: allowlisted.fullName,
    owner: allowlisted.githubOwner,
    repo: allowlisted.githubRepo,
    pullRequestNumber,
  };
}
