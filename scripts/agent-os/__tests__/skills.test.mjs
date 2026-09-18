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
import { buildWebsiteEditorPreflight } from '../../../.agents/skills/asi-website-editor/scripts/preflight.mjs';
import { readJson } from '../contracts.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const fixtures = path.join(repoRoot, 'docs/agent-os/fixtures');

test('required project skills are installed and structurally valid', () => {
  const result = validateSkillStructure(repoRoot);
  assert.equal(result.ok, true);
  assert.equal(result.skillCount, 4);
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

test('website editor skill defaults to read-only review with apply disabled', () => {
  const preflight = buildWebsiteEditorPreflight({ market: 'ru', mode: 'review', route: '/ru', repoRoot });
  assert.equal(preflight.status, 'READY');
  assert.equal(preflight.applyAllowed, false);
  assert.equal(preflight.source, 'src/app/ru/page.tsx');
});

test('website editor skill blocks unsupported market and unmapped route', () => {
  const badMarket = buildWebsiteEditorPreflight({ market: 'en', mode: 'review', route: '/ru', repoRoot });
  assert.equal(badMarket.status, 'BLOCKED');
  assert.ok(badMarket.blockers.some((item) => /market/i.test(item)));

  const badRoute = buildWebsiteEditorPreflight({ market: 'ru', mode: 'review', route: '/ru/nowhere', repoRoot });
  assert.equal(badRoute.status, 'BLOCKED');
  assert.ok(badRoute.blockers.some((item) => /route/i.test(item)));
});

test('website editor skill returns AWAITING_OWNER for apply without a gate and never dictates wording', () => {
  const preflight = buildWebsiteEditorPreflight({ market: 'ru', mode: 'apply', route: '/ru', repoRoot });
  assert.equal(preflight.status, 'AWAITING_OWNER');
  assert.equal(preflight.applyAllowed, false);
  assert.equal(preflight.proposedScope.action, 'approved_ux_or_public_copy_change');
  assert.equal(preflight.proposedScope.target, 'ru-public-site:/ru');
  assert.equal('replacementText' in preflight, false);
});

test('website editor apply is blocked by a gate approved for a different action/target', () => {
  const expected = readJson(path.join(fixtures, 'website-editor-expected-apply.json'));
  const mismatchedGate = readJson(path.join(fixtures, 'production-approved-deploy-gate.json'));
  const preflight = buildWebsiteEditorPreflight({
    market: 'ru',
    mode: 'apply',
    route: '/ru',
    gate: mismatchedGate,
    expected,
    repoRoot,
  });
  assert.equal(preflight.status, 'BLOCKED');
  assert.equal(preflight.applyAllowed, false);
});

test('website editor apply is READY_TO_APPLY only with a matching approved owner gate, and still never merges/deploys', () => {
  const expected = readJson(path.join(fixtures, 'website-editor-expected-apply.json'));
  const gate = readJson(path.join(fixtures, 'website-editor-approved-apply-gate.json'));
  const preflight = buildWebsiteEditorPreflight({
    market: 'ru',
    mode: 'apply',
    route: '/ru',
    gate,
    expected,
    repoRoot,
  });
  assert.equal(preflight.status, 'READY_TO_APPLY');
  assert.equal(preflight.applyAllowed, true);
  assert.equal('merged' in preflight, false);
  assert.equal('deployed' in preflight, false);
});

test('website editor skill distinguishes production pre-edit baseline from branch-rendered post-edit verification', () => {
  const review = buildWebsiteEditorPreflight({ market: 'ru', mode: 'review', route: '/ru', repoRoot });
  const { verification } = review;
  assert.ok(verification.preEditBaseline.startsWith('https://www.asi-global.ru'));
  assert.ok(verification.postEditTarget.startsWith('http://127.0.0.1:'));
  assert.notEqual(verification.preEditBaseline, verification.postEditTarget);
  assert.equal(verification.productionMaySubstituteForPostEditVerification, false);

  const expected = readJson(path.join(fixtures, 'website-editor-expected-apply.json'));
  const gate = readJson(path.join(fixtures, 'website-editor-approved-apply-gate.json'));
  const apply = buildWebsiteEditorPreflight({ market: 'ru', mode: 'apply', route: '/ru', gate, expected, repoRoot });
  assert.deepEqual(apply.verification, verification);
  assert.equal(apply.status, 'READY_TO_APPLY');
});

test('website editor skill and its fixtures never encode the live homepage hero text or its answer', () => {
  const homepageSource = fs.readFileSync(path.join(repoRoot, 'src/app/ru/page.tsx'), 'utf8');
  const heroMatch = homepageSource.match(/<BrandHeadline\s+as="h1"[^>]*>\s*([^<]+?)\s*<\/BrandHeadline>/);
  assert.ok(heroMatch, 'Expected to locate the current RU homepage h1 to run the blind-acceptance guard');
  const currentHeroText = heroMatch[1].trim();
  assert.ok(currentHeroText.length > 5);

  const skillRoot = path.join(repoRoot, '.agents/skills/asi-website-editor');
  const fixturePaths = [
    path.join(fixtures, 'website-editor-expected-apply.json'),
    path.join(fixtures, 'website-editor-approved-apply-gate.json'),
  ];

  function collectFiles(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      return entry.isDirectory() ? collectFiles(full) : [full];
    });
  }

  const filesToCheck = [...collectFiles(skillRoot), ...fixturePaths];
  for (const filePath of filesToCheck) {
    const content = fs.readFileSync(filePath, 'utf8');
    assert.equal(
      content.includes(currentHeroText),
      false,
      `${path.relative(repoRoot, filePath)} must not encode the current live homepage hero text`,
    );
  }
});
