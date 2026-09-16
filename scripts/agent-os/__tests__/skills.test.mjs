import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { REQUIRED_SKILLS, validateSkillStructure } from '../validate-skills.mjs';
import { buildStagingPreflight } from '../../../.agents/skills/asi-staging-acceptance/scripts/staging-preflight.mjs';
import { buildStagingResult } from '../../../.agents/skills/asi-staging-acceptance/scripts/staging-result.mjs';
import { verifyReleaseIdentity } from '../../../.agents/skills/asi-production-rollout/scripts/verify-release-identity.mjs';
import { buildProductionRolloutReport } from '../../../.agents/skills/asi-production-rollout/scripts/red-approval-check.mjs';
import { readJson } from '../contracts.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const fixtures = path.join(repoRoot, 'docs/agent-os/fixtures');

test('required project skills are installed and structurally valid', () => {
  const result = validateSkillStructure(repoRoot);
  assert.equal(result.ok, true);
  assert.equal(result.skillCount, 3);
  assert.deepEqual(result.skills.map((skill) => skill.id).sort(), REQUIRED_SKILLS.map((skill) => skill.id).sort());
});

test('validate-skills CLI passes on the repository checkout', () => {
  const script = path.join(repoRoot, 'scripts/agent-os/validate-skills.mjs');
  const run = spawnSync(process.execPath, [script], { cwd: repoRoot, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.equal(JSON.parse(run.stdout).ok, true);
});

test('staging skill blocks invalid project ref before any remote action', () => {
  const fixture = readJson(path.join(fixtures, 'isolated-staging-fixture.json'));
  const identity = readJson(path.join(fixtures, 'staging-identity-bad-ref.json'));
  const preflight = buildStagingPreflight({ fixture, identity, repoRoot });
  assert.equal(preflight.status, 'BLOCKED');
  assert.ok(preflight.blockers.some((item) => /project ref/i.test(item)));
  assert.equal(preflight.safety.networkAccess, false);
  assert.equal(preflight.safety.mutateStaging, false);
});

test('staging skill blocks missing dry-run flag', () => {
  const fixture = readJson(path.join(fixtures, 'isolated-staging-fixture.json'));
  const identity = readJson(path.join(fixtures, 'staging-identity-missing-dry-run.json'));
  const preflight = buildStagingPreflight({ fixture, identity, repoRoot });
  assert.equal(preflight.status, 'BLOCKED');
  assert.ok(preflight.blockers.some((item) => /dryRun/i.test(item)));
});

test('staging skill passes isolated fixture and reports zero residue locally', () => {
  const fixture = readJson(path.join(fixtures, 'isolated-staging-fixture.json'));
  const identity = readJson(path.join(fixtures, 'staging-identity-valid.json'));
  const preflight = buildStagingPreflight({ fixture, identity, repoRoot });
  assert.equal(preflight.status, 'READY');
  const result = buildStagingResult({ fixture, preflight, repoRoot });
  assert.equal(result.status, 'PASS');
  assert.equal(result.noExternalActions, true);
  assert.equal(result.mutateStaging, false);
  assert.equal(result.cleanup.residueCount, 0);
  assert.equal(result.observedSha, identity.requestedSha);
});

test('production skill returns AWAITING_OWNER without approval and never allows dispatch', () => {
  const expected = readJson(path.join(fixtures, 'production-expected-deploy.json'));
  const report = buildProductionRolloutReport({
    repoRoot,
    requestedAction: expected.action,
    target: expected.target,
    requestedSha: expected.identity.sha,
    sourceSha: expected.identity.sha,
    identityMatched: true,
    gate: null,
    expected,
  });
  assert.equal(report.status, 'AWAITING_OWNER');
  assert.equal(report.dispatchAllowed, false);
  assert.equal(report.mutationAllowed, false);
  assert.equal(report.ownerGateStatus, 'missing');
  assert.equal(report.preflight.mode, 'read-only-preflight');
});

test('production skill blocks SHA mismatch', () => {
  const identity = verifyReleaseIdentity({
    repoRoot,
    requestedSha: '1111111111111111111111111111111111111111',
    sourceRef: 'HEAD',
  });
  assert.equal(identity.identityMatched, false);
  assert.equal(identity.status, 'BLOCKED');

  const expected = readJson(path.join(fixtures, 'production-expected-deploy.json'));
  const report = buildProductionRolloutReport({
    repoRoot,
    requestedAction: expected.action,
    target: expected.target,
    requestedSha: '1111111111111111111111111111111111111111',
    sourceSha: '2222222222222222222222222222222222222222',
    identityMatched: false,
    gate: null,
    expected,
  });
  assert.equal(report.status, 'BLOCKED');
  assert.equal(report.dispatchAllowed, false);
});

test('production deploy approval does not authorize migration', () => {
  const expected = readJson(path.join(fixtures, 'production-expected-deploy.json'));
  const gate = readJson(path.join(fixtures, 'production-approved-deploy-gate.json'));
  const report = buildProductionRolloutReport({
    repoRoot,
    requestedAction: 'production_migration',
    target: 'production',
    requestedSha: expected.identity.sha,
    sourceSha: expected.identity.sha,
    identityMatched: true,
    gate,
    expected: {
      ...expected,
      action: 'production_migration',
      allowedSideEffect: 'Apply only the approved migration.',
      scope: 'production migration only',
    },
  });
  assert.equal(report.status, 'BLOCKED');
  assert.ok(report.blockers.some((item) => /action/i.test(item)));
  assert.equal(report.dispatchAllowed, false);
  assert.equal(report.mutationAllowed, false);
});

test('valid deploy gate still remains preflight-only with dispatch disabled', () => {
  const expected = readJson(path.join(fixtures, 'production-expected-deploy.json'));
  const gate = readJson(path.join(fixtures, 'production-approved-deploy-gate.json'));
  const report = buildProductionRolloutReport({
    repoRoot,
    requestedAction: expected.action,
    target: expected.target,
    requestedSha: expected.identity.sha,
    sourceSha: expected.identity.sha,
    identityMatched: true,
    gate,
    expected,
  });
  assert.equal(report.status, 'PREFLIGHT_ONLY');
  assert.equal(report.dispatchAllowed, false);
  assert.equal(report.mutationAllowed, false);
  assert.equal(report.ownerGateStatus, 'approved');
});
