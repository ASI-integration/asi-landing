import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkProductionOwnerGateCoverage } from '../check-production-owner-gate-coverage.mjs';
import { enforceProductionOwnerGate } from '../enforce-production-owner-gate.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const sha = '2222222222222222222222222222222222222222';

function approvedGate(overrides = {}) {
  return {
    schemaVersion: 'asi.agent-os.owner-gate.v1',
    taskId: 'ao003-production-owner-gate',
    status: 'approved',
    action: 'production_deploy',
    target: 'production',
    identity: { sha },
    allowedSideEffect: 'Deploy the exact approved artifact.',
    postActionVerification: ['Verify the exact runtime SHA.'],
    authorization: {
      source: 'explicit_owner_message',
      owner: 'Nikolay',
      scope: 'production deploy only',
      taskCycle: 'ao003-cycle-1',
    },
    typedConfirmation: { present: true, countsAsOwnerApproval: false },
    ...overrides,
  };
}

test('valid approved production owner-gate passes', () => {
  const result = enforceProductionOwnerGate({
    gate: approvedGate(),
    requestedAction: 'production_deploy',
    environmentIdentity: 'production',
    targetIdentity: { sha },
    repoRoot,
  });
  assert.equal(result.ok, true);
  assert.equal(result.action, 'production_deploy');
});

test('missing gate fails closed', () => {
  assert.throws(
    () => enforceProductionOwnerGate({
      gate: null,
      requestedAction: 'production_deploy',
      environmentIdentity: 'production',
      repoRoot,
    }),
    /missing gate/,
  );
});

test('malformed gate fails closed', () => {
  assert.throws(
    () => enforceProductionOwnerGate({
      gate: { schemaVersion: 'asi.agent-os.owner-gate.v1', status: 'approved' },
      requestedAction: 'production_deploy',
      environmentIdentity: 'production',
      repoRoot,
    }),
    /malformed gate|required property|must have|missing/i,
  );
});

test('typed confirmation alone fails closed', () => {
  assert.throws(
    () => enforceProductionOwnerGate({
      gate: approvedGate({
        status: 'missing',
        authorization: null,
        typedConfirmation: { present: true, countsAsOwnerApproval: false },
      }),
      requestedAction: 'production_deploy',
      environmentIdentity: 'production',
      targetIdentity: { sha },
      repoRoot,
    }),
    /typed confirmation alone is not owner approval/,
  );
});

test('consumed gate fails closed', () => {
  assert.throws(
    () => enforceProductionOwnerGate({
      gate: approvedGate({
        status: 'consumed',
        authorization: null,
      }),
      requestedAction: 'production_deploy',
      environmentIdentity: 'production',
      targetIdentity: { sha },
      repoRoot,
    }),
    /consumed gate cannot authorize/,
  );
});

test('action mismatch fails closed', () => {
  assert.throws(
    () => enforceProductionOwnerGate({
      gate: approvedGate(),
      requestedAction: 'production_migration',
      environmentIdentity: 'production',
      targetIdentity: { sha },
      repoRoot,
    }),
    /action mismatch/,
  );
});

test('target/SHA mismatch fails closed', () => {
  assert.throws(
    () => enforceProductionOwnerGate({
      gate: approvedGate(),
      requestedAction: 'production_deploy',
      environmentIdentity: 'production',
      targetIdentity: { sha: '3333333333333333333333333333333333333333' },
      repoRoot,
    }),
    /target identity mismatch/,
  );
});

test('staging approval cannot authorize production', () => {
  assert.throws(
    () => enforceProductionOwnerGate({
      gate: approvedGate({ target: 'staging' }),
      requestedAction: 'production_deploy',
      environmentIdentity: 'production',
      targetIdentity: { sha },
      repoRoot,
    }),
    /staging\/non-production gate target cannot authorize production/,
  );
});

test('non-production environment identity fails closed', () => {
  assert.throws(
    () => enforceProductionOwnerGate({
      gate: approvedGate(),
      requestedAction: 'production_deploy',
      environmentIdentity: 'staging',
      targetIdentity: { sha },
      repoRoot,
    }),
    /environment identity must be production/,
  );
});

test('read-only production workflow is not falsely classified as mutating', () => {
  const inventory = JSON.parse(
    fs.readFileSync(path.join(repoRoot, 'docs/agent-os/production-workflow-inventory.json'), 'utf8'),
  );
  const readOnly = inventory.workflows.filter((entry) => entry.class === 'B');
  assert.ok(readOnly.length >= 1);
  for (const entry of readOnly) {
    assert.notEqual(entry.class, 'A');
    const text = fs.readFileSync(path.join(repoRoot, entry.path), 'utf8');
    assert.match(text, /READ_ONLY|read-only|readonly|SELECT 1|default_transaction_read_only|inspect|diagnos|audit/i);
  }
  assert.ok(
    readOnly.some((entry) => entry.path.includes('production-partner-schema-readonly-audit')),
  );
});

test('every discovered production mutator is covered by the shared gate', () => {
  const result = checkProductionOwnerGateCoverage(repoRoot);
  assert.equal(result.uncoveredCount, 0, result.errors.join('\n'));
  assert.equal(result.covered, result.discoveredMutators);
  assert.ok(result.discoveredMutators >= 1);
  assert.equal(result.ok, true);
});

test('coverage checker fails when a class-A workflow bypasses the shared gate', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ao003-coverage-'));
  const workflowsDir = path.join(tmp, '.github', 'workflows');
  fs.mkdirSync(workflowsDir, { recursive: true });
  fs.mkdirSync(path.join(tmp, 'docs', 'agent-os'), { recursive: true });

  const mutator = 'bypass-mutator.yml';
  fs.writeFileSync(path.join(workflowsDir, mutator), `
name: Bypass
on:
  workflow_dispatch:
jobs:
  mutate:
    runs-on: ubuntu-latest
    environment: production
    steps:
      - run: echo DEPLOY_PRODUCTION && pm2 restart app
`);
  fs.writeFileSync(path.join(workflowsDir, 'safe.yml'), `
name: Safe
on:
  pull_request:
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: echo ok
`);
  fs.writeFileSync(
    path.join(tmp, 'docs', 'agent-os', 'production-workflow-inventory.json'),
    JSON.stringify({
      schemaVersion: 'asi.agent-os.production-workflow-inventory.v1',
      workflows: [
        {
          path: `.github/workflows/${mutator}`,
          class: 'A',
          action: 'production_deploy',
          reason: 'test',
        },
        {
          path: '.github/workflows/safe.yml',
          class: 'C',
          action: null,
          reason: 'ci',
        },
      ],
    }, null, 2),
  );

  const result = checkProductionOwnerGateCoverage(tmp);
  assert.equal(result.ok, false);
  assert.ok(result.uncoveredCount >= 1);
  assert.ok(result.errors.some((error) => /uncovered production mutator/.test(error)));
});
