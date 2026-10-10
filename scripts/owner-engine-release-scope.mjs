import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const OWNER_RELEASE_FILES = Object.freeze([
  '.github/workflows/deploy-owner-engine-progress.yml',
  'docs/operations/asi-owner-dashboard-safe-release-20261010.md',
  'docs/operations/asi-owner-engine-progress-v1.md',
  'scripts/owner-engine-release-scope.mjs',
  'src/app/api/dashboard/engine-progress/__tests__/route.test.ts',
  'src/app/api/dashboard/engine-progress/route.ts',
  'src/app/dashboard/engine-progress/EngineProgressClient.tsx',
  'src/app/dashboard/engine-progress/page.tsx',
  'src/app/dashboard/layout.tsx',
  'src/lib/engine-progress/__tests__/release-safety.test.ts',
  'src/lib/engine-progress/__tests__/roadmap.test.ts',
  'src/lib/engine-progress/roadmap.ts',
  'src/lib/engine-progress/server.ts',
]);

/** Strict no-surprise production source gate, independent of CI success. */
export function verifyOwnerReleaseScope(compare) {
  if (!compare || typeof compare !== 'object' || compare.status !== 'ahead' ||
    !Number.isInteger(compare.ahead_by) || compare.ahead_by < 1 ||
    compare.behind_by !== 0 || compare.ahead_by > 25 ||
    !Array.isArray(compare.files) || compare.files.length < 1 ||
    compare.files.length > OWNER_RELEASE_FILES.length) {
    return { ok: false, reason: 'Source comparison missing, diverged, or too large.' };
  }
  const approved = new Set(OWNER_RELEASE_FILES);
  const visited = new Set();
  for (const file of compare.files) {
    if (!file || typeof file.filename !== 'string' ||
      !approved.has(file.filename) || visited.has(file.filename) ||
      !['added','modified'].includes(file.status) || file.previous_filename) {
      return { ok: false, reason: 'Production delta contains unapproved change.' };
    }
    visited.add(file.filename);
  }
  if (!visited.has('src/app/dashboard/engine-progress/page.tsx') ||
    !visited.has('src/app/api/dashboard/engine-progress/route.ts')) {
    return { ok: false, reason: 'Owner dashboard is not present in delta.' };
  }
  return { ok: true, count: visited.size };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const source = process.argv[2];
    if (!source || process.argv.length !== 3) throw new Error('Usage: node owner-engine-release-scope.mjs COMPARE_JSON');
    const parsed = JSON.parse(fs.readFileSync(source, 'utf8'));
    const result = verifyOwnerReleaseScope(parsed);
    if (!result.ok) throw new Error(result.reason);
    console.log('OWNER_RELEASE_SCOPE_PASS changed_files=' + result.count);
  } catch {
    console.error('OWNER_RELEASE_SCOPE_BLOCK: unexpected production source delta');
    process.exitCode = 1;
  }
}
