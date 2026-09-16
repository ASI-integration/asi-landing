import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildAcceptancePlan,
  buildAcceptanceResult,
  emitAcceptancePlan,
  emitAcceptanceResult,
  parseEmittedEvidence,
} from '../acceptance-contract.mjs';

function samplePlanInput(overrides = {}) {
  return {
    runnerId: 'sample-runner',
    environment: 'staging',
    identity: 'asi-staging',
    noExternalActions: true,
    isolated: true,
    namespace: 'asi_fixture_sample',
    cleanupRequired: true,
    cleanupStrategy: 'Delete fixture namespace rows and verify zero residue.',
    ownerGateRequired: false,
    ...overrides,
  };
}

function sampleResultInput(overrides = {}) {
  return {
    runnerId: 'sample-runner',
    planRef: 'asi_fixture_sample',
    environment: 'staging',
    identity: 'asi-staging',
    status: 'PASS',
    noExternalActions: true,
    productionMutation: false,
    cleanupPerformed: true,
    verifyZeroResidue: true,
    evidence: ['fixture removed'],
    ...overrides,
  };
}

test('buildAcceptancePlan produces a schema-valid plan', () => {
  const plan = buildAcceptancePlan(samplePlanInput());
  assert.equal(plan.schemaVersion, 'asi.agent-os.acceptance-plan.v1');
  assert.equal(plan.target.environment, 'staging');
  assert.equal(plan.safety.noExternalActions, true);
});

test('buildAcceptancePlan rejects external actions without justification', () => {
  assert.throws(
    () => buildAcceptancePlan(samplePlanInput({ noExternalActions: false })),
    /External actions require a justification/,
  );
});

test('buildAcceptancePlan fails closed on production without owner gate', () => {
  assert.throws(
    () => buildAcceptancePlan(samplePlanInput({ environment: 'production', identity: 'asi-production' })),
    /Production plan requires owner gate/,
  );
});

test('production plan with owner gate declared is accepted', () => {
  const plan = buildAcceptancePlan(samplePlanInput({
    environment: 'production',
    identity: 'asi-production',
    ownerGateRequired: true,
  }));
  assert.equal(plan.target.environment, 'production');
  assert.equal(plan.ownerGateRequired, true);
});

test('buildAcceptanceResult produces a schema-valid result', () => {
  const result = buildAcceptanceResult(sampleResultInput());
  assert.equal(result.schemaVersion, 'asi.agent-os.acceptance-result.v1');
  assert.equal(result.status, 'PASS');
});

test('buildAcceptanceResult rejects a PASS status without cleanup performed', () => {
  assert.throws(
    () => buildAcceptanceResult(sampleResultInput({ cleanupPerformed: false })),
    /A passing result must have performed cleanup/,
  );
});

test('buildAcceptanceResult fails closed on production mutation', () => {
  assert.throws(
    () => buildAcceptanceResult(sampleResultInput({
      environment: 'production',
      identity: 'asi-production',
      productionMutation: true,
    })),
    /Production result must not mutate production/,
  );
});

test('emit/parse round-trip recovers plan and result evidence from stdout', () => {
  const plan = buildAcceptancePlan(samplePlanInput());
  const result = buildAcceptanceResult(sampleResultInput());
  const originalWrite = process.stdout.write.bind(process.stdout);
  let captured = '';
  process.stdout.write = (chunk) => {
    captured += chunk;
    return true;
  };
  try {
    emitAcceptancePlan(plan);
    emitAcceptanceResult(result);
  } finally {
    process.stdout.write = originalWrite;
  }
  const parsed = parseEmittedEvidence(captured);
  assert.deepEqual(parsed.plan, plan);
  assert.deepEqual(parsed.result, result);
});
