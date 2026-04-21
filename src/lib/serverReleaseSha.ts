export function getServerReleaseSha(): string | null {
  /**
   * Single source of truth (required):
   * - `${ASI_APP_ROOT}/release-meta.json` with `gitSha`
   *
   * We intentionally do NOT fall back to:
   * - `process.cwd()` (can point at previous release after switch)
   * - a git checkout / `.git`
   * - legacy metadata files
   * - env-provided SHAs
   */
  try {
    // Local import avoids module init doing I/O too early in tests.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { resolveRuntimeReleaseInfo } = require('@/lib/runtimeRelease') as typeof import('@/lib/runtimeRelease');
    return resolveRuntimeReleaseInfo().gitSha;
  } catch {
    return null;
  }
}
