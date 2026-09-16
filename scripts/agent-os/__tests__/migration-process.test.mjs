import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkMigrationProcess } from '../check-migration-process.mjs';
import {
  buildMigrationPlan,
  evaluateApplyGate,
  listTrackedMigrationFiles,
  loadMigrationRegistry,
  parseEmittedEvidence,
  runCli,
} from '../migration-process.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

test('registry loads and covers discovered helpers/workflows', () => {
  const result = checkMigrationProcess(repoRoot);
  assert.equal(result.ok, true);
  assert.ok(result.helpers >= 10);
  assert.ok(result.workflows >= 8);
  assert.equal(result.trackedMigrations, listTrackedMigrationFiles(repoRoot).length);
});

test('dry-run plan lists tracked migrations without mutation', () => {
  const plan = buildMigrationPlan({
    mode: 'dry-run',
    mechanismId: 'supabase-migrations-chain',
    environment: 'local',
    identity: 'local-fixture',
    expectedIdentity: 'local-fixture',
    repoRoot,
    generatedAt: '2026-09-16T00:00:00.000Z',
  });
  assert.equal(plan.schemaVersion, 'asi.agent-os.migration-plan.v1');
  assert.equal(plan.mutationAllowed, false);
  assert.equal(plan.migrations.length, listTrackedMigrationFiles(repoRoot).length);
  assert.equal(plan.rollback.policy, 'append-only-forward-fix');
});

test('target identity mismatch fails closed', () => {
  assert.throws(
    () => buildMigrationPlan({
      mode: 'plan',
      mechanismId: 'supabase-migrations-chain',
      environment: 'local',
      identity: 'staging-a',
      expectedIdentity: 'staging-b',
      repoRoot,
    }),
    /Target identity mismatch/,
  );
});

test('production apply without owner gate is blocked', () => {
  const plan = buildMigrationPlan({
    mode: 'apply',
    mechanismId: 'workflow-booking-lifecycle',
    environment: 'production',
    identity: 'jwinifeienvzejofmbua',
    expectedIdentity: 'jwinifeienvzejofmbua',
    repoRoot,
    generatedAt: '2026-09-16T00:00:00.000Z',
  });
  assert.equal(plan.applyGate.required, true);
  assert.equal(plan.applyGate.ownerGateAction, 'production_migration');
  assert.throws(
    () => evaluateApplyGate({ plan, repoRoot }),
    /Production apply requires an owner-gate artifact path/,
  );
});

test('production apply handoff never executes DDL', () => {
  const plan = buildMigrationPlan({
    mode: 'apply',
    mechanismId: 'workflow-channel-manager-synthetic-recovery',
    environment: 'production',
    identity: 'jwinifeienvzejofmbua',
    expectedIdentity: 'jwinifeienvzejofmbua',
    repoRoot,
    generatedAt: '2026-09-16T00:00:00.000Z',
  });

  const result = evaluateApplyGate({
    plan,
    ownerGatePath: 'docs/agent-os/fixtures/production-migration-owner-gate.json',
    confirmationPhrase: 'APPLY_20260805120000_RECOVERY_V1_TO_PRODUCTION',
    repoRoot,
  });
  assert.equal(result.status, 'PASS');
  assert.equal(result.mutationPerformed, false);
  assert.equal(result.applyHandoff.executed, false);
  assert.match(
    result.applyHandoff.establishedApplyPath,
    /apply-channel-manager-live-core-synthetic-recovery-migration\.yml/,
  );
});

test('CLI dry-run emits plan and result markers', () => {
  const previousWrite = process.stdout.write;
  let output = '';
  process.stdout.write = (chunk) => {
    output += String(chunk);
    return true;
  };
  try {
    const code = runCli([
      'dry-run',
      '--mechanism', 'supabase-migrations-chain',
      '--environment', 'local',
      '--identity', 'local-fixture',
      '--expected-identity', 'local-fixture',
    ], repoRoot);
    assert.equal(code, 0);
  } finally {
    process.stdout.write = previousWrite;
  }
  const { plan, result } = parseEmittedEvidence(output);
  assert.equal(plan.mode, 'dry-run');
  assert.equal(result.mutationPerformed, false);
  assert.equal(result.targetMatch, true);
});

test('CLI fails closed on identity mismatch', () => {
  const previousErr = process.stderr.write;
  let err = '';
  process.stderr.write = (chunk) => {
    err += String(chunk);
    return true;
  };
  try {
    const code = runCli([
      'plan',
      '--mechanism', 'supabase-migrations-chain',
      '--environment', 'local',
      '--identity', 'a',
      '--expected-identity', 'b',
    ], repoRoot);
    assert.equal(code, 1);
  } finally {
    process.stderr.write = previousErr;
  }
  assert.match(err, /Target identity mismatch/);
});

test('reference-only mechanisms cannot enter the process', () => {
  assert.throws(
    () => buildMigrationPlan({
      mode: 'plan',
      mechanismId: 'reference-docs-sql',
      environment: 'local',
      identity: 'local',
      expectedIdentity: 'local',
      repoRoot,
    }),
    /reference-only/,
  );
});

test('registry schema version is stable', () => {
  const registry = loadMigrationRegistry(repoRoot);
  assert.equal(registry.schemaVersion, 'asi.agent-os.migration-mechanism-registry.v1');
  assert.equal(registry.canonicalRunbook, 'docs/agent-os/MIGRATION_PROCESS.md');
});
