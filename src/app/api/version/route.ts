import { NextResponse } from 'next/server';
import { resolveRuntimeReleaseInfo } from '@/lib/runtimeRelease';
import packageJson from '../../../../package.json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  let info: ReturnType<typeof resolveRuntimeReleaseInfo> | null = null;
  let vercelGitSha: string | null = null;

  try {
    info = resolveRuntimeReleaseInfo();
  } catch (error) {
    const isVercel = (process.env.VERCEL || '').trim() === '1'
      || Boolean((process.env.VERCEL_ENV || '').trim());
    if (!isVercel) throw error;
    vercelGitSha = (process.env.VERCEL_GIT_COMMIT_SHA || '').trim() || null;
  }

  const res = NextResponse.json({
    environment: (
      process.env.ASI_DEPLOY_ENV
      || process.env.VERCEL_ENV
      || process.env.NODE_ENV
      || ''
    ).trim() || null,
    sha: info?.gitSha ?? vercelGitSha,
    appVersion: (process.env.ASI_APP_VERSION || packageJson.version || '').trim() || null,
    deployedAt: (process.env.ASI_RELEASE_DEPLOYED_AT_ISO || '').trim() || null,
    releasePath: (process.env.ASI_RELEASE_PATH || '').trim() || null,
    appRoot: info?.appRoot ?? null,
    processCwd: info?.cwd ?? process.cwd(),
    releaseMetaPath: info?.releaseMetaPath ?? null,
    resolvedReleasePath: info?.releaseRealPath ?? null,
  });
  res.headers.set('Cache-Control', 'no-store, max-age=0');
  return res;
}

