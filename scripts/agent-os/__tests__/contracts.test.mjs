import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  loadChangeMap,
  selectChecks,
  validateContractBundle,
  validateOwnerGate,
  validateProductionPreflight,
} from '../contracts.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

test('contract bundle and safe fixtures validate', () => {
  assert.deepEqual(validateContractBundle(repoRoot), { schemas: 5, fixtures: 5 });
});

test('typed confirmation cannot become owner approval', () => {
  assert.throws(
    () => validateOwnerGate({
      schemaVersion: 'asi.agent-os.owner-gate.v1',
      status: 'approved',
      authorization: null,
      typedConfirmation: { present: true, countsAsOwnerApproval: false },
    }),
    /explicit owner message/,
  );
});

test('production preflight fails closed on dispatch', () => {
  assert.throws(
    () => validateProductionPreflight({
      schemaVersion: 'asi.agent-os.production-preflight.v1',
      mode: 'read-only-preflight',
      dispatchAllowed: true,
      mutationAllowed: false,
      secretValuesAllowed: false,
    }),
    /dispatch must be disabled/,
  );
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
