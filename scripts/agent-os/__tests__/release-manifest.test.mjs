import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { validateReleaseManifest } from '../contracts.mjs';
import {
  checkCommittedReleaseManifest,
  checkCurrentReleaseDoc,
  findCurrentReleaseViolations,
} from '../check-release-manifest.mjs';
import {
  GENERATED_MANIFEST_PATH,
  generateReleaseManifest,
  readJson,
  resolveActiveGates,
  resolveBaselineSha,
  stableManifestForComparison,
  writeReleaseManifest,
} from '../generate-release-manifest.mjs';
import { execFileSync } from 'node:child_process';
import { countTrackedMigrations } from '../migration-count.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const checkScript = path.join(repoRoot, 'scripts/agent-os/check-release-manifest.mjs');

function makeTempRepo() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'asi-release-manifest-'));
  fs.mkdirSync(path.join(tempRoot, 'docs/agent-os/generated'), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, 'docs/agent-os/schemas'), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, 'supabase/migrations'), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, '.github/workflows'), { recursive: true });
  return tempRoot;
}

test('generated manifest validates against release-manifest schema', () => {
  const manifest = generateReleaseManifest(repoRoot);
  assert.doesNotThrow(() => validateReleaseManifest(manifest, repoRoot));
  assert.equal(manifest.schemaVersion, 'asi.agent-os.release-manifest.v1');
});

test('baseline SHA is derived from repository HEAD', () => {
  const manifest = generateReleaseManifest(repoRoot);
  assert.equal(manifest.baselineSha, resolveBaselineSha(repoRoot));
});

test('migration count is derived from tracked migrations', () => {
  const manifest = generateReleaseManifest(repoRoot);
  assert.equal(manifest.migrations.count, countTrackedMigrations(repoRoot));
  assert.equal(manifest.migrations.directory, 'supabase/migrations');
});

test('active gates reference real workflow files', () => {
  const activeGates = resolveActiveGates(repoRoot);
  assert.ok(activeGates.length >= 3);
  for (const gate of activeGates) {
    assert.match(gate.workflow, /^\.github\/workflows\/[A-Za-z0-9_.-]+\.yml$/);
    assert.ok(fs.existsSync(path.join(repoRoot, gate.workflow)), gate.workflow);
  }
});

test('manifest comparison is deterministic except generatedAt and baselineSha', () => {
  const first = generateReleaseManifest(repoRoot, { generatedAt: '2026-09-16T06:00:00.000Z' });
  const second = generateReleaseManifest(repoRoot, { generatedAt: '2026-09-16T07:00:00.000Z' });
  assert.deepEqual(stableManifestForComparison(first), stableManifestForComparison(second));
  assert.notEqual(first.generatedAt, second.generatedAt);
});

test('stale generated manifest fails drift check', () => {
  const expected = generateReleaseManifest(repoRoot, { generatedAt: '2026-09-16T06:00:00.000Z' });
  const stale = {
    ...expected,
    migrations: { ...expected.migrations, count: expected.migrations.count + 1 },
  };
  assert.notEqual(
    JSON.stringify(stableManifestForComparison(stale)),
    JSON.stringify(stableManifestForComparison(expected)),
  );

  const committed = readJson(path.join(repoRoot, GENERATED_MANIFEST_PATH));
  const drifted = { ...committed, migrations: { ...committed.migrations, count: committed.migrations.count + 1 } };
  assert.throws(
    () => {
      if (JSON.stringify(stableManifestForComparison(drifted))
        !== JSON.stringify(stableManifestForComparison(generateReleaseManifest(repoRoot, { generatedAt: drifted.generatedAt })))) {
        throw new Error('Release manifest drift detected');
      }
    },
    /Release manifest drift detected/,
  );
});

test('hard-coded SHA/count in CURRENT_RELEASE.md fails doc enforcement', () => {
  const violations = findCurrentReleaseViolations(
    'Baseline SHA | `b2cfa055206d9d932ecb8e46004a7fa0ff8d15a3` | Migration history | 82 tracked SQL-файла',
  );
  assert.ok(violations.some((entry) => entry.patternId === 'baseline-sha-literal'));
  assert.ok(violations.some((entry) => entry.patternId === 'tracked-sql-file-count-ru'));

  assert.doesNotThrow(() => checkCurrentReleaseDoc(repoRoot));

  const badDocRoot = makeTempRepo();
  fs.writeFileSync(
    path.join(badDocRoot, 'docs/agent-os/CURRENT_RELEASE.md'),
    'Baseline SHA | `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa` |\n',
  );
  assert.throws(
    () => checkCurrentReleaseDoc(badDocRoot),
    /manually maintained release fields/,
  );
});

test('committed release manifest passes repository drift check', () => {
  const run = spawnSync(process.execPath, [checkScript], { cwd: repoRoot, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const output = JSON.parse(run.stdout.trim());
  assert.equal(output.ok, true);
  assert.equal(output.matchesRepositoryState, true);
});

test('writeReleaseManifest creates committed artifact used by CI', () => {
  const tempRoot = makeTempRepo();
  fs.cpSync(path.join(repoRoot, 'docs/agent-os/schemas'), path.join(tempRoot, 'docs/agent-os/schemas'), { recursive: true });
  fs.cpSync(path.join(repoRoot, 'docs/agent-os/release-gates.json'), path.join(tempRoot, 'docs/agent-os/release-gates.json'));
  fs.writeFileSync(path.join(tempRoot, 'package.json'), JSON.stringify({ name: 'landing-asi', version: '0.1.0' }, null, 2));
  fs.writeFileSync(path.join(tempRoot, 'supabase/migrations/20260101000000_example_v1.sql'), '-- example\n');
  fs.writeFileSync(path.join(tempRoot, '.github/workflows/pr-validation.yml'), 'name: PR Validation\n');
  fs.writeFileSync(path.join(tempRoot, '.github/workflows/deploy-staging.yml'), 'name: Deploy Staging\n');
  fs.writeFileSync(path.join(tempRoot, '.github/workflows/deploy.yml'), 'name: Deploy\n');
  execFileSync('git', ['init'], { cwd: tempRoot });
  execFileSync('git', ['config', 'user.email', 'agent@example.com'], { cwd: tempRoot });
  execFileSync('git', ['config', 'user.name', 'Agent'], { cwd: tempRoot });
  execFileSync('git', ['add', '.'], { cwd: tempRoot });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: tempRoot });

  const manifest = writeReleaseManifest(tempRoot, { generatedAt: '2026-09-16T06:00:00.000Z' });
  assert.ok(fs.existsSync(path.join(tempRoot, GENERATED_MANIFEST_PATH)));
  assert.equal(manifest.migrations.count, 1);
});
