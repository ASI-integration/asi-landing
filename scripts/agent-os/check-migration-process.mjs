#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readJson,
  validateArtifact,
  validateContractBundle,
} from './contracts.mjs';
import {
  buildMigrationPlan,
  loadMigrationRegistry,
  listTrackedMigrationFiles,
  validateMigrationPlan,
  validateMigrationResult,
} from './migration-process.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function listApplyWorkflows(repoRootPath) {
  const dir = path.join(repoRootPath, '.github/workflows');
  return fs.readdirSync(dir)
    .filter((name) => name.startsWith('apply-') && name.endsWith('.yml'))
    .map((name) => `.github/workflows/${name}`)
    .sort();
}

function listHelperScripts(repoRootPath) {
  const dir = path.join(repoRootPath, 'scripts');
  return fs.readdirSync(dir)
    .filter((name) => name.startsWith('apply-') && name.includes('migration'))
    .map((name) => `scripts/${name}`)
    .sort();
}

function registeredPaths(registry) {
  return new Set(registry.mechanisms.flatMap((mechanism) => mechanism.paths.map((entry) => entry.replace(/\\/g, '/'))));
}

export function checkMigrationProcess(repoRootPath = repoRoot) {
  const registry = loadMigrationRegistry(repoRootPath);
  validateArtifact('migration-mechanism-registry', registry, repoRootPath);

  const runbookPath = path.join(repoRootPath, registry.canonicalRunbook);
  invariant(fs.existsSync(runbookPath), `Missing canonical runbook: ${registry.canonicalRunbook}`);
  const runbookText = fs.readFileSync(runbookPath, 'utf8').toLowerCase();
  for (const token of ['dry-run', 'apply gate', 'verification', 'rollback', 'identity']) {
    invariant(runbookText.includes(token.toLowerCase()), `Runbook missing required topic: ${token}`);
  }

  const helpers = listHelperScripts(repoRootPath);
  const workflows = [
    ...listApplyWorkflows(repoRootPath),
    '.github/workflows/partner-production-rollout-control-v1.yml',
  ].sort();
  const paths = registeredPaths(registry);

  invariant(fs.existsSync(path.join(repoRootPath, registry.discovery.sqlChainDir)), 'Missing supabase/migrations');
  invariant(paths.has(registry.discovery.sqlChainDir), 'Registry must include the SQL chain directory');
  invariant(fs.existsSync(path.join(repoRootPath, registry.discovery.stagingSmoke)), 'Missing staging smoke script');
  invariant(paths.has(registry.discovery.stagingSmoke), 'Registry must include staging smoke script');

  const missingHelpers = helpers.filter((helper) => !paths.has(helper));
  invariant(missingHelpers.length === 0, `Unregistered migration helpers: ${missingHelpers.join(', ')}`);

  const missingWorkflows = workflows.filter((workflow) => !paths.has(workflow));
  invariant(missingWorkflows.length === 0, `Unregistered migration workflows: ${missingWorkflows.join(', ')}`);

  for (const mechanism of registry.mechanisms) {
    for (const entry of mechanism.paths) {
      invariant(fs.existsSync(path.join(repoRootPath, entry)), `Registry path missing on disk: ${entry}`);
    }
    for (const migrationPath of mechanism.migrationPaths ?? []) {
      invariant(
        fs.existsSync(path.join(repoRootPath, migrationPath)),
        `Registry migration path missing: ${migrationPath}`,
      );
    }
    if (mechanism.environments.includes('production') && mechanism.role === 'apply-backend') {
      invariant(mechanism.ownerGateRequired === true, `${mechanism.id} production apply-backend must require owner gate`);
    }
  }

  const tracked = listTrackedMigrationFiles(repoRootPath);
  invariant(tracked.length > 0, 'No tracked migrations found');

  validateMigrationPlan(
    readJson(path.join(repoRootPath, 'docs/agent-os/fixtures/migration-plan-fixture.json')),
    repoRootPath,
  );
  validateMigrationResult(
    readJson(path.join(repoRootPath, 'docs/agent-os/fixtures/migration-result-fixture.json')),
    repoRootPath,
  );

  const livePlan = buildMigrationPlan({
    mode: 'dry-run',
    mechanismId: 'supabase-migrations-chain',
    environment: 'local',
    identity: 'local-fixture',
    expectedIdentity: 'local-fixture',
    repoRoot: repoRootPath,
    generatedAt: '2026-09-16T00:00:00.000Z',
  });
  invariant(livePlan.migrations.length === tracked.length, 'Live plan migration count drift');
  invariant(livePlan.mutationAllowed === false, 'Live plan must keep mutationAllowed=false');

  let mismatchBlocked = false;
  try {
    buildMigrationPlan({
      mode: 'plan',
      mechanismId: 'supabase-migrations-chain',
      environment: 'local',
      identity: 'left',
      expectedIdentity: 'right',
      repoRoot: repoRootPath,
    });
  } catch (error) {
    mismatchBlocked = /Target identity mismatch/.test(error.message);
  }
  invariant(mismatchBlocked, 'Target mismatch did not fail closed');

  const bundle = validateContractBundle(repoRootPath);
  return {
    ok: true,
    check: 'migration-process',
    mechanisms: registry.mechanisms.length,
    helpers: helpers.length,
    workflows: workflows.length,
    trackedMigrations: tracked.length,
    schemas: bundle.schemas,
    fixtures: bundle.fixtures,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.stdout.write(`${JSON.stringify(checkMigrationProcess())}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, error: error.message })}\n`);
    process.exit(1);
  }
}
