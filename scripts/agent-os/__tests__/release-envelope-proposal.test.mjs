import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initializeState, existingState } from '../../strigunov4/execution-adapters/state.mjs';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { verifySignedArtifact } from '../../strigunov4/execution-adapters/host-authority.mjs';
import { assessSignedReleaseEnvelopeProposal as signedAssess, assessReleaseEnvelopeProposal as assess, checkPr } from '../check-demo-release.mjs';
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
  for (const path of ['docs/agent-os/AUTONOMY_POLICY.md', '.github/workflows/x.yml', 'secrets/a.pem', 'scripts/../x', '/abs', 'scripts//x',
    '.coderabbit.yaml', '.eslintrc.json', 'tsconfig.typecheck.json',
    'scripts/strigunov4/ASI-STRIGUNOV4-RUNNER-BRIDGE-20261020.mjs']) {
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

// Ephemeral fixture key only, never an owner credential or an installed grant.
function signedFixture() {
  const x = fixture(); const {publicKey,privateKey} = generateKeyPairSync('ed25519');
  delete x.envelope.envelopeDigest;
  const payload = JSON.stringify(x.envelope);
  return { ...x, trustedPublicKey: publicKey.export({type:'spki',format:'pem'}),
    signedEnvelope: {payload,signature:sign(null,Buffer.from(payload),privateKey).toString('base64')},
    evidence:{...x.evidence,envelopeDigest:createHash('sha256').update(payload).digest('hex')}, privateKey };
}
test('real Ed25519 envelope remains non-authorizing across refreshed heads', () => {
  const x = signedFixture(); assert.equal(signedAssess(x).status,'PROPOSAL_ELIGIBLE');
  x.request.headSha=x.evidence.headSha='d'.repeat(40);
  assert.deepEqual(signedAssess(x),{status:'PROPOSAL_ELIGIBLE',authorized:false,requiresAtomicReservation:true});
});
test('payload tampering is rejected by existing crypto verifier', () => {
  const x=signedFixture(); x.signedEnvelope.payload=x.signedEnvelope.payload.replace('pqukibofpo','otherhost');
  assert.equal(signedAssess(x).reason,'ENVELOPE_SIGNATURE_INVALID');
});
test('wrong trusted key fails', () => {
  const x=signedFixture(); x.trustedPublicKey=signedFixture().trustedPublicKey;
  assert.equal(signedAssess(x).reason,'ENVELOPE_SIGNATURE_INVALID');
});
test('signed duplicates and self-referential digests are rejected', () => {
  for (const suffix of [',"maxOperations":2',',"envelopeDigest":"'+d+'"']) {
    const x=signedFixture(); x.signedEnvelope.payload=x.signedEnvelope.payload.slice(0,-1)+suffix+'}';
    x.signedEnvelope.signature=sign(null,Buffer.from(x.signedEnvelope.payload),x.privateKey).toString('base64');
    assert.equal(signedAssess(x).reason,'ENVELOPE_SIGNED_PAYLOAD');
  }
});
test('signed envelope cannot authenticate a different evidence digest', () => {
  const x=signedFixture();x.evidence.envelopeDigest=d;
  assert.equal(signedAssess(x).reason,'ENVELOPE_TRUST');
});
test('real signature does not bypass unknown/revoked state or consumed claims', () => {
  for (const [key,value] of [['revocation','UNKNOWN'],['claim','CONSUMED'],['externalResult','UNKNOWN']]) {
    const x=signedFixture();x.evidence[key]=value;assert.equal(signedAssess(x).status,'BLOCKED');
  }
});
test('proposal signature never satisfies existing live activation validator', () => {
  const x=signedFixture(); assert.throws(()=>verifySignedArtifact(x.signedEnvelope,x.trustedPublicKey,x.now),/ACTIVATION_SCOPE_OR_EXPIRY/);
});

test('existing isolated durable claim serializes candidate verification and prevents replay on reopen', async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'asi-envelope-'));
  try {
    const state=await initializeState(root); const x=signedFixture();
    const task={id:'envelope-proof',sha:h,stage:'S4-G1',repo:'ASI-integration/asi-landing',pr:null,branch:'fixture'};
    const github={verifyTask:async()=>({sha:h})};
    let release,entered; const enteredPromise=new Promise(r=>{entered=r;});
    const wait=new Promise(r=>{release=r;});let executed=0;
    const first=state.execute('local-envelope-proof',task,github,async()=>{
      executed++;entered();await wait;
      assert.equal(signedAssess(x).authorized,false);return {status:'PASS'};
    });
    await enteredPromise;
    const concurrent=await state.execute('local-envelope-proof',task,github,async()=>{executed++;return {status:'PASS'};});
    assert.equal(concurrent.reason,'LOCK_HELD_OR_CRASHED_REQUIRES_REVIEW');
    release();assert.equal((await first).mode,'REPORT_READY');
    const reopened=await existingState(root);
    assert.equal((await reopened.execute('local-envelope-proof',task,github,async()=>{executed++;return {status:'PASS'};})).reason,'ALREADY_RECORDED_NOT_FRESH_EVIDENCE');
    assert.equal(executed,1);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
test('unknown isolated callback outcome stays FAILED_LOCKED after reopen', async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'asi-envelope-'));
  try {
    const state=await initializeState(root);
    const task={id:'unknown-proof',sha:h,stage:'S4-G1',repo:'ASI-integration/asi-landing',pr:null,branch:'fixture'};
    const github={verifyTask:async()=>({sha:h})};
    assert.equal((await state.execute('local-envelope-proof',task,github,async()=>undefined)).mode,'FAILED_LOCKED');
    const reopened=await existingState(root); let calls=0;
    assert.equal((await reopened.execute('local-envelope-proof',task,github,async()=>{calls++;return {status:'PASS'};})).mode,'FAILED_LOCKED');
    assert.equal(calls,0);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
