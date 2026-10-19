import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { checkPr, validateContract, CONTRACT, GOVERNANCE, verifiedOwnerComment, previousDiagnostics } from '../check-demo-release.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const seed = JSON.parse(fs.readFileSync(path.join(root, CONTRACT), 'utf8'));
const sha = 'd'.repeat(40);
const copy = () => structuredClone(seed);
const known = new Set(seed.stages.flatMap(s => s.files));
const body = (stage = 'S4-G1', mode = 'implementation', iteration = '') =>
  'Release-Stage: ' + stage + '\nRelease-Mode: ' + mode + '\n' +
  (iteration ? 'Release-Diagnostic-Iteration: ' + iteration + '\n' : '');
const check = (o = {}) => checkPr({
  contract: seed, changed: ['scripts/strigunov4/c4_unit_contract.py'],
  prNumber: 520, prBody: body(), headSha: sha, baseHasContract: true,
  ownerApproval: false, ...o,
});

test('01 seeded contract selects exact first incomplete stage', () => {
  const v = validateContract(seed, known);
  assert.equal(v.nextStage, 'S4-G1');
  assert.equal(v.remainingStages, 6);
  assert.ok(Object.keys(v.fileCounts).length >= 30);
});
test('02 current-stage constrained PR accepted; prior PR grandfathered', () => {
  assert.equal(check().status, 'CURRENT_MILESTONE_SCOPED');
  assert.equal(check({ prNumber: 509,
    headSha: '5ba61e734a1f9a56cd807eee91b4e217bf6ee040',
    changed: ['outside/old-pr-only.ts'] }).status, 'EXISTING_PR_GRANDFATHERED');
  assert.throws(() => check({ prNumber: 509, changed: ['outside/old-pr-only.ts'] }),
    /LEGACY_HEAD_CHANGED_REQUIRES_OWNER_ATTESTATION/);
});
test('03 no unrelated files and no bypass by PR body', () => {
  assert.throws(() => check({ changed: ['src/new-unused-feature.ts'],
    prBody: body() + 'Release-Exception: approved\n' }), /PR_HAS_OUT_OF_STAGE_FILES/);
  assert.throws(() => check({ changed: ['scripts/strigunov4/c4_unit_contract.py', 'src/extra.ts'] }),
    /PR_HAS_OUT_OF_STAGE_FILES/);
});
test('04 cannot skip milestone or claim a different stage', () => {
  assert.throws(() => check({ prBody: body('S4-G4') }), /PR_MUST_TARGET_CURRENT_RELEASE_GATE:S4-G1/);
  assert.throws(() => check({ prBody: 'Release-Stage: S4-G1\n' }), /PR_MUST_TARGET_CURRENT_RELEASE_GATE/);
});
test('05 diagnostic limit requires a new owner decision after two', () => {
  assert.equal(check({ prBody: body('S4-G1', 'diagnostic', '1') }).status,
    'CURRENT_MILESTONE_SCOPED');
  assert.equal(check({ prBody: body('S4-G1', 'diagnostic', '2'),
    priorDiagnosticCount: 1 }).status, 'CURRENT_MILESTONE_SCOPED');
  assert.throws(() => check({ prBody: body('S4-G1', 'diagnostic', '1'),
    priorDiagnosticCount: 2 }), /DIAGNOSTIC_LIMIT_REQUIRES_DECISION/);
  assert.throws(() => check({ prBody: body('S4-G1', 'diagnostic', '2') }),
    /DIAGNOSTIC_LIMIT_REQUIRES_DECISION/);
  for (const n of ['0', '3', '100', 'true']) {
    assert.throws(() => check({ prBody: body('S4-G1', 'diagnostic', n) }),
      /DIAGNOSTIC_LIMIT_REQUIRES_DECISION/);
  }
});
test('06 governance file changes fail without verified external owner approval', () => {
  const p = [...GOVERNANCE][0];
  assert.throws(() => check({ changed: [p], prBody: 'Release-Stage: S4-G1\n' }),
    /GOVERNANCE_CHANGE_NEEDS_VERIFIED_OWNER_ATTESTATION/);
  assert.equal(check({ changed: [p], ownerApproval: true }).status,
    'OWNER_ATTESTED_GOVERNANCE_CHANGE');
});
test('07 owner-approved release exception is distinct from self-declaration', () => {
  assert.equal(check({ changed: ['src/unplanned.ts'], ownerApproval: true }).status,
    'OWNER_ATTESTED_RELEASE_EXCEPTION');
});
test('08 only first release bootstrap may contain limited governance paths', () => {
  assert.equal(check({ baseHasContract: false, changed: [CONTRACT, 'scripts/agent-os/check-demo-release.mjs'] }).status,
    'BOOTSTRAP_REQUIRES_OWNER_MERGE');
  assert.throws(() => check({ baseHasContract: false,
    changed: [CONTRACT, 'src/app/api/booking-ops/intake/web/route.ts'] }),
    /BOOTSTRAP_MUST_ONLY_TOUCH_GOVERNANCE/);
});
test('09 stage files, order and active stage cannot be fabricated', () => {
  const planned = 'scripts/strigunov4/protected_c4_unit_apply.py';
  assert.equal(check({ changed: [planned] }).status, 'CURRENT_MILESTONE_SCOPED');
  const missing = copy(); missing.stages[0].plannedFiles.push('src/unrelated-feature.ts');
  assert.throws(() => validateContract(missing, known), /STAGE_PLANNED_FILES/);
  const duplicate = copy(); duplicate.stages[0].plannedFiles.push(planned);
  assert.throws(() => validateContract(duplicate, known), /STAGE_PLANNED_FILES/);
  const a = copy(); a.stages[0].files.push('src/not-tracked.ts');
  assert.throws(() => validateContract(a, known), /STAGE_FILE_NOT_TRACKED_OR_PINNED/);
  const b = copy(); b.stages[1].status = 'IN_PROGRESS';
  assert.throws(() => validateContract(b, known), /ONLY_ONE_ACTIVE_STAGE/);
  const c = copy(); c.stages[3].status = 'ACCEPTED';
  c.stages[3].proof = ['https://github.com/ASI-integration/asi-landing/actions/runs/42'];
  assert.throws(() => validateContract(c, known), /ACCEPTED_REQUIRES_INDEPENDENT_RUN_EVIDENCE/);
});
test('10 acceptance only moves next after sequential physical proof', () => {
  const next = copy();
  next.stages[0].status = 'ACCEPTED';
  next.stages[0].proof = ['https://github.com/ASI-integration/asi-landing/actions/runs/39261951787'];
  next.stages[1].status = 'IN_PROGRESS';
  const status = validateContract(next, known);
  assert.equal(status.nextStage, 'S4-G2');
  assert.equal(check({ contract: next, prBody: body('S4-G2'),
    changed: ['scripts/strigunov4/c4_operator_host.py'] }).status, 'CURRENT_MILESTONE_SCOPED');
});
test('11 a finished release cannot quietly reopen without new owner scope', () => {
  const a = copy();
  for (const stage of a.stages) {
    stage.status = 'ACCEPTED';
    stage.proof = ['https://github.com/ASI-integration/asi-landing/actions/runs/39261951787'];
  }
  assert.throws(() => validateContract(a, known),
    /FULL_RELEASE_CLOSURE_REQUIRES_SEPARATE_OWNER_GATE/);
});
test('12 metadata drift and pinned branch evidence are rejected', () => {
  const a = copy(); a.pendingPrPaths[0].headSha = sha;
  assert.throws(() => validateContract(a, known), /PENDING_PR_PIN/);
  const b = copy(); b.transition.legacyPrMax = 9999;
  assert.throws(() => validateContract(b, known), /RELEASE_TRANSITION/);
  assert.throws(() => check({ headSha: 'not-a-sha' }), /PR_ID/);
});

