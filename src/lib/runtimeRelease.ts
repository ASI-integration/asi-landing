import fs from 'fs';
import path from 'path';

export type RuntimeReleaseInfo = {
  appRoot: string;
  cwd: string;
  releaseMetaPath: string;
  releaseRealPath: string | null;
  gitSha: string;
};

function readJsonFile(p: string): unknown {
  const raw = fs.readFileSync(p, 'utf8');
  return JSON.parse(raw) as unknown;
}

function asNonEmptyString(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

export function getAsiAppRoot(): string {
  const env = (process.env.ASI_APP_ROOT ?? '').trim();
  return env || '/var/www/asi/current';
}

export function resolveRuntimeReleaseInfo(): RuntimeReleaseInfo {
  const appRoot = path.resolve(getAsiAppRoot());
  const cwd = process.cwd();
  const releaseMetaPath = path.resolve(appRoot, 'release-meta.json');

  const parsed = readJsonFile(releaseMetaPath) as { gitSha?: unknown };
  const gitSha = asNonEmptyString(parsed?.gitSha);
  if (!gitSha) {
    throw new Error(`release-meta.json missing gitSha at ${releaseMetaPath}`);
  }

  let releaseRealPath: string | null = null;
  try {
    releaseRealPath = fs.realpathSync(appRoot);
  } catch {
    releaseRealPath = null;
  }

  return { appRoot, cwd, releaseMetaPath, releaseRealPath, gitSha };
}

export function logRuntimeReleaseBootOnce(): void {
  const key = '__asi_release_boot_logged__';
  const g = globalThis as unknown as Record<string, unknown>;
  if (g[key]) return;
  g[key] = true;

  try {
    const info = resolveRuntimeReleaseInfo();
    // Explicit boot diagnostics for post-switch debugging.
    console.log('[asi-release] boot', {
      processCwd: info.cwd,
      ASI_APP_ROOT: info.appRoot,
      releaseMetaPath: info.releaseMetaPath,
      gitSha: info.gitSha,
      releasePath: info.releaseRealPath,
    });
  } catch (e) {
    console.log('[asi-release] boot', {
      processCwd: process.cwd(),
      ASI_APP_ROOT: (process.env.ASI_APP_ROOT ?? '').trim() || null,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

