import fs from 'fs';
import path from 'path';

/**
 * Commit SHA exposed by /api/version and /api/health.
 *
 * Production reads `release-meta.json` from the live app root (`ASI_APP_ROOT`, default
 * `/var/www/asi/current`). That path is symlinked to the active release; the file is created
 * in CI and shipped in the artifact — never from a git checkout or stale env SHA.
 *
 * Fallback: `VERCEL_GIT_COMMIT_SHA` on Vercel (no packaged metadata).
 *
 * Legacy: `.release.build.json` with `sha` (older artifacts).
 */
function uniqueDirs(dirs: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const d of dirs) {
    const t = d.trim();
    if (!t) continue;
    let abs: string;
    try {
      abs = path.resolve(t);
    } catch {
      continue;
    }
    if (seen.has(abs)) continue;
    seen.add(abs);
    out.push(abs);
  }
  return out;
}

function dirsToSearch(): string[] {
  const fromEnv = (process.env.ASI_APP_ROOT ?? '').trim();
  return uniqueDirs([fromEnv, '/var/www/asi/current', process.cwd()]);
}

function readReleaseMetaGitSha(dir: string): string | null {
  try {
    const p = path.join(dir, 'release-meta.json');
    const raw = fs.readFileSync(p, 'utf8');
    const parsed = JSON.parse(raw) as { gitSha?: unknown };
    const s = typeof parsed.gitSha === 'string' ? parsed.gitSha.trim() : '';
    if (s) return s;
  } catch {
    // missing or invalid
  }
  return null;
}

function readLegacyPackagedSha(dir: string): string | null {
  try {
    const p = path.join(dir, '.release.build.json');
    const raw = fs.readFileSync(p, 'utf8');
    const parsed = JSON.parse(raw) as { sha?: unknown };
    const s = typeof parsed.sha === 'string' ? parsed.sha.trim() : '';
    if (s) return s;
  } catch {
    // missing or invalid artifact metadata
  }
  return null;
}

export function getServerReleaseSha(): string | null {
  for (const dir of dirsToSearch()) {
    const fromMeta = readReleaseMetaGitSha(dir);
    if (fromMeta) return fromMeta;
  }
  for (const dir of dirsToSearch()) {
    const legacy = readLegacyPackagedSha(dir);
    if (legacy) return legacy;
  }

  const vercel = (process.env.VERCEL_GIT_COMMIT_SHA ?? '').trim();
  if (vercel) return vercel;

  return null;
}