test('13 rejects forged owner comments, accepts only exact owner+SHA+action', async () => {
  const previous = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({ok: true, json: async () => [
      {user: {id: 9999}, body: 'ASI-OWNER-APPROVE:CONTRACT-CHANGE:520:' + sha},
      {user: {id: 207600140}, body: 'ASI-OWNER-APPROVE:CONTRACT-CHANGE:520:' + sha},
    ]});
    assert.equal(await verifiedOwnerComment(520, sha, 'CONTRACT-CHANGE', 'token'), true);
    assert.equal(await verifiedOwnerComment(520, sha, 'RELEASE-EXCEPTION', 'token'), false);
  } finally { globalThis.fetch = previous; }
});
test('14 counts only prior diagnostic PRs of this exact release stage', async () => {
  const previous = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({ok: true, json: async () => [
      {number: 519, body: body('S4-G1', 'diagnostic', '1')},
      {number: 518, body: body('S4-G2', 'diagnostic', '1')},
      {number: 517, body: body('S4-G1', 'implementation')},
      {number: 509, body: body('S4-G1', 'diagnostic', '1')},
    ]});
    assert.equal(await previousDiagnostics('S4-G1', 520, 'token'), 1);
    assert.equal(await previousDiagnostics('S4-G2', 520, 'token'), 1);
  } finally { globalThis.fetch = previous; }
});
