import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, validateArtifact, validateOwnerGate } from './contracts.mjs';

const DEFAULT_REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PLAN_MARKER = 'MIGRATION_PLAN_EVIDENCE:';
const RESULT_MARKER = 'MIGRATION_RESULT_EVIDENCE:';
const REGISTRY_PATH = 'docs/agent-os/migration-mechanisms.json';

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

export function loadMigrationRegistry(repoRoot = DEFAULT_REPO_ROOT) {
  const registry = readJson(path.join(repoRoot, REGISTRY_PATH));
  validateArtifact('migration-mechanism-registry', registry, repoRoot);
  const ids = registry.mechanisms.map((entry) => entry.id);
  invariant(new Set(ids).size === ids.length, 'Migration mechanism ids must be unique');
  return registry;
}

export function getMechanism(mechanismId, repoRoot = DEFAULT_REPO_ROOT) {
  const registry = loadMigrationRegistry(repoRoot);
  const mechanism = registry.mechanisms.find((entry) => entry.id === mechanismId);
  invariant(mechanism, `Unknown migration mechanism: ${mechanismId}`);
  return mechanism;
}

export function listTrackedMigrationFiles(repoRoot = DEFAULT_REPO_ROOT) {
  const directory = path.join(repoRoot, 'supabase/migrations');
  return fs.readdirSync(directory)
    .filter((name) => name.endsWith('.sql'))
    .sort((left, right) => left.localeCompare(right));
}

