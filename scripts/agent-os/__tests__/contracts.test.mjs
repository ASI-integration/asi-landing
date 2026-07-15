import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  buildBlockedTaskPreflight,
  buildTaskPreflight,
  loadChangeMap,
  selectChecks,
  validateArtifact,
  validateContractBundle,
  validateOwnerGate,
  validateProductionPreflight,
  validateTaskPreflight,
} from '../contracts.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const sha = '2222222222222222222222222222222222222222';
const expectedApproval = {
  taskId: 'release-102',
  action: 'production_deploy',
  target: 'production',
  identity: { sha },
  allowedSideEffect: 'Deploy the exact approved artifact.',
  postActionVerification: ['Verify the exact runtime SHA.'],
  scope: 'production deploy only',
  taskCycle: 'release-102-cycle-1',
};

function approvedGate(overrides = {}) {
  return {
    schemaVersion: 'asi.agent-os.owner-gate.v1',
    taskId: expectedApproval.taskId,
    status: 'approved',
    action: expectedApproval.action,
    target: expectedApproval.target,
    identity: expectedApproval.identity,
    allowedSideEffect: expectedApproval.allowedSideEffect,
    postActionVerification: expectedApproval.postActionVerification,
    authorization: {
      source: 'explicit_owner_message',
      owner: 'Nikolay',
      scope: expectedApproval.scope,
      taskCycle: expectedApproval.taskCycle,
    },
    typedConfirmation: { present: true, countsAsOwnerApproval: false },
    ...overrides,
  };
}

test('contract bundle validates real fixtures with Draft 2020-12 schemas', () => {
  assert.deepEqual(validateContractBundle(repoRoot), { schemas: 5, fixtures: 5 });
});

test('Draft 2020-12 validation rejects an incomplete approved owner gate', () => {
  for (const field of ['action', 'target', 'identity', 'allowedSideEffect', 'postActionVerification']) {
    const incomplete = approvedGate();
    delete incomplete[field];
    assert.throws(() => validateOwnerGate(incomplete, expectedApproval), new RegExp(`required property '${field}'`));
  }
  const incompleteAuthorization = approvedGate();
  delete incompleteAuthorization.authorization.scope;
  assert.throws(() => validateOwnerGate(incompleteAuthorization, expectedApproval), /required property 'scope'/);
});

test('complete approved owner gate matches the exact runtime contract', () => {
  assert.doesNotThrow(() => validateOwnerGate(approvedGate(), expectedApproval));
});

test('typed confirmation alone cannot become owner approval', () => {
  assert.throws(
    () => validateOwnerGate({
      ...approvedGate(),
      authorization: null,
    }, expectedApproval),
    /must be object/,
  );
});

test('approved owner gate rejects action mismatch', () => {
  assert.throws(
    () => validateOwnerGate(approvedGate({ action: 'production_rollback' }), expectedApproval),
    /action mismatch/,
  );
});

test('approved owner gate rejects exact target mismatch', () => {
  assert.throws(
    () => validateOwnerGate(approvedGate({ target: 'staging' }), expectedApproval),
    /target mismatch/,
  );
});

test('approved owner gate rejects SHA mismatch', () => {
  assert.throws(
    () => validateOwnerGate(approvedGate({ identity: { sha: '3333333333333333333333333333333333333333' } }), expectedApproval),
    /identity mismatch/,
  );
});

test('approved owner gate rejects task-cycle mismatch', () => {
  assert.throws(
    () => validateOwnerGate(approvedGate({
      authorization: { ...approvedGate().authorization, taskCycle: 'old-cycle' },
    }), expectedApproval),
    /task cycle mismatch/,
  );
});

test('consumed owner gate cannot be reused', () => {
  assert.throws(
    () => validateOwnerGate(approvedGate({ status: 'consumed', authorization: null }), expectedApproval),
    /status consumed cannot authorize action/,
  );
});

test('production preflight fails closed on dispatch', () => {
  assert.throws(
    () => validateProductionPreflight({
      schemaVersion: 'asi.agent-os.production-preflight.v1',
      taskId: 'unsafe-dispatch',
      mode: 'read-only-preflight',
      dispatchAllowed: true,
      mutationAllowed: false,
      secretValuesAllowed: false,
      requestedAction: 'production_deploy',
      evidence: [],
      status: 'PREFLIGHT_ONLY',
    }),
    /must be equal to constant/,
  );
});

test('location changes override Issue classification and await owner', () => {
  const result = buildTaskPreflight({
    input: {
      task: {
        id: 'location-contract-change',
        title: 'Change location scoring',
        objective: 'Exercise fail-closed classification.',
        acceptanceCriteria: ['Owner gate is required.'],
        inScope: ['src/lib/location/scoring.ts'],
        outOfScope: ['External environments'],
      },
      classification: 'green',
      redActions: [],
      focusedTests: [],
    },
    repository: {
      name: 'ASI-integration/asi-landing',
      baselineSha: '0000000000000000000000000000000000000000',
      headRef: 'codex/location-contract-change',
    },
    paths: ['src/lib/location/scoring.ts'],
    map: loadChangeMap(repoRoot),
  });
  assert.equal(result.preflight.classification, 'red');
  assert.equal(result.preflight.status, 'AWAITING_OWNER');
  assert.deepEqual(result.preflight.redActions, ['location_scoring_or_public_contract_change']);
});

test('BLOCKED preflight fallback is a schema-valid machine artifact', () => {
  const result = buildBlockedTaskPreflight({
    input: {},
    repository: {},
    paths: ['tmp/unsafe-artifact.json'],
    map: loadChangeMap(repoRoot),
    reason: 'Task input failed validation.',
  });
  assert.equal(result.preflight.status, 'BLOCKED');
  assert.deepEqual(result.preflight.blockers, ['Task input failed validation.']);
  assert.doesNotThrow(() => validateTaskPreflight(result.preflight));
});

test('preflight CLI returns a schema-valid BLOCKED artifact on validation failure', () => {
  const script = path.join(repoRoot, '.agents/skills/asi-task-execution/scripts/preflight.mjs');
  const run = spawnSync(process.execPath, [script], { cwd: repoRoot, encoding: 'utf8' });
  assert.equal(run.status, 1);
  const output = JSON.parse(run.stderr);
  assert.equal(output.ok, false);
  assert.equal(output.preflight.status, 'BLOCKED');
  assert.doesNotThrow(() => validateTaskPreflight(output.preflight));
});

test('change map selects contract checks and protected staging paths', () => {
  const map = loadChangeMap(repoRoot);
  const selected = selectChecks([
    'docs/agent-os/OWNER_GATE.md',
    'scripts/rollback-artifact-staging.sh',
  ], map);
  assert(selected.checks.includes('agent-os-contract-validation'));
  assert(selected.checks.includes('fail-closed-guard'));
  assert.deepEqual(selected.protectedPaths, ['scripts/rollback-artifact-staging.sh']);
});

test('change map recognizes repository-local Skill paths', () => {
  const selected = selectChecks(
    ['.agents/skills/asi-task-execution/SKILL.md'],
    loadChangeMap(repoRoot),
  );
  assert.deepEqual(selected.matchedRuleIds, ['agent-os-contracts']);
  assert(selected.checks.includes('skill-quick-validate'));
});

test('runtime artifacts reject properties outside their schema', () => {
  assert.throws(
    () => validateArtifact('staging-fixture', {
      schemaVersion: 'asi.agent-os.staging-fixture.v1',
      unexpected: true,
    }),
    /must NOT have additional properties/,
  );
});
