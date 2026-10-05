import { NextResponse } from 'next/server';
import { resolveRuntimeReleaseInfo } from '@/lib/runtimeRelease';
import packageJson from '../../../../package.json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  let info: {
    gitSha: string;
    appRoot: string | null;
    cwd: string;
    releaseMetaPath: string | null;
    releaseRealPath: string | null;
  };

  try {
    info = resolveRuntimeReleaseInfo();
  } catch (error) {
    const vercelGitSha = (process.env.VERCEL_GIT_COMMIT_SHA || '').trim();
    if (!vercelGitSha) throw error;

    info = {
      gitSha: vercelGitSha,
      appRoot: null,
      cwd: process.cwd(),
      releaseMetaPath: null,
      releaseRealPath: null,
    };
  }

  const res = NextResponse.json({
    environment: (process.env.ASI_DEPLOY_ENV || process.env.VERCEL_ENV || process.env.NODE_ENV || '').trim() || null,
    sha: info.gitSha,
    appVersion: (process.env.ASI_APP_VERSION || packageJson.version || '').trim() || null,
    deployedAt: (process.env.ASI_RELEASE_DEPLOYED_AT_ISO || '').trim() || null,
    releasePath: (process.env.ASI_RELEASE_PATH || '').trim() || null,
    appRoot: info.appRoot,
    processCwd: info.cwd,
    releaseMetaPath: info.releaseMetaPath,
    resolvedReleasePath: info.releaseRealPath,
  });
  res.headers.set('Cache-Control', 'no-store, max-age=0');
  return res;
}

