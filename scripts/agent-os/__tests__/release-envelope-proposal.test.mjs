import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { assessReleaseEnvelopeProposal as assess, checkPr } from '../check-demo-release.mjs';
const h = 'a'.repeat(40), d = 'b'.repeat(64);
function fixture() {
  return { now: 1000, envelope: { schema: 'asi.release-envelope.proposal.v1', repo: 'ASI-integration/asi-landing', environment: 'beget-staging', target: 'pqukibofpo', appId: 5514822, installationId: 176281163, policyDigest: d, securityDigest: d, envelopeDigest: d, notBefore: 0, expiresAt: 2000, action: 'source', allowedPaths: ['scripts/example.mjs'], maxOperations: 2, paidApiUsd: 0 }, request: { action: 'source', repo: 'ASI-integration/asi-landing', environment: 'beget-staging', target: 'pqukibofpo', appId: 5514822, installationId: 176281163, securityDigest: d, changedPaths: ['scripts/example.mjs'], headSha: h, baseSha: h, artifactDigest: d, taskId: 'task-1' }, evidence: { ownerVerified: true, ownerId: 207600140, envelopeDigest: d, policyDigest: d, revocation: 'NOT_REVOKED', observedAt: 1000, headSha: h, baseSha: h, artifactDigest: d, ci: 'SUCCESS', independentReview: 'PASS', branchProtection: 'PASS', usedOperations: 0, paidApiUsd: 0, taskId: 'task-1', claim: 'UNCLAIMED', externalResult: 'NONE' } };
}
test('changed HEAD with refreshed evidence needs no changed envelope, but grants NO authority', () => {
  const x = fixture(); const original = JSON.stringify(x.envelope);
  assert.equal(assess(x).status, 'PROPOSAL_ELIGIBLE');
  x.request.headSha = x.evidence.headSha = 'c'.repeat(40);
  assert.equal(assess(x).status, 'PROPOSAL_ELIGIBLE');
  assert.equal(assess(x).authorized, false);
  assert.equal(JSON.stringify(x.envelope), original);
});
for (const [title, edit, reason] of [
  ['stale head evidence', x => { x.request.headSha = 'c'.repeat(40); }, 'ENVELOPE_EXACT_EVIDENCE'],
  ['changed contract', x => { x.request.securityDigest = 'c'.repeat(64); }, 'ENVELOPE_SCOPE'],
  ['different host', x => { x.request.target = 'elsewhere'; }, 'ENVELOPE_SCOPE'],
  ['source cannot activate', x => { x.request.action = 'activation'; }, 'ENVELOPE_SCOPE'],
  ['expired', x => { x.now = 2000; }, 'ENVELOPE_TIME'],
  ['unbounded duration', x => { x.envelope.expiresAt = 15 * 86400000; }, 'ENVELOPE_TIME'],
  ['revoked', x => { x.evidence.revocation = 'REVOKED'; }, 'ENVELOPE_TRUST'],
  ['unknown revocation', x => { delete x.evidence.revocation; }, 'ENVELOPE_TRUST'],
  ['unverified actor', x => { x.evidence.ownerVerified = false; }, 'ENVELOPE_TRUST'],
  ['exhausted budget', x => { x.evidence.usedOperations = 2; }, 'ENVELOPE_BUDGET'],
  ['malformed budget', x => { x.evidence.usedOperations = NaN; }, 'ENVELOPE_BUDGET'],
  ['replay', x => { x.evidence.claim = 'CONSUMED'; }, 'ENVELOPE_REPLAY_OR_UNKNOWN'],
  ['unknown result', x => { x.evidence.externalResult = 'UNKNOWN'; }, 'ENVELOPE_REPLAY_OR_UNKNOWN'],
  ['failed locked', x => { x.evidence.claim = 'FAILED_LOCKED'; }, 'ENVELOPE_REPLAY_OR_UNKNOWN'],
  ['missing review', x => { x.evidence.independentReview = 'PENDING'; }, 'ENVELOPE_EXACT_EVIDENCE'],
  ['stale observation', x => { x.evidence.observedAt = 999; }, 'ENVELOPE_TRUST'],
]) test(title, () => { const x = fixture(); edit(x); assert.deepEqual(assess(x), {status:'BLOCKED', reason, authorized:false}); });
test('protected and traversal paths cannot be authorized by broad caller allowlist', () => {
  for (const path of ['docs/agent-os/AUTONOMY_POLICY.md', '.github/workflows/x.yml', 'secrets/a.pem', 'scripts/../x', '/abs', 'scripts//x']) {
    const x = fixture(); x.envelope.allowedPaths = x.request.changedPaths = [path];
    assert.equal(assess(x).reason, 'ENVELOPE_PROTECTED_CHANGE');
  }
});
test('release/activation require all host protections, even then model is not authority', () => {
  for (const action of ['release', 'activation']) {
    const x = fixture(); x.envelope.action = x.request.action = action;
    assert.equal(assess(x).reason, 'ENVELOPE_HOST_GATE');
    const gates = ['fencing','nativeIsolation','runtimeChecks','rollback','environmentProtection'];
    for (const key of gates) x.evidence[key] = 'PASS';
    assert.equal(assess(x).status, 'PROPOSAL_ELIGIBLE');
    assert.equal(assess(x).authorized, false);
    for (const key of gates) { x.evidence[key] = 'UNKNOWN'; assert.equal(assess(x).reason, 'ENVELOPE_HOST_GATE'); x.evidence[key] = 'PASS'; }
  }
});
test('existing governance still rejects unsigned policy changes regardless of proposal', () => {
  const contract = JSON.parse(fs.readFileSync(new URL('../../../docs/agent-os/releases/strigunov4-demo.json', import.meta.url)));
  assert.throws(() => checkPr({contract, changed:['scripts/agent-os/check-demo-release.mjs'], prNumber:552, prBody:'Release-Stage: S4-G2\nRelease-Mode: implementation', headSha:h, baseHasContract:true, ownerApproval:false, envelopeProposal:assess(fixture())}), /GOVERNANCE_CHANGE_NEEDS_VERIFIED_OWNER_ATTESTATION/);
});
