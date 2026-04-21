import { NextResponse } from 'next/server';
import { resolveRuntimeReleaseInfo } from '@/lib/runtimeRelease';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const info = resolveRuntimeReleaseInfo();

  const res = NextResponse.json({
    sha: info.gitSha,
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