export function migrationVersion(filename) {
  const match = filename.match(/^(\d+)_/);
  invariant(match, `${filename} must start with a numeric prefix`);
  return match[1];
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

export function resolveMigrationEntries(mechanism, repoRoot = DEFAULT_REPO_ROOT) {
  if (mechanism.kind === 'sql-chain' || mechanism.id === 'supabase-cli-staging-push') {
    return listTrackedMigrationFiles(repoRoot).map((filename) => {
      const relative = path.posix.join('supabase/migrations', filename);
      return {
        path: relative,
        version: migrationVersion(filename),
        sha256: sha256File(path.join(repoRoot, 'supabase', 'migrations', filename)),
      };
    });
  }

  const migrationPaths = mechanism.migrationPaths ?? [];
  invariant(migrationPaths.length > 0, `${mechanism.id} must declare migrationPaths for plan mode`);
  return migrationPaths.map((relativePath) => {
    const absolute = path.join(repoRoot, relativePath);
    invariant(fs.existsSync(absolute), `Missing migration file: ${relativePath}`);
    const filename = path.basename(relativePath);
    return {
      path: relativePath.replace(/\\/g, '/'),
      version: migrationVersion(filename),
      sha256: sha256File(absolute),
    };
  });
}

function assertTargetMatch(identity, expectedIdentity) {
  invariant(
    typeof identity === 'string' && identity.length > 0,
    'target identity is required',
  );
  invariant(
    typeof expectedIdentity === 'string' && expectedIdentity.length > 0,
    'expectedIdentity is required',
  );
  invariant(
    identity === expectedIdentity,
    `Target identity mismatch: identity=${identity} expectedIdentity=${expectedIdentity}`,
  );
}

function rollbackFor(mechanism) {
  if (mechanism.rollbackPolicy === 'atomic-transaction') {
    return {
      policy: 'atomic-transaction',
      strategy: 'Keep the established single-transaction apply. On error, PostgreSQL rolls back the whole batch; do not partial-commit.',
    };
  }
  if (mechanism.rollbackPolicy === 'append-only-forward-fix') {
    return {
      policy: 'append-only-forward-fix',
      strategy: 'Applied DDL is append-only history. Reverse via a new forward-fix migration after a fresh owner gate.',
    };
  }
  return {
    policy: 'owner-gated-new-migration',
    strategy: 'Do not drop or rewrite applied schema in place. Prepare an append-only rollback migration and obtain a new production_migration owner gate.',
  };
}

function applyGateFor(mechanism, mode, environment) {
  const production = environment === 'production';
  const required = production || mechanism.ownerGateRequired === true;
  if (mode === 'plan' || mode === 'dry-run') {
    return {
      required,
      ownerGateAction: production ? 'production_migration' : required ? 'staging_operator_approval' : 'not_required',
      status: required ? 'missing' : 'not_required',
      confirmationPhrase: null,
      establishedApplyPath: mechanism.paths[0] ?? null,
    };
  }
  return {
    required: true,
    ownerGateAction: production ? 'production_migration' : 'staging_operator_approval',
    status: 'missing',
    confirmationPhrase: null,
    establishedApplyPath: mechanism.paths.find((entry) => entry.includes('.github/workflows/') || entry.endsWith('.py') || entry.endsWith('.sh'))
      ?? mechanism.paths[0],
  };
}

export function buildMigrationPlan({
  mode,
  mechanismId,
  environment,
  identity,
  expectedIdentity,
  repoRoot = DEFAULT_REPO_ROOT,
  generatedAt = new Date().toISOString(),
}) {
  invariant(['plan', 'dry-run', 'apply'].includes(mode), `Unsupported mode: ${mode}`);
  assertTargetMatch(identity, expectedIdentity);

  const mechanism = getMechanism(mechanismId, repoRoot);
  invariant(
    mechanism.environments.includes(environment),
    `${mechanismId} does not support environment ${environment}`,
  );
  invariant(
    mechanism.role !== 'reference-only',
    `${mechanismId} is reference-only and cannot enter the migration process`,
  );

  if (mode === 'dry-run') {
    invariant(
      mechanism.supportsDryRun === true || mechanism.kind === 'sql-chain',
      `${mechanismId} does not declare dry-run support; use mode=plan then an established apply backend`,
    );
  }

  const plan = {
    schemaVersion: 'asi.agent-os.migration-plan.v1',
    mode,
    mechanismId,
    target: { environment, identity, expectedIdentity },
    migrations: resolveMigrationEntries(mechanism, repoRoot),
    applyGate: applyGateFor(mechanism, mode, environment),
    verification: [
      'Fail closed unless target.identity === target.expectedIdentity',
      'Review SQL paths and checksums in this plan before any apply',
      'Retain post-apply schema/history evidence from the established mechanism',
    ],
    rollback: rollbackFor(mechanism),
    mutationAllowed: false,
    generatedAt,
  };

  if (mode === 'apply') {
    invariant(plan.applyGate.required === true, 'Apply mode always requires an explicit gate');
    plan.applyGate.status = 'missing';
  }

  return validateMigrationPlan(plan, repoRoot);
}

export function validateMigrationPlan(value, repoRoot = DEFAULT_REPO_ROOT) {
  validateArtifact('migration-plan', value, repoRoot);
  invariant(value.mutationAllowed === false, 'Migration plans in this contract must set mutationAllowed=false');
  assertTargetMatch(value.target.identity, value.target.expectedIdentity);
  if (value.mode === 'apply') {
    invariant(value.applyGate.required === true, 'Apply plans require an explicit apply gate');
  }
  if (value.target.environment === 'production') {
    invariant(value.applyGate.ownerGateAction === 'production_migration', 'Production plans require production_migration gate action');
    invariant(value.applyGate.required === true, 'Production plans require an owner gate');
  }
  return value;
}

export function validateMigrationResult(value, repoRoot = DEFAULT_REPO_ROOT) {
  validateArtifact('migration-result', value, repoRoot);
  if (value.status === 'PASS') {
    invariant(value.targetMatch === true, 'PASS requires targetMatch=true');
  }
  if (value.mode !== 'apply') {
    invariant(value.mutationPerformed === false, 'plan/dry-run results must not claim mutation');
  }
  if (value.applyHandoff) {
    invariant(value.applyHandoff.executed === false, 'This contract never executes apply; handoff.executed must be false');
  }
  return value;
}

export function buildMigrationResult({
  plan,
  status,
  verificationEvidence,
  applyHandoff = null,
  generatedAt = new Date().toISOString(),
  repoRoot = DEFAULT_REPO_ROOT,
}) {
  const result = {
    schemaVersion: 'asi.agent-os.migration-result.v1',
    planRef: `${plan.mechanismId}:${plan.target.environment}:${plan.target.identity}`,
    mode: plan.mode,
    status,
    target: {
      environment: plan.target.environment,
      identity: plan.target.identity,
    },
    targetMatch: plan.target.identity === plan.target.expectedIdentity,
    mutationPerformed: false,
    verificationEvidence,
    applyHandoff,
    generatedAt,
  };
  return validateMigrationResult(result, repoRoot);
}

export function evaluateApplyGate({
  plan,
  ownerGatePath = null,
  confirmationPhrase = null,
  repoRoot = DEFAULT_REPO_ROOT,
}) {
  invariant(plan.mode === 'apply', 'evaluateApplyGate requires mode=apply');
  assertTargetMatch(plan.target.identity, plan.target.expectedIdentity);

  if (plan.target.environment === 'production') {
    invariant(ownerGatePath, 'Production apply requires an owner-gate artifact path');
    const gate = readJson(path.join(repoRoot, ownerGatePath));
    validateOwnerGate(gate, {
      taskId: gate.taskId,
      action: 'production_migration',
      target: plan.target.environment,
      identity: gate.identity,
      allowedSideEffect: gate.allowedSideEffect,
      postActionVerification: gate.postActionVerification,
      scope: gate.authorization?.scope,
      taskCycle: gate.authorization?.taskCycle,
    }, repoRoot);
    invariant(gate.action === 'production_migration', 'Owner gate action must be production_migration');
    invariant(gate.target === 'production' || gate.target === plan.target.identity, 'Owner gate target mismatch');
    invariant(gate.status === 'approved', 'Owner gate must be approved');
    if (plan.applyGate.confirmationPhrase) {
      invariant(
        confirmationPhrase === plan.applyGate.confirmationPhrase,
        'Confirmation phrase mismatch',
      );
    }
  } else {
    invariant(confirmationPhrase, 'Non-production apply requires an explicit operator confirmation phrase');
  }

  const establishedApplyPath = plan.applyGate.establishedApplyPath;
  invariant(establishedApplyPath, 'Apply handoff requires establishedApplyPath');

  const satisfiedPlan = {
    ...plan,
    applyGate: {
      ...plan.applyGate,
      status: 'satisfied',
      confirmationPhrase: confirmationPhrase ?? plan.applyGate.confirmationPhrase,
    },
  };

  return buildMigrationResult({
    plan: satisfiedPlan,
    status: 'PASS',
    verificationEvidence: [
      'target identity matched',
      'apply gate satisfied',
      `handoff to established path ${establishedApplyPath}`,
      'no database mutation performed by migration-process.mjs',
    ],
    applyHandoff: {
      mechanismId: plan.mechanismId,
      establishedApplyPath,
      executed: false,
    },
    repoRoot,
  });
}

export function emitMigrationPlan(plan) {
  process.stdout.write(`${PLAN_MARKER}${JSON.stringify(plan)}\n`);
  return plan;
}

export function emitMigrationResult(result) {
  process.stdout.write(`${RESULT_MARKER}${JSON.stringify(result)}\n`);
  return result;
}

export function parseEmittedEvidence(output) {
  const plan = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith(PLAN_MARKER))
    .map((line) => JSON.parse(line.slice(PLAN_MARKER.length)))
    .at(-1);
  const result = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith(RESULT_MARKER))
    .map((line) => JSON.parse(line.slice(RESULT_MARKER.length)))
    .at(-1);
  return { plan, result };
}

