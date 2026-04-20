import fs from 'fs';
import path from 'path';

/**
 * Commit SHA exposed by /api/version and /api/health.
 *
 * Production VPS uses artifact-only deploy: the only canonical SHA is `.release.build.json` inside the
 * unpacked release (written at package time). Shared `.env.production.live` must not carry release SHA;
 * a stale `ASI_RELEASE_SHA` there used to mask the wrong running build.
 *
 * Fallback: `VERCEL_GIT_COMMIT_SHA` on Vercel preview/production (no packaged metadata).
 *
 * Do not use NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA here: Next inlines NEXT_PUBLIC_* at build time, which can
 * disagree with the artifact/checkout SHA (e.g. workflow_dispatch where GITHUB_SHA != inputs.sha).
 */
function readPackagedReleaseSha(): string | null {
  try {
    const p = path.join(process.cwd(), '.release.build.json');
    const raw = fs.readFileSync(p, 'utf8');
    const parsed = JSON.parse(raw) as { sha?: unknown };
    const fromArtifact =
      typeof parsed.sha === 'string' ? parsed.sha.trim() : '';
    if (fromArtifact) return fromArtifact;
  } catch {
    // missing or invalid artifact metadata
  }
  return null;
}

export function getServerReleaseSha(): string | null {
  const fromPackaged = readPackagedReleaseSha();
  if (fromPackaged) return fromPackaged;

  const vercel = (process.env.VERCEL_GIT_COMMIT_SHA ?? '').trim();
  if (vercel) return vercel;

  return null;
}
