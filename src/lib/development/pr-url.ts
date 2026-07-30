import { DEVELOPMENT_REPOSITORY_ALLOWLIST } from './repositories';

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