function printUsage() {
  process.stderr.write(`Usage:
  node scripts/agent-os/migration-process.mjs plan --mechanism <id> --environment <env> --identity <id> --expected-identity <id>
  node scripts/agent-os/migration-process.mjs dry-run --mechanism <id> --environment <env> --identity <id> --expected-identity <id>
  node scripts/agent-os/migration-process.mjs apply --mechanism <id> --environment <env> --identity <id> --expected-identity <id> [--owner-gate <path>] [--confirm <phrase>]

Never connects to a database. apply only validates the gate and emits a non-executing handoff.
`);
}

function parseArgs(argv) {
  const [mode, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const value = rest[index + 1];
    invariant(value && !value.startsWith('--'), `Missing value for --${key}`);
    options[key] = value;
    index += 1;
  }
  return { mode, options };
}

export function runCli(argv = process.argv.slice(2), repoRoot = DEFAULT_REPO_ROOT) {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    printUsage();
    return 0;
  }

  const { mode, options } = parseArgs(argv);
  invariant(['plan', 'dry-run', 'apply'].includes(mode), `Unsupported mode: ${mode}`);
  invariant(options.mechanism, '--mechanism is required');
  invariant(options.environment, '--environment is required');
  invariant(options.identity, '--identity is required');
  invariant(options['expected-identity'], '--expected-identity is required');

  try {
    const plan = buildMigrationPlan({
      mode,
      mechanismId: options.mechanism,
      environment: options.environment,
      identity: options.identity,
      expectedIdentity: options['expected-identity'],
      repoRoot,
    });
    emitMigrationPlan(plan);

    if (mode === 'plan') {
      emitMigrationResult(buildMigrationResult({
        plan,
        status: 'PASS',
        verificationEvidence: [
          'plan generated without database access',
          `migrations=${plan.migrations.length}`,
          'mutationAllowed=false',
        ],
        repoRoot,
      }));
      return 0;
    }

    if (mode === 'dry-run') {
      emitMigrationResult(buildMigrationResult({
        plan,
        status: 'PASS',
        verificationEvidence: [
          'dry-run plan generated without database access',
          'target identity matched expectedIdentity',
          `migrations=${plan.migrations.length}`,
          'stop before any established apply backend',
        ],
        repoRoot,
      }));
      return 0;
    }

    const result = evaluateApplyGate({
      plan,
      ownerGatePath: options['owner-gate'] ?? null,
      confirmationPhrase: options.confirm ?? null,
      repoRoot,
    });
    emitMigrationResult(result);
    return 0;
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, error: error.message })}\n`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runCli();
}
