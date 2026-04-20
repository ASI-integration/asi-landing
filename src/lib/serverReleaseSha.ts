import fs from 'fs';
import path from 'path';

/**
 * Commit SHA exposed by /api/version and /api/health.
 *
 * Order:
 * 1. ASI_RELEASE_SHA — set on the VPS by deploy scripts (and should be passed into smoke `npm run start`).
 * 2. `.release.build.json` — written when packaging the release artifact (always matches the built tree).
 * 3. VERCEL_GIT_COMMIT_SHA — runtime on Vercel (not build-inlined).
 *
 * Do not use NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA here: Next inlines NEXT_PUBLIC_* at build time, which can
 * disagree with the artifact/checkout SHA (e.g. workflow_dispatch where GITHUB_SHA != inputs.sha).
 */
export function getServerReleaseSha(): string | null {
  const fromDeploy = (process.env.ASI_RELEASE_SHA ?? '').trim();
  if (fromDeploy) return fromDeploy;

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

  const vercel = (process.env.VERCEL_GIT_COMMIT_SHA ?? '').trim();
  if (vercel) return vercel;

  return null;
}
