#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, validateAcceptanceRunnerRegistry } from './contracts.mjs';

const DEFAULT_REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const EVIDENCE_PROOF_PATTERNS = {
  'shared-acceptance-contract': /acceptance-contract\.mjs/,
  'legacy-guest-lifecycle-schema': /noExternalActions/,
};

export function discoverRunnerFiles(repoRoot, discovery) {
  const dir = path.join(repoRoot, discovery.dir);
  const include = new RegExp(discovery.includePattern, 'i');
  const exclude = new RegExp(discovery.excludePattern, 'i');
  return fs
    .readdirSync(dir)
    .filter((name) => include.test(name) && !exclude.test(name))
    .filter((name) => /\.(mjs|ts|js)$/.test(name))
    .map((name) => path.posix.join(discovery.dir, name))
    .sort();
}

export function checkAcceptanceCoverage(repoRoot = DEFAULT_REPO_ROOT) {
  const registry = validateAcceptanceRunnerRegistry(
    readJson(path.join(repoRoot, 'docs/agent-os/acceptance-runners.json')),
    repoRoot,
  );

  const discovered = discoverRunnerFiles(repoRoot, registry.discovery);
  const registered = registry.runners.map((runner) => runner.file);

  const undeclared = discovered.filter((file) => !registered.includes(file));
  const stale = registered.filter((file) => !fs.existsSync(path.join(repoRoot, file)));
  const missingFromDiscovery = registered.filter((file) => !discovered.includes(file));

  const proofFailures = [];
  const covered = [];
  const uncovered = [];

  for (const runner of registry.runners) {
    if (runner.evidenceStatus !== 'emits-contract') {
      uncovered.push(runner.runnerId);
      continue;
    }
    const filePath = path.join(repoRoot, runner.file);
    if (!fs.existsSync(filePath)) {
      proofFailures.push(`${runner.runnerId}: file missing, cannot prove evidence mechanism`);
      continue;
    }
    const source = fs.readFileSync(filePath, 'utf8');
    const proofPattern = EVIDENCE_PROOF_PATTERNS[runner.evidenceMechanism];
    if (!proofPattern) {
      proofFailures.push(`${runner.runnerId}: unknown evidenceMechanism '${runner.evidenceMechanism}'`);
      continue;
    }
    if (!proofPattern.test(source)) {
      proofFailures.push(`${runner.runnerId}: declares evidenceMechanism '${runner.evidenceMechanism}' but source has no proof of it`);
      continue;
    }
    covered.push(runner.runnerId);
  }

  const errors = [
    ...undeclared.map((file) => `Undeclared acceptance runner detected: ${file} is not in docs/agent-os/acceptance-runners.json`),
    ...stale.map((file) => `Registry entry points at a missing file: ${file}`),
    ...missingFromDiscovery.map((file) => `Registry entry ${file} was not found by discovery (path or naming pattern drift)`),
    ...proofFailures,
  ];

  return {
    schemaVersion: 'asi.agent-os.acceptance-coverage-report.v1',
    totalRunners: registry.runners.length,
    covered,
    uncovered,
    undeclared,
    stale,
    missingFromDiscovery,
    proofFailures,
    ok: errors.length === 0 && uncovered.length === 0,
    errors,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const reportOnly = process.argv.includes('--report-only');
  try {
    const report = checkAcceptanceCoverage();
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.ok && !reportOnly) {
      process.exit(1);
    }
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, error: error.message })}\n`);
    process.exit(1);
  }
}
