import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkAcceptanceCoverage, discoverRunnerFiles } from '../check-acceptance-coverage.mjs';
import { readJson, validateAcceptanceRunnerRegistry } from '../contracts.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

test('registry validates and every declared file exists in this repository', () => {
  const registry = validateAcceptanceRunnerRegistry(
    readJson(path.join(repoRoot, 'docs/agent-os/acceptance-runners.json')),
    repoRoot,
  );
  for (const runner of registry.runners) {
    assert.ok(fs.existsSync(path.join(repoRoot, runner.file)), `${runner.file} listed in registry must exist`);
  }
});

test('checkAcceptanceCoverage matches discovery with the registry for the real repo (no drift)', () => {
  const report = checkAcceptanceCoverage(repoRoot);
  assert.deepEqual(report.undeclared, []);
  assert.deepEqual(report.stale, []);
  assert.deepEqual(report.missingFromDiscovery, []);
  assert.deepEqual(report.proofFailures, []);
  assert.ok(report.covered.includes('guest-lifecycle-db-acceptance'));
  assert.ok(report.covered.includes('guest-lifecycle-synthetic-acceptance'));
});

test('checkAcceptanceCoverage fails closed while any runner is not-yet-instrumented', () => {
  const report = checkAcceptanceCoverage(repoRoot);
  assert.ok(report.uncovered.length > 0, 'this fixture repo intentionally still has uncovered runners');
  assert.equal(report.ok, false);
});

test('an undeclared runner file on disk is detected as drift', (t) => {
  const scriptsDir = path.join(repoRoot, 'scripts');
  const planted = path.join(scriptsDir, 'zz-fixture-planted-acceptance.mjs');
  fs.writeFileSync(planted, '// planted for a coverage-drift test\n');
  t.after(() => fs.rmSync(planted, { force: true }));

  const report = checkAcceptanceCoverage(repoRoot);
  assert.ok(report.undeclared.includes('scripts/zz-fixture-planted-acceptance.mjs'));
  assert.equal(report.ok, false);
});

test('a stale registry entry pointing at a deleted file is detected', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ao008-coverage-'));
  try {
    fs.mkdirSync(path.join(tmpRoot, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(tmpRoot, 'docs/agent-os/schemas'), { recursive: true });
    for (const schema of fs.readdirSync(path.join(repoRoot, 'docs/agent-os/schemas'))) {
      fs.copyFileSync(
        path.join(repoRoot, 'docs/agent-os/schemas', schema),
        path.join(tmpRoot, 'docs/agent-os/schemas', schema),
      );
    }
    const registry = {
      schemaVersion: 'asi.agent-os.acceptance-runner-registry.v1',
      generatedAt: '2026-09-16T00:00:00Z',
      discovery: { dir: 'scripts', includePattern: 'acceptance', excludePattern: '\\.runner\\.ts$|\\.ps1$|\\.test\\.|__tests__' },
      runners: [{
        runnerId: 'ghost-acceptance',
        file: 'scripts/ghost-acceptance.mjs',
        environment: 'local',
        evidenceStatus: 'not-yet-instrumented',
        evidenceMechanism: null,
        noExternalActions: 'unknown',
        fixtureOwnership: 'unknown',
        cleanupEvidence: 'unknown',
        notes: 'Registered but deleted from disk.',
      }],
    };
    fs.writeFileSync(path.join(tmpRoot, 'docs/agent-os/acceptance-runners.json'), JSON.stringify(registry));

    const report = checkAcceptanceCoverage(tmpRoot);
    assert.deepEqual(report.stale, ['scripts/ghost-acceptance.mjs']);
    assert.equal(report.ok, false);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('discoverRunnerFiles excludes .runner.ts, .ps1, and test files by the registry pattern', () => {
  const registry = readJson(path.join(repoRoot, 'docs/agent-os/acceptance-runners.json'));
  const discovered = discoverRunnerFiles(repoRoot, registry.discovery);
  assert.ok(!discovered.some((file) => file.endsWith('.runner.ts')));
  assert.ok(!discovered.some((file) => file.endsWith('.ps1')));
  assert.ok(discovered.includes('scripts/guest-lifecycle-db-acceptance.ts'));
});
