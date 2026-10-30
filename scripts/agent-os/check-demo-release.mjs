#!/usr/bin/env node
/**
 * ASI demo release gate. Enforce milestone-first work on pull requests.
 * GitHub API owner attestations are independent of the untrusted PR body.
 * This gate does not grant permission for merge, staging or server mutations.
 */
import fs from 'node:fs';
import {inspectStandingAdmissionReceipt,isStandingReleaseReader} from '../strigunov4/execution-adapters/standing-request-guard.mjs';
import { readProtectedStandingTrustSnapshot } from './release-envelope-trust-roots.mjs';
import { createHash, createPublicKey } from 'node:crypto';
import { verifySignedPayload } from '../strigunov4/execution-adapters/host-authority.mjs';
import { inspectStandingTransaction } from '../strigunov4/execution-adapters/state.mjs';
import { inspectPublisherLifecycleEvidence } from '../strigunov4/execution-adapters/github-publisher.mjs';
import { isCompiledGitHubRead } from '../strigunov4/execution-adapters/github-readonly.mjs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {verifyOwnerSecurityFiles} from './verify-owner-security-baseline.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const CONTRACT = 'docs/agent-os/releases/strigunov4-demo.json';
export const OWNER_BASELINE_PATHS = new Set([
  'docs/agent-os/owner-security-baseline.json',
  'docs/agent-os/OWNER-SECURITY-LEVEL.md',
  'docs/agent-os/AUTONOMY_POLICY.md',
  '.github/CODEOWNERS',
  'scripts/agent-os/verify-owner-security-baseline.mjs',
  'scripts/agent-os/__tests__/owner-security-baseline.test.mjs',
]);
export const GOVERNANCE = new Set([
  CONTRACT, ...OWNER_BASELINE_PATHS, 'scripts/agent-os/check-demo-release.mjs',
  'scripts/agent-os/__tests__/demo-release.test.mjs',
  '.github/workflows/pr-validation.yml',
  '.github/workflows/asi-release-governance.yml',
  'docs/agent-os/WORKFLOW.md', 'docs/agent-os/DEFINITION_OF_DONE.md',
  'docs/agent-os/RELEASE-GOVERNANCE.md',
  'AGENTS.md', '.github/PULL_REQUEST_TEMPLATE.md',
]);
const REPO = 'ASI-integration/asi-landing';
const OWNER_ID = 207600140;
const SHA = /^[a-f0-9]{40}$/;
export const ENVELOPE_SECURITY_REQUIRED = Object.freeze([
  'AGENTS.md', 'package.json', 'package-lock.json', CONTRACT,
  '.coderabbit.yaml', '.eslintrc.json', 'tsconfig.json', 'tsconfig.typecheck.json',
  'next.config.js',
  'docs/agent-os/AUTONOMY_POLICY.md', 'docs/agent-os/OWNER_GATE.md',
  'docs/agent-os/RELEASE-GOVERNANCE.md', 'scripts/agent-os/check-demo-release.mjs',
  '.github/workflows/pr-validation.yml', '.github/workflows/asi-release-governance.yml',
  ...['RUNNER-BRIDGE', 'MULTIJOB', 'ORCHESTRATOR-CANDIDATE'].map(name =>
    'scripts/strigunov4/ASI-STRIGUNOV4-' + name + '-20261020.mjs'),
  ...['host-authority', 'host-runtime', 'state', 'github-publisher', 'publisher-transport',
    'ci-reader', 'coderabbit-analyzer', 'change-preparer'].map(name =>
    'scripts/strigunov4/execution-adapters/' + name + '.mjs'),
]);
const envelopeProtectedPath = p => ENVELOPE_SECURITY_REQUIRED.includes(p) || GOVERNANCE.has(p) ||
  ['.github/', '.agents/', 'scripts/agent-os/', 'docs/agent-os/',
    'scripts/strigunov4/execution-adapters/'].some(prefix => p.startsWith(prefix)) ||
  /(^|\/)(secrets?|authority|permissions)(\/|\.)/i.test(p);

function must(ok, label) {
  if (!ok) throw new Error(label);
}
function trackedFiles(repoRoot) {
  const raw = execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot, encoding: 'utf8' });
  return new Set(raw.split('\0').filter(Boolean));
}
export function validateContract(contract, knownPaths, verifiedRuns = new Set()) {
  must(contract?.schemaVersion === 'asi.demo-release.v1', 'RELEASE_SCHEMA');
  must(contract.releaseId === 'STRIGUNOV4-READY-FOR-DEMO', 'RELEASE_ID');
  must(contract.state === 'FROZEN_ON_OWNER_MERGE', 'RELEASE_NOT_FROZEN');
  must(typeof contract.goal === 'string' && contract.goal.length >= 40, 'RELEASE_GOAL');
  must(Array.isArray(contract.excluded) && contract.excluded.length >= 3, 'RELEASE_EXCLUSIONS');
  must(contract.transition?.legacyPrMax === 509 &&
       contract.transition.maxConsecutiveDiagnostics === 2 &&
       contract.transition.legacyHeads?.['502'] === '5d95a7b5bacec5f9ef68795c430038944020676b' &&
       contract.transition.legacyHeads?.['508'] === '8ac8e8ac11e39ac070ccc058218e3b73190cb43f' &&
       contract.transition.legacyHeads?.['509'] === '5ba61e734a1f9a56cd807eee91b4e217bf6ee040',
       'RELEASE_TRANSITION');
  must(Array.isArray(contract.stages) && contract.stages.length === 6, 'RELEASE_STAGES');
  const pending = contract.pendingPrPaths;
  must(Array.isArray(pending) && pending.length === 2, 'PENDING_PR_PIN');
  const requiredPins = new Map([
    [509, '5ba61e734a1f9a56cd807eee91b4e217bf6ee040'],
    [502, '5d95a7b5bacec5f9ef68795c430038944020676b'],
  ]);
  for (const entry of pending) {
    must(entry?.headSha === requiredPins.get(entry.pr)
         && Array.isArray(entry.paths) && entry.paths.length >= 10
         && new Set(entry.paths).size === entry.paths.length, 'PENDING_PR_PIN');
  }
  must(new Set(pending.map(p => p.pr)).size === 2, 'DUPLICATE_PENDING_PR');
  const available = new Set([...knownPaths, ...pending.flatMap(p => p.paths)]);
  let openSeen = false;
  let next = null;
  const ids = new Set();
  const fileCounts = {};
  for (const stage of contract.stages) {
    must(/^S4-G[1-6]$/.test(stage?.id) && !ids.has(stage.id), 'STAGE_ID');
    ids.add(stage.id);
    must(stage.id === 'S4-G' + ids.size, 'STAGE_ORDER');
    must(typeof stage.title === 'string' && stage.title.length > 10, 'STAGE_TITLE');
    must(['ACCEPTED', 'IN_PROGRESS', 'NOT_STARTED', 'BLOCKED'].includes(stage.status), 'STAGE_STATUS');
    must(Array.isArray(stage.acceptance) && stage.acceptance.length >= 2 &&
         stage.acceptance.every(x => typeof x === 'string' && x.length >= 20),
         'STAGE_ACCEPTANCE');
    must(Array.isArray(stage.files) && stage.files.length >= 2 &&
         stage.files.length === new Set(stage.files).size, 'STAGE_FILES');
    const proposed = stage.plannedFiles || [];
    must(Array.isArray(proposed) && proposed.length === new Set(proposed).size &&
         proposed.every(p => typeof p === 'string' &&
           (p.startsWith('scripts/strigunov4/') || p.startsWith('.github/workflows/strigunov4-c4-'))),
         'STAGE_PLANNED_FILES');
    for (const p of proposed) {
      must(!p.includes('..') && !p.includes('\\') && !p.startsWith('/') &&
           !stage.files.includes(p),
           'PLANNED_FILE_UNSAFE_OR_ALREADY_LISTED:' + p);
    }
    for (const p of stage.files) {
      must(typeof p === 'string' && !p.includes('..') && !p.startsWith('/') &&
           available.has(p), 'STAGE_FILE_NOT_TRACKED_OR_PINNED:' + p);
      fileCounts[p] = (fileCounts[p] || 0) + 1;
    }
    must(Array.isArray(stage.proof), 'STAGE_PROOF');
    if (stage.status === 'ACCEPTED') {
      must(!openSeen && stage.proof.length >= 1 &&
           stage.proof.every(p => typeof p === 'string' &&
             /^https:\/\/github\.com\/ASI-integration\/asi-landing\/actions\/runs\/[0-9]+$/.test(p) &&
             SHA.test(stage.acceptanceSha) && verifiedRuns.has(p)),
           'ACCEPTED_REQUIRES_INDEPENDENT_RUN_EVIDENCE');
    } else {
      must(stage.proof.length === 0, 'OPEN_STAGE_CANNOT_CLAIM_PROOF');
      if (!next) next = stage.id;
      if (openSeen) must(stage.status === 'NOT_STARTED', 'ONLY_ONE_ACTIVE_STAGE');
      openSeen = true;
    }
  }
  must(ids.size === 6, 'RELEASE_INCOMPLETE');
  must(next !== null, 'FULL_RELEASE_CLOSURE_REQUIRES_SEPARATE_OWNER_GATE');
  return { nextStage: next, fileCounts, remainingStages: contract.stages.filter(s => s.status !== 'ACCEPTED').length };
}
export function prChanges(baseSha, headSha, repoRoot = ROOT) {
  must(SHA.test(baseSha) && SHA.test(headSha), 'PR_SHA');
  // Authorize both paths of a rename; --name-only with rename detection hides
  // the source path and could conceal deletion of a governed file.
  const raw = execFileSync('git', ['diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--name-only', '-z', baseSha + '...' + headSha], {
    cwd: repoRoot, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
  });
  return raw.split('\0').filter(Boolean);
}
function fields(body) {
  must(typeof body === 'string' && body.length < 200000, 'PR_BODY');
  const get = key => {
    const m = body.match(new RegExp('^' + key + ':\\s*(\\S+)\\s*$', 'im'));
    return m?.[1] || '';
  };
  return {
    stage: get('Release-Stage'),
    mode: get('Release-Mode'),
    iteration: get('Release-Diagnostic-Iteration'),
  };
}
/**
 * Draft #551 model only. No caller in checkPr/main or host execution.
 * Evidence is supplied by a future protected-base verifier, never PR JSON.
 * Even an eligible proposal returns authorized=false: adoption and durable
 * reservation must be implemented/reviewed before any authority is granted.
 */
export function assessReleaseEnvelopeProposal(input) {
  return assessEnvelopePhase(input, 'EXACT_HEAD_VERIFIED');
}
// Internal phase split: prepublication checks never invent a future HEAD or CI.
function assessEnvelopePhase({ envelope: e, evidence: v, request: r, now }, phase) {
  const deny = reason => ({ status: 'BLOCKED', reason, authorized: false });
  const digest = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
  const sha = x => typeof x === 'string' && SHA.test(x);
  const natural = x => Number.isSafeInteger(x) && x >= 0;
  const paths = x => Array.isArray(x) && x.length > 0 && new Set(x).size === x.length &&
    x.every(p => typeof p === 'string' && /^[A-Za-z0-9_.\/-]+$/.test(p) &&
      !p.startsWith('/') && !p.split('/').some(part => !part || part === '..' || part === '.'));
  if (!e || !v || !r || !Number.isSafeInteger(now)) return deny('ENVELOPE_INPUT');
  if (e.schema !== 'asi.release-envelope.proposal.v1' || e.repo !== REPO ||
      e.environment !== 'beget-staging' || e.target !== 'pqukibofpo' ||
      e.appId !== 5514822 || e.installationId !== 176281163 || !digest(e.policyDigest) ||
      !digest(e.securityDigest) || !digest(e.envelopeDigest)) return deny('ENVELOPE_IDENTITY');
  if (!Number.isSafeInteger(e.notBefore) || !Number.isSafeInteger(e.expiresAt) ||
      e.expiresAt <= e.notBefore || e.expiresAt - e.notBefore > 14 * 86400000 ||
      now < e.notBefore || now >= e.expiresAt) return deny('ENVELOPE_TIME');
  // Signed evidence keeps its original timestamp across asynchronous reads.
  // The disabled proposal permits at most the existing provider freshness
  // window; future/pre-envelope observations and older witnesses fail closed.
  if (v.ownerVerified !== true || v.ownerId !== OWNER_ID ||
      v.envelopeDigest !== e.envelopeDigest || v.policyDigest !== e.policyDigest ||
      v.revocation !== 'NOT_REVOKED' || !natural(v.observedAt) ||
      v.observedAt < e.notBefore || v.observedAt > now ||
      now - v.observedAt > 60000) return deny('ENVELOPE_TRUST');
  if (!['source', 'release', 'activation'].includes(e.action) || r.action !== e.action ||
      r.repo !== e.repo || r.target !== e.target || r.environment !== e.environment ||
      r.appId !== e.appId || r.installationId !== e.installationId ||
      r.securityDigest !== e.securityDigest) return deny('ENVELOPE_SCOPE');
  if (!paths(e.allowedPaths) || !paths(r.changedPaths) ||
      !r.changedPaths.every(p => e.allowedPaths.includes(p)) ||
      r.changedPaths.some(envelopeProtectedPath))
    return deny('ENVELOPE_PROTECTED_CHANGE');
  if (!sha(r.baseSha) || !digest(r.artifactDigest) || v.baseSha !== r.baseSha ||
      v.artifactDigest !== r.artifactDigest || v.branchProtection !== 'PASS')
    return deny('ENVELOPE_EXACT_EVIDENCE');
  if (phase === 'EXACT_HEAD_VERIFIED' || phase === 'PRE_GATE') {
    if (!sha(r.headSha) || v.headSha !== r.headSha ||
        v.ci !== (phase === 'PRE_GATE' ? 'SOURCE_SUCCESS' : 'SUCCESS') ||
        v.independentReview !== 'PASS') return deny('ENVELOPE_EXACT_EVIDENCE');
  } else if (e.action !== 'source' || r.headSha !== null || v.headSha !== null ||
      v.ci !== null || v.independentReview !== null) {
    return deny('ENVELOPE_PREPUBLICATION_EVIDENCE');
  }
  if (!natural(e.maxOperations) || e.maxOperations === 0 || !natural(v.usedOperations) ||
      v.usedOperations >= e.maxOperations || e.paidApiUsd !== 0 || v.paidApiUsd !== 0)
    return deny('ENVELOPE_BUDGET');
  if (typeof r.taskId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,99}$/.test(r.taskId) ||
      v.taskId !== r.taskId || v.claim !== 'UNCLAIMED' || v.externalResult !== 'NONE')
    return deny('ENVELOPE_REPLAY_OR_UNKNOWN');
  if (e.action !== 'source' && (v.fencing !== 'PASS' || v.nativeIsolation !== 'PASS' ||
      v.runtimeChecks !== 'PASS' || v.rollback !== 'PASS' || v.environmentProtection !== 'PASS'))
    return deny('ENVELOPE_HOST_GATE');
  return { status: 'PROPOSAL_ELIGIBLE', authorized: false, requiresAtomicReservation: true };
}

/** Disabled draft adapter; trustedPublicKey must come from protected configuration.
 * No network, filesystem writes, claims or live admission. Signature alone is
 * insufficient: current exact-head evidence and revocation remain mandatory.
 */
export function assessSignedReleaseEnvelopeProposal({ signedEnvelope, trustedPublicKey, evidence, request, now }) {
  try {
    const payload = verifySignedPayload(signedEnvelope, trustedPublicKey);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
        Object.hasOwn(payload, 'envelopeDigest') ||
        JSON.stringify(payload) !== signedEnvelope.payload)
      return { status: 'BLOCKED', reason: 'ENVELOPE_SIGNED_PAYLOAD', authorized: false };
    // Hash the exact signed bytes, never a caller-supplied or self-referential digest.
    const envelopeDigest = createHash('sha256').update(signedEnvelope.payload).digest('hex');
    return assessReleaseEnvelopeProposal({ envelope: { ...payload, envelopeDigest },
      evidence, request, now });
  } catch {
    return { status: 'BLOCKED', reason: 'ENVELOPE_SIGNATURE_INVALID', authorized: false };
  }
}

/** Draft authenticated-evidence seam. Owner binds an independent verifier key.
 * Both trust roots are inputs from future protected configuration, not PR fields.
 * No authority, claims or effects are produced by this diagnostic adapter.
 */
export function assessWitnessedReleaseEnvelopeProposal({ signedEnvelope, trustedPublicKey,
  signedEvidence, verifierPublicKey, request, now }) {
  const deny = reason => ({ status: 'BLOCKED', reason, authorized: false });
  try {
    const e = verifySignedPayload(signedEnvelope, trustedPublicKey);
    const fingerprint = pem => createHash('sha256').update(createPublicKey(pem)
      .export({ type: 'spki', format: 'der' })).digest('hex');
    if (!e || !/^[a-f0-9]{64}$/.test(e.verifierKeySha256) ||
        e.verifierKeySha256 !== fingerprint(verifierPublicKey) ||
        fingerprint(trustedPublicKey) === e.verifierKeySha256)
      return deny('ENVELOPE_VERIFIER_IDENTITY');
    const witness = verifySignedPayload(signedEvidence, verifierPublicKey);
    if (!witness || witness.schema !== 'asi.release-envelope-evidence.proposal.v1' ||
        JSON.stringify(witness) !== signedEvidence.payload ||
        witness.envelopeDigest !== createHash('sha256').update(signedEnvelope.payload).digest('hex'))
      return deny('ENVELOPE_WITNESS_BINDING');
    // The protected verifier must inventory the complete trusted diff (including
    // both rename paths). Bind that inventory to this signed exact-head witness;
    // never let a caller omit protected files from the gate's input.
    if (!Array.isArray(witness.changedPaths) || !Array.isArray(request?.changedPaths) ||
        JSON.stringify(witness.changedPaths) !== JSON.stringify(request.changedPaths))
      return deny('ENVELOPE_WITNESS_PATHS');
    return assessSignedReleaseEnvelopeProposal({ signedEnvelope, trustedPublicKey,
      evidence: { ...witness, ownerVerified: true, ownerId: OWNER_ID },
      request: { ...request, changedPaths: witness.changedPaths }, now });
  } catch {
    return deny('ENVELOPE_WITNESS_SIGNATURE');
  }
}

/**
 * Pure, non-authorizing check of a *trusted producer's* GitHub snapshots.
 * A PR author must never be allowed to supply these objects as evidence.
 * The protected-base workflow will have to fetch the actual provider responses,
 * bind them to an independently signed witness and verify key provenance.
 * No caller from checkPr/main; returning VERIFIED is not an authorization.
 */
export function inspectAuthenticatedProviderSnapshot({pr, runs, reviews, expected, now}) {
  return inspectProviderSnapshot({pr,runs,reviews,expected,now});
}
function inspectProviderSnapshot({pr, runs, reviews, expected, now}, preGate) {
  const deny = reason => ({status:'BLOCKED', reason, authorized:false});
  if (!Number.isSafeInteger(now) || !expected || expected.repository !== REPO ||
      !Number.isSafeInteger(expected.number) || expected.number <= 0 ||
      !SHA.test(expected.baseSha || '') || !SHA.test(expected.headSha || '') ||
      !Number.isSafeInteger(expected.independentReviewerId) ||
      expected.independentReviewerId <= 0) return deny('PROVIDER_CONTEXT');
  if (!pr || pr.number !== expected.number || pr.state !== 'open' ||
      pr.base?.ref !== 'main' || pr.base?.sha !== expected.baseSha ||
      pr.head?.sha !== expected.headSha ||
      pr.head?.repo?.full_name !== REPO || pr.base?.repo?.full_name !== REPO ||
      !Number.isSafeInteger(pr.user?.id) ||
      expected.independentReviewerId === pr.user.id ||
      expected.independentReviewerId === OWNER_ID) return deny('PROVIDER_PR_IDENTITY');
  if (!Array.isArray(runs) || !Array.isArray(reviews)) return deny('PROVIDER_INCOMPLETE');
  // Both required workflow IDs are pinned in the preexisting host activation
  // contract; status names alone are not a trusted workflow identity.
  const required = [
    {workflow_id:311380800,event:'pull_request',head_sha:expected.headSha},
    {workflow_id:390653294,event:'pull_request_target',head_sha:expected.baseSha},
  ];
  let sourcePending=false;
  for (const rule of required) {
    const matches = runs.filter(run =>
      run.workflow_id === rule.workflow_id && run.event === rule.event &&
      run.head_sha === rule.head_sha &&
      run.repository?.full_name === REPO);
    // Missing PR bindings, unclear attempts, or a newer failing run fail closed.
    if (!matches.length || matches.some(run => !Number.isSafeInteger(run.id) ||
          !Number.isSafeInteger(run.run_attempt) || run.run_attempt < 1))
      return deny('PROVIDER_WORKFLOW_IDENTITY');
    matches.sort((a,b) => b.id - a.id || b.run_attempt - a.run_attempt);
    const latest = matches[0];
    // Do not hide a newer ambiguous/unbound run behind an old bound success.
    if (!Array.isArray(latest.pull_requests) ||
        !latest.pull_requests.some(p => p.number === expected.number &&
          p.head?.sha === expected.headSha && p.base?.sha === expected.baseSha))
      return deny('PROVIDER_WORKFLOW_IDENTITY');
    if (preGate) {
      const result = rule.workflow_id === 311380800
        ? inspectGateSourceJobs(latest,preGate.sourceJobs,now)
        : inspectGateEvaluator(latest,preGate.evaluatorRun,preGate.context);
      if (result==='GATE_SOURCE_PENDING')sourcePending=true;
      else if (result) return deny(result);
    } else if (latest.status !== 'completed' || latest.conclusion !== 'success') {
      return deny('PROVIDER_WORKFLOW_NOT_GREEN');
    }
    const finished = Date.parse(latest.updated_at || '');
    if (!Number.isFinite(finished) || finished > now ||
        finished < now - 60 * 60 * 1000)
      return deny('PROVIDER_WORKFLOW_STALE');
  }
  // A newer dismissal or change request must supersede an older approval.
  const decisions = reviews.filter(review =>
    review?.user?.id === expected.independentReviewerId &&
    ['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(review.state));
  if (!decisions.length || decisions.some(review =>
    !Number.isSafeInteger(review.id) || review.id <= 0 ||
    !Number.isFinite(Date.parse(review.submitted_at || '')) ||
    Date.parse(review.submitted_at) > now)) return deny('PROVIDER_INDEPENDENT_REVIEW');
  decisions.sort((a, b) => Date.parse(b.submitted_at) - Date.parse(a.submitted_at) || b.id - a.id);
  const review = decisions[0];
  if (review.state !== 'APPROVED' || review.commit_id !== expected.headSha ||
      Date.parse(review.submitted_at) < now - 60 * 60 * 1000)
    return deny('PROVIDER_INDEPENDENT_REVIEW');
  return {status:preGate?(sourcePending?'GATE_PREREQUISITES_PENDING':'GATE_PREREQUISITES_VERIFIED'):'PROVIDER_EVIDENCE_VERIFIED', authorized:false};
}

// Draft PRE_GATE is a different evidence class, not a relaxed final provider
// verdict. Its split-job profile must come from separately adopted protected
// configuration; the current unsplit workflow cannot satisfy this inventory.
const GATE_SOURCE_JOBS = Object.freeze(['source_validation','channel-manager-recovery-postgres']);
function captureGateData(value,depth=0,budget={fields:0}) {
  must(depth<=16 && ++budget.fields<=10000,'GATE_CONTEXT');
  if(value===null || ['string','number','boolean'].includes(typeof value))return value;
  must(value && typeof value==='object' &&
    (Array.isArray(value)?Object.getPrototypeOf(value)===Array.prototype:
      [Object.prototype,null].includes(Object.getPrototypeOf(value))),'GATE_CONTEXT');
  const result=Array.isArray(value)?[]:{};
  for(const key of Reflect.ownKeys(value)){
    if(Array.isArray(value)&&key==='length')continue;
    const d=Object.getOwnPropertyDescriptor(value,key);
    must(typeof key==='string'&&key!=='__proto__'&&Object.hasOwn(d,'value'),'GATE_CONTEXT');
    result[key]=captureGateData(d.value,depth+1,budget);
  }
  return result;
}
function captureGateContext(value,expected){
  const c=captureGateData(value);
  const keys=['schema','repository','number','baseSha','headSha','evaluatorRunId',
    'evaluatorRunAttempt','sourceWorkflowBlobSha','evaluatorWorkflowBlobSha'];
  must(Object.keys(c).length===keys.length&&keys.every(k=>Object.hasOwn(c,k))&&
    c.schema==='asi.protected-gate-split.proposal.v1'&&c.repository===REPO&&
    c.repository===expected.repository&&c.number===expected.number&&
    c.baseSha===expected.baseSha&&c.headSha===expected.headSha&&
    Number.isSafeInteger(c.evaluatorRunId)&&c.evaluatorRunId>0&&
    Number.isSafeInteger(c.evaluatorRunAttempt)&&c.evaluatorRunAttempt>0&&
    SHA.test(c.sourceWorkflowBlobSha)&&SHA.test(c.evaluatorWorkflowBlobSha),'GATE_CONTEXT');
  return Object.freeze(c);
}
function inspectGateEvaluator(latest,current,context){
  const keys=['id','workflow_id','run_attempt','event','head_sha','path','status','conclusion'];
  const same=current&&keys.every(k=>latest[k]===current[k])&&
    current.repository?.full_name===REPO&&Array.isArray(current.pull_requests)&&
    current.pull_requests.some(p=>p.number===context.number&&
      p.base?.sha===context.baseSha&&p.head?.sha===context.headSha);
  return !same || latest.id!==context.evaluatorRunId ||
    latest.run_attempt!==context.evaluatorRunAttempt || latest.status!=='in_progress'||
    latest.conclusion!==null||latest.path!=='.github/workflows/asi-release-governance.yml'
    ?'GATE_EVALUATOR_IDENTITY':null;
}
function inspectGateSourceJobs(run,inventory,now){
  if(run.path!=='.github/workflows/pr-validation.yml'||
    !['in_progress','completed'].includes(run.status)||
    !(run.conclusion===null||['success','failure'].includes(run.conclusion))||
    (run.status==='in_progress'&&run.conclusion!==null)||
    !inventory||inventory.runId!==run.id||inventory.runAttempt!==run.run_attempt||
    inventory.totalCount!==3||!Array.isArray(inventory.jobs)||inventory.jobs.length!==3)
    return 'GATE_SOURCE_INVENTORY';
  const jobs=inventory.jobs,names=[...GATE_SOURCE_JOBS,'validate'];
  if(new Set(jobs.map(j=>j.id)).size!==3||new Set(jobs.map(j=>j.name)).size!==3||
    jobs.some(j=>!Number.isSafeInteger(j.id)||j.id<=0||!names.includes(j.name)||
      j.run_id!==run.id||j.head_sha!==run.head_sha))return 'GATE_SOURCE_INVENTORY';
  let pending=false;
  for(const job of jobs){
    if(GATE_SOURCE_JOBS.includes(job.name)){
      if(['queued','in_progress'].includes(job.status)&&job.conclusion===null&&job.completed_at===null&&
        run.status==='in_progress'&&run.conclusion===null){pending=true;continue;}
      const finished=Date.parse(job.completed_at||'');
      if(job.status!=='completed'||job.conclusion!=='success'||!Number.isFinite(finished)||
        finished>now||finished<now-3600000)return 'GATE_SOURCE_NOT_GREEN';
    }else if(!['queued','in_progress','completed'].includes(job.status)||
      (job.status==='completed'?!['success','failure'].includes(job.conclusion):job.conclusion!==null)){
      return 'GATE_ADMISSION_STATE';
    }
  }
  const admission=jobs.find(j=>j.name==='validate');
  if(run.status==='completed'&&(admission.status!=='completed'||
    run.conclusion!==admission.conclusion))return 'GATE_ADMISSION_STATE';
  return pending?'GATE_SOURCE_PENDING':null;
}
export function inspectProtectedGatePrerequisites(snapshot,trustedGateContext){
  try{
    const captured=captureGateData(snapshot);
    const context=captureGateContext(trustedGateContext,captured.expected);
    must(Array.isArray(captured.workflowDefinitions)&&captured.workflowDefinitions.length===2,
      'GATE_CONTEXT');
    for(const [index,path,pin] of [[0,'.github/workflows/pr-validation.yml',context.sourceWorkflowBlobSha],
      [1,'.github/workflows/asi-release-governance.yml',context.evaluatorWorkflowBlobSha]]){
      const definition=captured.workflowDefinitions[index];
      must(definition.path===path&&definition.baseSha===context.baseSha&&definition.sha===pin&&
        definition.headSha===context.headSha&&definition.headBlobSha===pin,
        'GATE_CONTEXT');
    }
    return inspectProviderSnapshot(captured,{context,sourceJobs:captured.sourceJobs,
      evaluatorRun:captured.evaluatorRun});
  }catch{return {status:'BLOCKED',reason:'GATE_CONTEXT',authorized:false};}
}

/** Disabled protected-base reader; never called by checkPr/main.
 * token, expected reviewer and transport must originate in trusted configuration,
 * never PR JSON. Production uses native fetch; injection is for offline tests.
 * GET only, fixed repository/host, no redirects/retries, 11 requests maximum,
 * 30s overall / 5s per response, 2 MiB per response, bounded complete pagination.
 * Optional beforeRequest is a trusted-host budget seam, never an authority source:
 * every fixed GET is described without credentials and requires exactly true.
 * Guard waits share the response deadline; late completion cannot dispatch.
 * No key access, signing, writes or authority. Admission must revalidate
 * this observation under the existing Publisher lock; GitHub has no atomic
 * multi-resource snapshot API.
 */
export async function readAuthenticatedProviderSnapshot({token, expected,
  fetchImpl = globalThis.fetch, clock = Date.now, beforeRequest}) {
  return readProviderSnapshot({token,expected,fetchImpl,clock,beforeRequest});
}
/** Disabled PRE_GATE reader for the separately reviewed split-job profile.
 * The caller's context is a protected-configuration seam, not proof of adoption.
 * Fetch and hash both definitions at the exact protected base AND PR HEAD, then collect the
 * complete source-job attempt and current evaluator without requiring its own
 * SUCCESS. At most 25 fixed GETs (13 without pagination); existing time/body caps
 * and strict metering apply. Never returns final provider evidence or authority.
 */
export async function readAuthenticatedGatePrerequisites({token,expected,trustedGateContext,
  fetchImpl=globalThis.fetch,clock=Date.now,beforeRequest}){
  if(trustedGateContext===undefined)return {status:'BLOCKED',reason:'GATE_CONTEXT',authorized:false};
  if(typeof beforeRequest!=='function')return {status:'BLOCKED',reason:'PROVIDER_READER_GUARD_REQUIRED',authorized:false};
  return readProviderSnapshot({token,expected,fetchImpl,clock,beforeRequest},trustedGateContext);
}
async function readProviderSnapshot({token,expected,fetchImpl,clock,beforeRequest},gateInput){
  const deny = reason => ({status:'BLOCKED', reason, authorized:false});
  let gate;
  // Capture only primitive own-data pins before any validation or await. Do not
  // invoke accessors or coerce boxed values while inspecting a caller context.
  try {
    must(expected && typeof expected === 'object' && !Array.isArray(expected) &&
      [Object.prototype, null].includes(Object.getPrototypeOf(expected)), 'PROVIDER_READER_CONTEXT');
    const fields = ['repository', 'number', 'baseSha', 'headSha', 'independentReviewerId'];
    const descriptors = Object.getOwnPropertyDescriptors(expected);
    must(Reflect.ownKeys(descriptors).length === fields.length && fields.every(key =>
      descriptors[key] && Object.hasOwn(descriptors[key], 'value')), 'PROVIDER_READER_CONTEXT');
    expected = Object.freeze(Object.fromEntries(fields.map(key => [key, descriptors[key].value])));
    if(gateInput!==undefined)gate=captureGateContext(gateInput,expected);
  } catch { return deny('PROVIDER_READER_CONTEXT'); }
  if (typeof token !== 'string' || !token.trim() || /[\r\n]/.test(token) ||
      (beforeRequest !== undefined && typeof beforeRequest !== 'function') ||
      expected.repository !== REPO ||
      !Number.isSafeInteger(expected.number) || expected.number <= 0 ||
      typeof expected.baseSha !== 'string' || !SHA.test(expected.baseSha) ||
      typeof expected.headSha !== 'string' || !SHA.test(expected.headSha) ||
      !Number.isSafeInteger(expected.independentReviewerId) || expected.independentReviewerId <= 0)
    return deny('PROVIDER_READER_CONTEXT');
  const startedAt = clock();
  if (!Number.isSafeInteger(startedAt)) return deny('PROVIDER_READER_CONTEXT');
  let requests = 0;
  const root = 'https://api.github.com/repos/' + REPO;
  const get = async suffix => {
    const remaining = () => {
      const now = clock();
      must(Number.isSafeInteger(now) && now >= startedAt && now - startedAt < 30000,
        'PROVIDER_READER_BUDGET');
      return 30000 - (now - startedAt);
    };
    const timeoutMs = Math.min(5000, remaining());
    must(++requests <= (gate?25:11), 'PROVIDER_READER_BUDGET');
    const url = root + suffix, route = suffix.slice(1), method = 'GET';
    const hash = value => createHash('sha256').update(value).digest('hex');
    const payloadSha256 = hash('');
    const requestSha256 = hash(JSON.stringify({method, route, payloadSha256}));
    const controller = new AbortController(); let timer;
    const expired = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort(); reject(new Error('PROVIDER_READER_TIMEOUT'));
      }, timeoutMs);
    });
    try {
      return await Promise.race([expired, (async () => {
        const signal = controller.signal;
        if (beforeRequest) {
          const allowed = await beforeRequest(Object.freeze({
            method, route, payloadSha256, requestSha256, signal,
          }));
          must(allowed === true, 'PROVIDER_READER_GUARD_DENIED');
        }
        // Do not dispatch after a guard ignored its abort or the signed budget's
        // clock advanced during reservation. Requests are never retried here.
        must(!signal.aborted, 'PROVIDER_READER_TIMEOUT'); remaining();
        const response = await fetchImpl(url, {method, redirect:'error', signal, headers:{
          Accept:'application/vnd.github+json', Authorization:'Bearer ' + token,
          'X-GitHub-Api-Version':'2022-11-28',
        }});
        must(!signal.aborted, 'PROVIDER_READER_TIMEOUT'); remaining();
        must(response.ok && !response.redirected && (!response.url || response.url === url),
          'PROVIDER_READER_HTTP');
        must(/^application\/json(?:;|$)/i.test(response.headers.get('content-type') || ''),
          'PROVIDER_READER_RESPONSE');
        const reader = response.body?.getReader();
        must(reader, 'PROVIDER_READER_RESPONSE');
        const chunks = []; let size = 0;
        try {
          for (;;) {
            const {done, value} = await reader.read();
            must(!signal.aborted, 'PROVIDER_READER_TIMEOUT'); remaining();
            if (done) break;
            size += value.byteLength;
            must(size <= 2 * 1024 * 1024, 'PROVIDER_READER_RESPONSE');
            chunks.push(value);
          }
        } finally { await reader.cancel(); }
        return JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(Buffer.concat(chunks)));
      })()]);
    } finally { clearTimeout(timer); }
  };
  try {
    const pr = await get('/pulls/' + expected.number);
    const workflowDefinitions=[];
    if(gate){
      for(const [definitionPath,pin] of [['.github/workflows/pr-validation.yml',gate.sourceWorkflowBlobSha],
        ['.github/workflows/asi-release-governance.yml',gate.evaluatorWorkflowBlobSha]]){
        for(const ref of [expected.baseSha,expected.headSha]){
          const definition=await get('/contents/'+definitionPath+'?ref='+ref);
          must(definition.type==='file'&&definition.path===definitionPath&&definition.sha===pin&&
            definition.encoding==='base64'&&typeof definition.content==='string'&&
            /^[A-Za-z0-9+/=\r\n]*$/.test(definition.content),'PROVIDER_READER_GATE_DEFINITION');
          const bytes=Buffer.from(definition.content,'base64');
          const object=createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
          must(object===pin,'PROVIDER_READER_GATE_DEFINITION');
        }
        workflowDefinitions.push({path:definitionPath,baseSha:expected.baseSha,sha:pin,
          headSha:expected.headSha,headBlobSha:pin});
      }
    }
    const collectRuns=async()=>{
    const runs = [];
    for (const rule of [
      {id:311380800, event:'pull_request', sha:expected.headSha},
      {id:390653294, event:'pull_request_target', sha:expected.baseSha},
    ]) {
      const collected = []; let total;
      for (let page = 1; page <= 3; page++) {
        const result = await get('/actions/workflows/' + rule.id + '/runs?event=' + rule.event +
          '&head_sha=' + rule.sha + '&per_page=100&page=' + page);
        must(Number.isSafeInteger(result.total_count) && result.total_count >= 0 &&
          result.total_count < 300 && Array.isArray(result.workflow_runs) &&
          result.workflow_runs.length <= 100 && (total === undefined || total === result.total_count),
          'PROVIDER_READER_INCOMPLETE');
        total = result.total_count;
        collected.push(...result.workflow_runs);
        must(collected.every(r => Number.isSafeInteger(r?.id) && r.id > 0) &&
          new Set(collected.map(r => r.id)).size === collected.length,
          'PROVIDER_READER_INCOMPLETE');
        if (result.workflow_runs.length < 100) {
          must(collected.length === total, 'PROVIDER_READER_INCOMPLETE'); break;
        }
      }
      must(collected.length === total, 'PROVIDER_READER_INCOMPLETE');
      runs.push(...collected);
    }
    return runs;
    };
    let runs=await collectRuns();
    let sourceJobs,evaluatorRun;
    if(gate){
      const latest=runs.filter(r=>r.workflow_id===311380800&&r.event==='pull_request'&&
        r.head_sha===expected.headSha&&r.repository?.full_name===REPO)
        .sort((a,b)=>b.id-a.id||b.run_attempt-a.run_attempt)[0];
      must(latest&&Number.isSafeInteger(latest.id)&&latest.id>0&&
        Number.isSafeInteger(latest.run_attempt)&&latest.run_attempt>0,'PROVIDER_READER_GATE_RUN');
      const jobs=[];let total;
      for(let page=1;page<=3;page++){
        const batch=await get('/actions/runs/'+latest.id+'/attempts/'+latest.run_attempt+
          '/jobs?per_page=100&page='+page);
        must(Number.isSafeInteger(batch.total_count)&&batch.total_count>=0&&batch.total_count<300&&
          (total===undefined||total===batch.total_count)&&Array.isArray(batch.jobs)&&batch.jobs.length<=100,
          'PROVIDER_READER_INCOMPLETE');
        total=batch.total_count;jobs.push(...batch.jobs);
        must(jobs.every(j=>Number.isSafeInteger(j?.id)&&j.id>0)&&
          new Set(jobs.map(j=>j.id)).size===jobs.length,'PROVIDER_READER_INCOMPLETE');
        if(batch.jobs.length<100)break;
      }
      must(jobs.length===total,'PROVIDER_READER_INCOMPLETE');
      sourceJobs={runId:latest.id,runAttempt:latest.run_attempt,totalCount:total,jobs};
      evaluatorRun=await get('/actions/runs/'+gate.evaluatorRunId);
    }
    const reviews = [];
    for (let page = 1; page <= 3; page++) {
      const batch = await get('/pulls/' + expected.number + '/reviews?per_page=100&page=' + page);
      must(Array.isArray(batch) && batch.length <= 100, 'PROVIDER_READER_INCOMPLETE');
      reviews.push(...batch);
      must(reviews.every(r => Number.isSafeInteger(r?.id) && r.id > 0) &&
        new Set(reviews.map(r => r.id)).size === reviews.length, 'PROVIDER_READER_INCOMPLETE');
      if (batch.length < 100) break;
      must(page < 3, 'PROVIDER_READER_INCOMPLETE');
    }
    if(gate){
      // A PR reread cannot detect a rerun/new CI attempt on the same HEAD.
      // Recollect COMPLETE workflow inventories; never query only the old run.
      // Drift invalidates this observation instead of retrying or upgrading it.
      const freshRuns=await collectRuns();
      const latestBinding=(list,id,event,sha)=>{
        const r=list.filter(r=>r.workflow_id===id&&r.event===event&&
          r.head_sha===sha&&r.repository?.full_name===REPO)
          .sort((a,b)=>b.id-a.id||b.run_attempt-a.run_attempt)[0];
        if(!r||!Array.isArray(r.pull_requests))return null;
        return JSON.stringify([r.id,r.workflow_id,r.event,r.head_sha,r.path,r.run_attempt,
          r.status,r.conclusion,r.repository.full_name,r.updated_at,
          r.pull_requests.map(p=>[p.number,p.base?.sha,p.head?.sha]).sort((a,b)=>a[0]-b[0])]);
      };
      for(const [id,event,sha] of [[311380800,'pull_request',expected.headSha],
        [390653294,'pull_request_target',expected.baseSha]]){
        const before=latestBinding(runs,id,event,sha),after=latestBinding(freshRuns,id,event,sha);
        must(before!==null&&before===after,'PROVIDER_READER_GATE_RACE');
      }
      runs=freshRuns;
    }
    const currentPr = await get('/pulls/' + expected.number);
    const now = clock();
    must(Number.isSafeInteger(now) && now >= startedAt && now - startedAt < 30000,
      'PROVIDER_READER_BUDGET');
    let observedStatus;
    for (const observed of [pr, currentPr]) {
      const snapshot={pr:observed,runs,reviews,expected,now,
        ...(gate?{sourceJobs,evaluatorRun,workflowDefinitions}:{})};
      const result = gate?inspectProtectedGatePrerequisites(snapshot,gate):
        inspectAuthenticatedProviderSnapshot(snapshot);
      if (result.status === 'BLOCKED') return result;
      if(observedStatus!==undefined&&observedStatus!==result.status)return deny('PROVIDER_READER_GATE_RACE');
      observedStatus=result.status;
    }
    return {status:observedStatus, authorized:false,
      snapshot:{pr:currentPr, runs, reviews, expected, now,
        ...(gate?{sourceJobs,evaluatorRun,workflowDefinitions}:{})},
      receipt:{repository:REPO, number:expected.number, baseSha:expected.baseSha,
        headSha:expected.headSha, startedAt, observedAt:now, requests, writes:0}};
  } catch (error) {
    // Never leak provider bodies, transport exceptions or authentication material.
    const reason = /^PROVIDER_READER_[A-Z_]+$/.test(error?.message || '')
      ? error.message : 'PROVIDER_READER_UNAVAILABLE';
    return deny(reason);
  }
}

// Reconstruct the CURRENT Publisher preparer's two supported artifact formats
// from immutable Git objects. Never trust a signed digest that was not measured.
// Mixed create/edit/delete, renames and mode changes are not Publisher artifacts.
function protectedGateArtifactDigest(comparison,request) {
  must(SHA.test(comparison.baseSha||'')&&SHA.test(comparison.headSha||''),'ENVELOPE_ARTIFACT_SCOPE');
  const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
  const git=args=>execFileSync('/usr/bin/git',['-c','core.fsmonitor=false',
    '-c','core.hooksPath=/dev/null',...args],{cwd:comparison.repoRoot,
    timeout:15000,maxBuffer:4*1024*1024,stdio:['ignore','pipe','pipe'],
    env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',
      GIT_TERMINAL_PROMPT:'0',GIT_OPTIONAL_LOCKS:'0'}});
  must(Array.isArray(request.changedPaths)&&request.changedPaths.length>0&&request.changedPaths.length<=3,
    'ENVELOPE_ARTIFACT_SCOPE');
  const inventory=sha=>new Map(git(['ls-tree','-r','-z','--full-tree',sha]).toString('utf8')
    .split('\0').filter(Boolean).map(line=>{
      const m=/^(\d{6}) (blob|commit) ([a-f0-9]{40})\t([\s\S]+)$/.exec(line);
      must(m,'ENVELOPE_ARTIFACT_SCOPE');return [m[4],{mode:m[1],type:m[2],oid:m[3]}];
    }));
  const before=inventory(comparison.baseSha),after=inventory(comparison.headSha);
  const files=request.changedPaths.map(p=>({path:p,before:before.get(p),after:after.get(p)}));
  must(files.every(f=>f.after?.type==='blob'&&['100644','100755'].includes(f.after.mode)),
    'ENVELOPE_ARTIFACT_SCOPE');
  for(const f of files){
    const bytes=git(['cat-file','blob',f.after.oid]);
    must(bytes.length<=200000&&!bytes.includes(0)&&Buffer.from(bytes.toString('utf8')).equals(bytes),'ENVELOPE_ARTIFACT_SIZE');
    f.afterSha256=hash(bytes);
  }
  if(files.every(f=>f.before?.type==='blob'&&f.before.mode===f.after.mode)){
    const diff=git(['diff','--no-ext-diff','--no-textconv',comparison.baseSha,comparison.headSha,
      '--',...request.changedPaths]);
    must(diff.length>0&&diff.length<=500000&&!/^Binary files /m.test(diff.toString('utf8')),'ENVELOPE_ARTIFACT_SIZE');
    return hash(diff);
  }
  must(files.length===1&&!files[0].before&&files[0].after.mode==='100644'&&
    /^beget-g2-witness-(identity|races)-v1$/.test(request.taskId)&&
    files[0].path==='scripts/strigunov4/test_'+request.taskId.replaceAll('-','_')+'.py',
  'ENVELOPE_ARTIFACT_SCOPE');
  return hash(JSON.stringify(files.map(f=>({path:f.path,beforeSha256:null,afterSha256:f.afterSha256}))));
}

/** Disabled protected caller candidate. Reads only public trust material and
 * authenticated GET evidence; never replaces checkPr/main or returns authority.
 * All data pins must originate outside the PR in independently adopted protected
 * configuration. The mandatory metering callback is the existing Publisher
 * admission seam, not a permission supplied by this proposal. No claims/effects
 * are created here; final publication still requires BOTH whole workflows green.
 */
export async function readAndAssessProtectedGateProposal(input, context) {
  const deny=reason=>({status:'BLOCKED',reason,authorized:false});
  const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  let data,ports,startedAt,highWater=-1;
  try {
    input=captureGateData(input);
    must(context&&[Object.prototype,null].includes(Object.getPrototypeOf(context)),'GATE_CALLER_CONTEXT');
    const d=Object.getOwnPropertyDescriptors(context);
    must(Object.values(d).every(x=>Object.hasOwn(x,'value')),'GATE_CALLER_CONTEXT');
    const value=k=>d[k]?.value;
    data=captureGateData({expected:value('expected'),trustedGateContext:value('trustedGateContext'),
      comparison:value('comparison'),expectedTrust:value('expectedTrust')});
    ports={token:value('token'),beforeRequest:value('beforeRequest'),
      protectedReader:value('protectedReader'),fetchImpl:value('fetchImpl'),clock:value('clock')||Date.now};
    must(typeof ports.beforeRequest==='function'&&typeof ports.clock==='function'&&
      typeof ports.token==='string'&&ports.token.length>0,'GATE_CALLER_CONTEXT');
    captureGateContext(data.trustedGateContext,data.expected);
    const r=input.request,c=data.comparison,e=data.expected;
    must(r.action==='source'&&r.repo===REPO&&r.repo===e.repository&&r.pr===e.number&&
      r.baseSha===e.baseSha&&r.headSha===e.headSha&&c.repository===REPO&&
      c.baseSha===r.baseSha&&c.headSha===r.headSha&&typeof c.repoRoot==='string'&&
      path.isAbsolute(c.repoRoot),'GATE_CALLER_BINDING');
    must(same(prChanges(c.baseSha,c.headSha,c.repoRoot),r.changedPaths),'ENVELOPE_DIFF_INVENTORY');
    const security=inspectProtectedRepositorySecurity(c);
    must(security.status==='PROTECTED_SECURITY_VERIFIED','ENVELOPE_PROTECTED_CHANGE');
    must(protectedGateArtifactDigest(c,r)===r.artifactDigest,'ENVELOPE_ARTIFACT_DIGEST');
    const clock=()=>{
      const at=ports.clock();
      must(Number.isSafeInteger(at)&&at>=0&&at>=highWater&&
        (startedAt===undefined||at-startedAt<30000),'GATE_CALLER_TIME');
      highWater=at;return at;
    };
    startedAt=clock();
    const readTrust=expected=>readProtectedStandingTrustSnapshot({expected,now:clock(),clock,
      ...(ports.protectedReader===undefined?{}:{protectedReader:ports.protectedReader})});
    const trust=await readTrust(data.expectedTrust);
    must(trust.status==='PROTECTED_TRUST_VERIFIED','GATE_CALLER_TRUST');
    const envelope=verifySignedPayload(input.signedEnvelope,trust.issuerPublicKey);
    const witness=verifySignedPayload(input.signedEvidence,trust.verifierPublicKey);
    must(envelope&&JSON.stringify(envelope)===input.signedEnvelope.payload&&
      !Object.hasOwn(envelope,'envelopeDigest')&&envelope.action==='source'&&
      hash(input.signedEnvelope.payload)===trust.envelopeDigest&&
      envelope.verifierKeySha256===trust.verifierKeySha256,'GATE_CALLER_SIGNATURE');
    must(envelope.securityDigest===security.securityDigest&&envelope.policyDigest===security.policyDigest&&
      r.securityDigest===security.securityDigest,'ENVELOPE_SECURITY_DIGEST');
    must(witness&&witness.schema==='asi.release-envelope-gate-evidence.proposal.v1'&&
      witness.phase==='PRE_GATE'&&JSON.stringify(witness)===input.signedEvidence.payload&&
      same(witness.changedPaths,r.changedPaths),'GATE_CALLER_WITNESS');
    const assess=()=>assessEnvelopePhase({envelope:{...envelope,envelopeDigest:trust.envelopeDigest},
      evidence:{...witness,ownerVerified:true,ownerId:OWNER_ID},request:r,now:clock()},'PRE_GATE');
    const before=assess();if(before.status!=='PROPOSAL_ELIGIBLE')return before;
    const observation=await readAuthenticatedGatePrerequisites({token:ports.token,expected:data.expected,
      trustedGateContext:data.trustedGateContext,clock,beforeRequest:ports.beforeRequest,
      ...(ports.fetchImpl===undefined?{}:{fetchImpl:ports.fetchImpl})});
    if(!['GATE_PREREQUISITES_VERIFIED','GATE_PREREQUISITES_PENDING'].includes(observation.status))return observation;
    // Do not accept a signed boolean or an arbitrary excluded run. The witness
    // binds the exact independently authenticated source/evaluator attempts and
    // review decision, plus the protected workflow definition pins.
    const s=observation.snapshot;
    const decisions=s.reviews.filter(review=>review.user?.id===data.expected.independentReviewerId&&
      ['APPROVED','CHANGES_REQUESTED','DISMISSED'].includes(review.state))
      .sort((a,b)=>Date.parse(b.submitted_at)-Date.parse(a.submitted_at)||b.id-a.id);
    const binding={...data.trustedGateContext,sourceRunId:s.sourceJobs.runId,
      sourceRunAttempt:s.sourceJobs.runAttempt,independentReviewerId:data.expected.independentReviewerId,
      reviewId:decisions[0]?.id};
    must(same(witness.gateBinding,binding),'GATE_CALLER_WITNESS_BINDING');
    const finalTrust=await readTrust({...data.expectedTrust,
      minRevocationSequence:trust.revocationCheckpoint.sequence,
      minRevocationManifestDigest:trust.revocationCheckpoint.manifestDigest,
      priorRevokedEnvelopeDigests:trust.revocationCheckpoint.revokedEnvelopeDigests});
    must(finalTrust.status==='PROTECTED_TRUST_VERIFIED'&&finalTrust.envelopeDigest===trust.envelopeDigest&&
      finalTrust.issuerKeySha256===trust.issuerKeySha256&&finalTrust.verifierKeySha256===trust.verifierKeySha256,
    'GATE_CALLER_TRUST');
    const now=clock();
    must(observation.authorized===false&&observation.receipt.observedAt===s.now&&
      s.now<=now&&now-s.now<=60000&&
      inspectProtectedGatePrerequisites({...s,now},data.trustedGateContext).status===observation.status,
    'GATE_CALLER_OBSERVATION');
    const result=assess();
    if(result.status==='PROPOSAL_ELIGIBLE'&&observation.status==='GATE_PREREQUISITES_PENDING')
      return {status:'WAITING',reason:'GATE_SOURCE_PENDING',phase:'PRE_GATE',authorized:false,
        permittedEffect:'NONE',providerReceipt:observation.receipt,revocationCheckpoint:finalTrust.revocationCheckpoint};
    return result.status==='PROPOSAL_ELIGIBLE'?{...result,phase:'PRE_GATE',
      permittedEffect:'ADMISSION_REVIEW_ONLY',providerReceipt:observation.receipt,
      revocationCheckpoint:finalTrust.revocationCheckpoint}:result;
  } catch(error) {
    return deny(/^(GATE_CALLER|ENVELOPE)_[A-Z_]+$/.test(error?.message||'')?
      error.message:'GATE_CALLER_UNVERIFIED');
  }
}

/** Disabled source-only adapter. trustedComparison is supplied by the protected
 * base runner from authenticated PR metadata, never from request/PR content.
 * PR commits are Git data only: no checkout, scripts, hooks or text conversion.
 */
export function assessRepositoryReleaseEnvelopeProposal(input, trustedComparison) {
  const deny = reason => ({status:'BLOCKED', reason, authorized:false});
  if (!trustedComparison || trustedComparison.repository !== REPO ||
      !SHA.test(trustedComparison.baseSha || '') || !SHA.test(trustedComparison.headSha || '') ||
      typeof trustedComparison.repoRoot !== 'string' || !path.isAbsolute(trustedComparison.repoRoot) ||
      input?.request?.baseSha !== trustedComparison.baseSha ||
      input?.request?.headSha !== trustedComparison.headSha)
    return deny('ENVELOPE_TRUSTED_COMPARISON');
  let changed;
  try {
    changed = prChanges(trustedComparison.baseSha, trustedComparison.headSha, trustedComparison.repoRoot);
  } catch { return deny('ENVELOPE_DIFF_UNAVAILABLE'); }
  // Preserve order and both sides of renames from the complete Git inventory.
  if (JSON.stringify(changed) !== JSON.stringify(input.request.changedPaths))
    return deny('ENVELOPE_DIFF_INVENTORY');
  const security = inspectProtectedRepositorySecurity(trustedComparison);
  if (security.status === 'BLOCKED') return security;
  let envelope;
  try { envelope = verifySignedPayload(input.signedEnvelope, input.trustedPublicKey); }
  catch { return deny('ENVELOPE_SIGNATURE_INVALID'); }
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope) ||
      envelope.securityDigest !== security.securityDigest ||
      envelope.policyDigest !== security.policyDigest ||
      input.request.securityDigest !== security.securityDigest)
    return deny('ENVELOPE_SECURITY_DIGEST');
  return assessWitnessedReleaseEnvelopeProposal(input);
}

/** Disabled Publisher phase composition. This does NOT replace checkPr or the
 * existing authorize port. A protected verifier must issue each fresh phase
 * witness; neither a native callback nor a signature is live authority.
 * ADMISSION_READ admits no write and needs no nonexistent PR/head/CI.
 */
export function assessPublisherReleaseEnvelopeProposal(input, context) {
  const deny = reason => ({status:'BLOCKED', reason, authorized:false});
  const hash = value => createHash('sha256').update(value).digest('hex');
  const fingerprint = pem => hash(createPublicKey(pem).export({type:'spki',format:'der'}));
  const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
  let copiedFields = 0;
  const copy = (value, depth = 0) => {
    must(depth <= 16 && ++copiedFields <= 10000,'ENVELOPE_PHASE_DATA');
    if (value === null || ['string','boolean','number'].includes(typeof value)) return value;
    must(value && typeof value === 'object' &&
      (Array.isArray(value) || [Object.prototype,null].includes(Object.getPrototypeOf(value))),
    'ENVELOPE_PHASE_DATA');
    const result = Array.isArray(value) ? [] : {};
    for (const [key,descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (Array.isArray(value) && key === 'length') continue;
      must(key !== '__proto__' && Object.hasOwn(descriptor,'value'),'ENVELOPE_PHASE_DATA');
      result[key] = copy(descriptor.value,depth+1);
    }
    return result;
  };
  try {
    input = copy(input);
    const descriptors = Object.getOwnPropertyDescriptors(context || {});
    context = {};
    for (const [key,descriptor] of Object.entries(descriptors)) {
      must(key !== '__proto__' && Object.hasOwn(descriptor,'value'),'ENVELOPE_PHASE_DATA');
      context[key] = descriptor.value;
    }
    const phase = context.phase;
    must(['ADMISSION_READ','LOCAL_DELTA_VERIFIED','EXACT_HEAD_VERIFIED'].includes(phase),
      'ENVELOPE_PHASE');
    const request = copy(input.request), comparison = copy(context.comparison);
    const now = input.now;
    const lease = inspectStandingTransaction(context.transaction,{write:phase!=='ADMISSION_READ'});
    must(lease.kind === 'github-publisher' &&
      (phase === 'ADMISSION_READ' ? ['admission','preflight','started','postflight'].includes(lease.phase) : lease.phase === 'started'),
    'ENVELOPE_PHASE_LEASE');
    if (lease.taskId) must(lease.taskId === request.taskId && lease.taskSha === request.baseSha,
      'ENVELOPE_PHASE_TASK');
    if (phase === 'ADMISSION_READ') {
      const descriptor = context.descriptor;
      const data = Object.getOwnPropertyDescriptors(descriptor || {});
      const read = Object.fromEntries(['method','route','payloadSha256','requestSha256'].map(key => {
        must(data[key] && Object.hasOwn(data[key],'value') && typeof data[key].value === 'string',
          'ENVELOPE_READ_DESCRIPTOR');return [key,data[key].value];
      }));
      must(read.method === 'GET' && read.payloadSha256 === hash('') ||
        read.method === 'POST' && read.route === 'graphql' && isCompiledGitHubRead(descriptor),
      'ENVELOPE_READ_ONLY');
      must(read.requestSha256 === hash(JSON.stringify({method:read.method,route:read.route,
        payloadSha256:read.payloadSha256})),'ENVELOPE_READ_DESCRIPTOR');
      must(!data.signal || Object.hasOwn(data.signal,'value') &&
        data.signal.value instanceof AbortSignal && !data.signal.value.aborted,'ENVELOPE_READ_DESCRIPTOR');
    }
    must(typeof request.taskBinding === 'string' && /^[a-f0-9]{64}$/.test(request.taskBinding) &&
      typeof request.branch === 'string' && /^asi\/engine-task\/[a-z0-9-]{1,96}$/.test(request.branch),
    'ENVELOPE_PHASE_TASK');
    const envelope = verifySignedPayload(input.signedEnvelope,input.trustedPublicKey);
    must(envelope && !Array.isArray(envelope) && !Object.hasOwn(envelope,'envelopeDigest') &&
      JSON.stringify(envelope) === input.signedEnvelope.payload && envelope.action === 'source',
    'ENVELOPE_PHASE_SCOPE');
    must(envelope.verifierKeySha256 === fingerprint(input.verifierPublicKey) &&
      envelope.verifierKeySha256 !== fingerprint(input.trustedPublicKey),'ENVELOPE_VERIFIER_IDENTITY');
    const envelopeDigest = hash(input.signedEnvelope.payload);
    const witness = verifySignedPayload(input.signedEvidence,input.verifierPublicKey);
    must(witness && witness.schema === 'asi.release-envelope-publisher-evidence.proposal.v1' &&
      JSON.stringify(witness) === input.signedEvidence.payload && witness.phase === phase &&
      witness.envelopeDigest === envelopeDigest && witness.taskBinding === request.taskBinding &&
      witness.branch === request.branch && same(witness.changedPaths,request.changedPaths),
    'ENVELOPE_PHASE_WITNESS');
    must(comparison.repository === REPO && comparison.baseSha === request.baseSha &&
      comparison.headSha === (phase === 'EXACT_HEAD_VERIFIED' ? request.headSha : request.baseSha),
    'ENVELOPE_TRUSTED_COMPARISON');
    const security = inspectProtectedRepositorySecurity(comparison);
    must(security.status === 'PROTECTED_SECURITY_VERIFIED' &&
      security.securityDigest === envelope.securityDigest && security.policyDigest === envelope.policyDigest,
    'ENVELOPE_SECURITY_DIGEST');
    if (phase !== 'ADMISSION_READ') {
      const native = inspectPublisherLifecycleEvidence(context.publisherEvidence,context.transaction);
      must(native.phase === phase && native.repo === request.repo && native.taskId === request.taskId &&
        native.taskSha === request.baseSha && native.taskBinding === request.taskBinding &&
        native.branch === request.branch && same(native.paths,request.changedPaths) &&
        native.deltaSha256 === request.artifactDigest && Number.isSafeInteger(native.observedAt) &&
        native.observedAt >= envelope.notBefore && native.observedAt <= now && now-native.observedAt <= 60000,
      'ENVELOPE_NATIVE_PHASE_BINDING');
      if (phase === 'LOCAL_DELTA_VERIFIED') {
        must(native.localChecks === 'PASS' && native.independentDeltaReview === 'PASS' &&
          typeof native.reviewEvidenceId === 'string' && native.reviewEvidenceId.length > 0 &&
          witness.localChecks === native.localChecks && witness.independentDeltaReview === native.independentDeltaReview &&
          witness.reviewEvidenceId === native.reviewEvidenceId,'ENVELOPE_LOCAL_REVIEW');
      } else {
        must(native.headSha === request.headSha && native.pr === request.pr &&
          native.ci?.status === 'PASS' && native.review?.status === 'PASS','ENVELOPE_NATIVE_EXACT_HEAD');
      }
    }
    if (phase === 'EXACT_HEAD_VERIFIED') {
      must(same(prChanges(comparison.baseSha,comparison.headSha,comparison.repoRoot),request.changedPaths),
        'ENVELOPE_DIFF_INVENTORY');
      const observation = copy(context.providerObservation), expected = copy(context.providerExpected);
      must(expected.repository === request.repo && expected.baseSha === request.baseSha &&
        expected.headSha === request.headSha && expected.number === request.pr &&
        observation.status === 'PROVIDER_EVIDENCE_VERIFIED' && observation.authorized === false &&
        same(observation.snapshot.expected,expected) && observation.receipt?.observedAt === observation.snapshot.now &&
        Number.isSafeInteger(observation.snapshot.now) && observation.snapshot.now <= now &&
        now-observation.snapshot.now <= 60000 &&
        inspectAuthenticatedProviderSnapshot({...observation.snapshot,expected,now}).status === 'PROVIDER_EVIDENCE_VERIFIED',
      'ENVELOPE_PHASE_PROVIDER');
    }
    const result = assessEnvelopePhase({envelope:{...envelope,envelopeDigest},
      evidence:{...witness,ownerVerified:true,ownerId:OWNER_ID},request,now},phase);
    return result.status === 'PROPOSAL_ELIGIBLE' ? {...result,phase,
      permittedEffect:phase === 'ADMISSION_READ' ? 'READ_ONLY' :
        phase === 'LOCAL_DELTA_VERIFIED' ? 'DRAFT_SOURCE_ONLY' : 'VERIFICATION_ONLY'} : result;
  } catch (error) {
    return deny(/^ENVELOPE_[A-Z_]+$/.test(error?.message || '') ? error.message : 'ENVELOPE_PHASE_UNVERIFIED');
  }
}

/** Git objects only, no execution of either tree. Security inventory includes
 * names, modes and object IDs; additions, deletions, renames and symlinks cannot
 * hide behind an unchanged list supplied by a PR. Trust in base identity still
 * requires the authenticated provider and separately adopted configuration.
 */
export function inspectProtectedRepositorySecurity({repoRoot, baseSha, headSha} = {}) {
  const deny = reason => ({status:'BLOCKED', reason, authorized:false});
  if (typeof repoRoot !== 'string' || !path.isAbsolute(repoRoot) ||
      !SHA.test(baseSha || '') || !SHA.test(headSha || '')) return deny('ENVELOPE_SECURITY_CONTEXT');
  const inventory = sha => {
    const raw = execFileSync('git', ['ls-tree', '-r', '-z', '--full-tree', sha],
      {cwd:repoRoot, encoding:'utf8', maxBuffer:4*1024*1024, stdio:['ignore','pipe','pipe']});
    const entries = raw.split('\0').filter(Boolean).map(line => {
      const match = /^(\d{6}) (blob|commit) ([a-f0-9]{40})\t([\s\S]+)$/.exec(line);
      must(match, 'ENVELOPE_SECURITY_INVENTORY');
      return {mode:match[1], type:match[2], oid:match[3], path:match[4]};
    }).filter(entry => envelopeProtectedPath(entry.path));
    must(ENVELOPE_SECURITY_REQUIRED.every(p => entries.some(e => e.path === p)) &&
      entries.every(e => e.type === 'blob' && ['100644','100755'].includes(e.mode)),
      'ENVELOPE_SECURITY_INVENTORY');
    return entries;
  };
  try {
    const base = inventory(baseSha), head = inventory(headSha);
    if (JSON.stringify(base) !== JSON.stringify(head)) return deny('ENVELOPE_PROTECTED_CHANGE');
    const policy = execFileSync('git', ['cat-file', 'blob', baseSha + ':docs/agent-os/AUTONOMY_POLICY.md'],
      {cwd:repoRoot, maxBuffer:1024*1024, stdio:['ignore','pipe','pipe']});
    return {status:'PROTECTED_SECURITY_VERIFIED', authorized:false,
      securityDigest:createHash('sha256').update(JSON.stringify(base)).digest('hex'),
      policyDigest:createHash('sha256').update(policy).digest('hex'), inventory:base};
  } catch { return deny('ENVELOPE_SECURITY_INVENTORY'); }
}

function routineStagePath(stageId, p) {
  return stageId === 'S4-G2' &&
    /^scripts\/strigunov4\/execution-adapters\/(?:host-checks(?:\.test)?|beget-host\.test|beget-staged-install\.test)\.mjs$/.test(p);
}
// Development is source-only: no governance, deployment, authority or secret changes.
// A successful development check never authorizes merge, installation or execution.
function developmentPath(p) {
  if (typeof p !== 'string' || p.includes('\\') || /[\x00-\x1f\x7f]/.test(p)) return false;
  if (!/^(?:src\/|tests\/|docs\/|scripts\/strigunov4\/)/.test(p)) return false;
  // Live HTTP handlers, auth middleware and sensitive app internals require
  // the ordinary protected-release path even when the PR says development.
  if (/^src\/(?:app|pages)\/api\//.test(p) ||
      /^src\/(?:middleware|instrumentation)\.[cm]?[jt]sx?$/.test(p) ||
      /\/(?:route|middleware|instrumentation)\.[cm]?[jt]sx?$/.test(p) ||
      /(?:^|\/)(?:auth|security|payment|payments|billing|webhook|migrations?|permissions?)(?:\/|\.|-|$)/i.test(p)) return false;
  if (p.startsWith('docs/agent-os/') || p.startsWith('scripts/strigunov4/execution-adapters/')) return false;
  // Scripts that operate the live host, installer and authority never become
  // development-safe merely because they live under scripts/strigunov4/.
  if (p.startsWith('scripts/strigunov4/') &&
      !/^scripts\/strigunov4\/(?:test_[A-Za-z0-9_-]+\.py|[A-Za-z0-9_-]+\.test\.mjs)$/.test(p)) return false;
  if (/(?:^|[\/-])(?:\.env[^/]*|secrets?|credentials?|private-keys?|deploy(?:ment)?|production|publisher|authority|budget|owner-gate|release-governance)(?:\/|\.|-|$)/i.test(p)) return false;
  if (/\.(?:pem|key|p12|pfx|env)$/i.test(p)) return false;
  return true;
}
export function checkPr({ contract, changed, prNumber, prBody, headSha,
                          baseHasContract, ownerApproval = false, standingAdmission, baseSha, priorDiagnosticCount = 0, verifiedRuns = new Set() }) {
  must(Number.isSafeInteger(prNumber) && prNumber > 0 && SHA.test(headSha), 'PR_ID');
  must(Array.isArray(changed) && changed.length > 0 &&
       changed.every(p => typeof p === 'string' && !p.startsWith('/') && !p.includes('..')),
       'PR_CHANGE_PATHS');
  const governanceChanged = changed.some(p => GOVERNANCE.has(p));
  if (!baseHasContract) {
    must(changed.every(p => GOVERNANCE.has(p)) && changed.includes(CONTRACT),
         'BOOTSTRAP_MUST_ONLY_TOUCH_GOVERNANCE');
    return { status: 'BOOTSTRAP_REQUIRES_OWNER_MERGE', stage: null };
  }
  if (prNumber <= contract.transition.legacyPrMax) {
    // Preserve only the three already-active demo repairs. Unrelated historical
    // PRs remain open, but may not quietly enter a frozen demonstration release.
    const scopedLegacy = [502, 508, 509].includes(prNumber);
    if (scopedLegacy && contract.transition.legacyHeads[String(prNumber)] === headSha) {
      return { status: 'EXISTING_DEMO_PR_GRANDFATHERED', stage: null };
    }
    must(ownerApproval, 'LEGACY_OR_OFF_SCOPE_PR_REQUIRES_OWNER_ATTESTATION');
    return { status: 'OWNER_ATTESTED_LEGACY_EXCEPTION', stage: null };
  }
  if (governanceChanged) {
    must(ownerApproval, 'GOVERNANCE_CHANGE_NEEDS_VERIFIED_OWNER_ATTESTATION');
    return { status: 'OWNER_ATTESTED_GOVERNANCE_CHANGE', stage: null };
  }
  const f = fields(prBody);
  // Preserve already adopted protected-main DEVELOPMENT: source-only, never authority.
  if (f.mode === 'development') {
    must(changed.every(developmentPath), 'DEVELOPMENT_PROTECTED_OR_OUT_OF_SCOPE_PATH');
    return {status:'SOURCE_DEVELOPMENT_ONLY',stage:null,authority:'NONE'};
  }
  const next = validateContract(contract, new Set(contract.stages.flatMap(s => s.files)), verifiedRuns).nextStage;
  const stage = contract.stages.find(s => s.id === f.stage);
  if (!stage || f.stage !== next ||
      !['implementation', 'diagnostic', 'acceptance'].includes(f.mode)) {
    must(ownerApproval, 'PR_MUST_TARGET_CURRENT_RELEASE_GATE:' + next);
    return { status: 'OWNER_ATTESTED_RELEASE_EXCEPTION', stage: null };
  }
  if (f.mode === 'diagnostic') {
    must(Number.isInteger(priorDiagnosticCount) && priorDiagnosticCount >= 0 &&
         priorDiagnosticCount < contract.transition.maxConsecutiveDiagnostics &&
         f.iteration === String(priorDiagnosticCount + 1),
         'DIAGNOSTIC_LIMIT_REQUIRES_DECISION');
  }
  const allowed = new Set([...stage.files, ...(stage.plannedFiles || [])]);
  for (const p of changed) {
    if (routineStagePath(stage.id, p)) allowed.add(p);
  }
  if (!changed.every(p => allowed.has(p))) {
    must(ownerApproval, 'PR_HAS_OUT_OF_STAGE_FILES');
    return { status: 'OWNER_ATTESTED_RELEASE_EXCEPTION', stage: f.stage };
  }
  if(standingAdmission!==undefined){
    must(!changed.some(envelopeProtectedPath),'STANDING_PROTECTED_CHANGE');
    const receipt=inspectStandingAdmissionReceipt(standingAdmission,{prNumber,headSha,baseSha,changed});
    return {...receipt,stage:f.stage,mode:f.mode};
  }
  return { status: 'CURRENT_MILESTONE_SCOPED', stage: f.stage, mode: f.mode };
}
// Native callers supply the existing authenticated reader. Once selected, every
// prerequisite read uses that port; failures never fall back to unmetered fetch.
async function releaseGitHubRead(route, token, reader, failure) {
  if (reader !== undefined) {
    must(reader && isStandingReleaseReader(reader), 'RELEASE_READER_REQUIRED');
    return reader.get(route);
  }
  const response = await fetch('https://api.github.com/repos/' + REPO + '/' + route, { headers: {
    'Accept': 'application/vnd.github+json',
    'Authorization': 'Bearer ' + token,
    'X-GitHub-Api-Version': '2022-11-28',
  } });
  must(response.ok, failure);
  return response.json();
}
export async function previousDiagnostics(stage, number, token, reader) {
  must((token || reader) && /^S4-G[1-6]$/.test(stage), 'DIAGNOSTIC_HISTORY_CONTEXT');
  let count = 0;
  for (let page = 1; page <= 10; page++) {
    const route = 'pulls?state=all&sort=created&direction=desc&per_page=100&page=' + page;
    const prs = await releaseGitHubRead(route, token, reader, 'DIAGNOSTIC_HISTORY_API_FAILED');
    must(Array.isArray(prs), 'DIAGNOSTIC_HISTORY_INVALID');
    for (const pr of prs) {
      if (pr.number < number && pr.number > 509 && fields(pr.body || '').stage === stage) {
        const mode = fields(pr.body || '').mode;
        // Count every diagnostic attempt, including open/closed unmerged PRs.
        // Only landed implementation/acceptance work can reset the sequence.
        if (mode === 'diagnostic') count++;
        else if (pr.merged_at && ['implementation', 'acceptance'].includes(mode)) return count;
      }
    }
    if (prs.some(x => x.number <= 509) || prs.length < 100) return count;
  }
  throw new Error('DIAGNOSTIC_HISTORY_PAGINATION_BLOCK');
}
export async function verifiedOwnerComment(number, sha, kind, token, reader) {
  must(Number.isInteger(number) && SHA.test(sha) && (token || reader), 'OWNER_ATTESTATION_CONTEXT');
  const exact = 'ASI-OWNER-APPROVE:' + kind + ':' + number + ':' + sha;
  for (let page = 1; page <= 10; page++) {
    const route = 'issues/' + number + '/comments?per_page=100&page=' + page;
    const comments = await releaseGitHubRead(route, token, reader, 'OWNER_ATTESTATION_API_FAILED');
    must(Array.isArray(comments), 'OWNER_ATTESTATION_INVALID');
    // An App can post under the owner's numeric login. That is not an
    // independent human decision. Missing provenance fails closed too. These
    // provider fields exclude known App/bot origins; they do not prove human
    // custody of a user token or authorize standing-policy adoption.
    if (comments.some(x => Number.isSafeInteger(x?.id) && x.id > 0 &&
      x.user?.id === OWNER_ID && x.user.type === 'User' &&
      x.author_association === 'OWNER' && x.performed_via_github_app === null &&
      typeof x.body === 'string' && x.body.trim() === exact)) return true;
    if (comments.length < 100) return false;
  }
  throw new Error('OWNER_ATTESTATION_PAGINATION_BLOCK');
}
export function requiredApproval({contract, changed, prNumber, prBody, headSha}) {
  // A security-level change receives ONE owner exact-head approval, not a new
  // second reviewer or multiple per-commit approvals.
  // When this protected checker itself changes, the existing trusted-main
  // CONTRACT-CHANGE attestation remains the one required approval. Subsequent
  // baseline-only changes use SECURITY-BASELINE-CHANGE, never two at once.
  if (changed.some(p => GOVERNANCE.has(p) && !OWNER_BASELINE_PATHS.has(p)))
    return 'CONTRACT-CHANGE';
  if (changed.some(p => OWNER_BASELINE_PATHS.has(p)))
    return 'SECURITY-BASELINE-CHANGE';
  if (prNumber <= contract.transition.legacyPrMax) {
    return [502, 508, 509].includes(prNumber) &&
      contract.transition.legacyHeads[String(prNumber)] === headSha
      ? null : 'RELEASE-EXCEPTION';
  }
  const f = fields(prBody || '');
  if (f.mode === 'development' && changed.every(developmentPath)) return null;
  const next = contract.stages.find(s => s.status !== 'ACCEPTED')?.id;
  const stage = contract.stages.find(s => s.id === f.stage);
  return !stage || stage.id !== next ||
    !['implementation', 'diagnostic', 'acceptance'].includes(f.mode) ||
    changed.some(p => ![...stage.files, ...(stage.plannedFiles || [])].includes(p) && !routineStagePath(stage.id,p))
    ? 'RELEASE-EXCEPTION' : null;
}
export async function verifyStageRuns(contract, token, reader) {
  const verified = new Set();
  // Only the independently approved, protected physical repair path is accepted
  // at this stage. Other stage workflows require a separately reviewed contract.
  const allowed = new Map([['S4-G1', {
    workflow: '.github/workflows/strigunov4-c4-unit-apply.yml',
    job: 'protected_c4_unit_apply',
  }]]);
  for (const stage of contract.stages) {
    if (stage.status !== 'ACCEPTED') continue;
    must((token || reader) && SHA.test(stage.acceptanceSha), 'ACCEPTANCE_SHA_REQUIRED');
    const expected = allowed.get(stage.id);
    must(expected, 'STAGE_ACCEPTANCE_WORKFLOW_NOT_APPROVED');
    for (const proof of stage.proof) {
      const match = typeof proof === 'string' &&
        /^https:\/\/github\.com\/ASI-integration\/asi-landing\/actions\/runs\/([0-9]+)$/.exec(proof);
      must(match, 'ACCEPTANCE_INVALID_PROOF');
      const uri = 'actions/runs/'+match[1];
      const get = (route, label) => releaseGitHubRead(route, token, reader, label);
      const run = await get(uri,'ACCEPTANCE_RUN_UNAVAILABLE');
      must(run.repository?.full_name === REPO && run.status === 'completed' &&
        run.conclusion === 'success' && run.head_sha === stage.acceptanceSha &&
        run.head_branch === 'main' && run.path === expected.workflow &&
        run.event === 'workflow_dispatch' && run.run_attempt === 1,
        'ACCEPTANCE_UNVERIFIED_RUN');
      const approvals = await get(uri+'/approvals','ACCEPTANCE_APPROVALS_UNAVAILABLE');
      must(Array.isArray(approvals) && approvals.some(a =>
        a.user?.id === OWNER_ID && a.state === 'approved' &&
        a.environments?.some(env => env.name === 'staging' &&
          env.can_admins_bypass === false)), 'ACCEPTANCE_NO_PROTECTED_STAGING_APPROVAL');
      const jobs = await get(uri+'/jobs?per_page=100','ACCEPTANCE_JOBS_UNAVAILABLE');
      must(Array.isArray(jobs.jobs) && Number.isSafeInteger(jobs.total_count) &&
        jobs.total_count === jobs.jobs.length && jobs.total_count <= 100 &&
        jobs.jobs.some(j => j.name === expected.job &&
          j.status === 'completed' && j.conclusion === 'success'),
        'ACCEPTANCE_NO_REQUIRED_JOB');
      verified.add(proof);
    }
  }
  return verified;
}

export async function main(options = {}) {
  const repoRoot = options.repoRoot || ROOT;
  // Retain protected main NORMAL security baseline before native/CI gate reads.
  verifyOwnerSecurityFiles(repoRoot);
  // Snapshot the host-selected context before the first asynchronous read. A
  // native invocation must not silently inherit an unrelated CI event/token.
  const reader = options.githubReader;
  const nativeContext = reader !== undefined || options.prEvent !== undefined;
  must(!nativeContext || options.ci === true && reader && isStandingReleaseReader(reader) &&
    options.prEvent && typeof options.prEvent === 'object', 'NATIVE_RELEASE_CONTEXT_REQUIRED');
  const nativeEvent = nativeContext ? structuredClone(options.prEvent) : undefined;
  if (nativeContext) {
    const pr = nativeEvent.pull_request;
    must(nativeEvent.repository?.full_name === REPO && Number.isSafeInteger(nativeEvent.number) &&
      nativeEvent.number > 0 && pr?.number === nativeEvent.number, 'PR_REPOSITORY');
    must(pr.base?.ref === 'main' && pr.head?.repo?.full_name === REPO &&
      SHA.test(pr.base.sha) && SHA.test(pr.head.sha), 'PR_SOURCE');
  }
  const resolveAdmission = options.resolveStandingAdmission;
  must(resolveAdmission === undefined || nativeContext && typeof resolveAdmission === 'function' &&
    options.standingAdmission === undefined, 'STANDING_ADMISSION_RESOLVER_CONTEXT');
  const token = nativeContext ? undefined : process.env.GITHUB_TOKEN;
  // A host call evaluates the protected base contract, never candidate worktree
  // bytes. The CLI keeps its existing release-validation behavior.
  const release = JSON.parse(nativeContext ? execFileSync('git',
    ['-c', 'core.hooksPath=/dev/null', 'show', nativeEvent.pull_request.base.sha + ':' + CONTRACT],
    { cwd: repoRoot, encoding: 'utf8', timeout: 5000, maxBuffer: 1000000,
      env: {PATH:process.env.PATH, GIT_CONFIG_NOSYSTEM:'1', GIT_CONFIG_GLOBAL:'/dev/null'} }) :
    fs.readFileSync(path.join(repoRoot, CONTRACT), 'utf8'));
  const verifiedRuns = options.ci && (token || reader) ?
    await verifyStageRuns(release, token, reader) : new Set();
  const status = validateContract(release, trackedFiles(repoRoot), verifiedRuns);
  if (!options.ci) {
    return { status: 'LOCAL_RELEASE_CONTRACT_VALID', ...status };
  }
  if (!nativeContext && !['pull_request', 'pull_request_target'].includes(process.env.GITHUB_EVENT_NAME)) {
    return { status: 'CI_NO_PR_CONTEXT', ...status };
  }
  must(nativeContext || !!process.env.GITHUB_EVENT_PATH, 'PR_EVENT_MISSING');
  const event = nativeEvent ?? JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const pr = event.pull_request;
  must(event.repository?.full_name === REPO && pr?.number === event.number, 'PR_REPOSITORY');
  must(pr.base?.ref === 'main' && pr.head?.repo?.full_name === REPO, 'PR_SOURCE');
  const changed = prChanges(pr.base.sha, pr.head.sha, repoRoot);
  const baseHasContract = (() => {
    try {
      execFileSync('git', ['cat-file', '-e', pr.base.sha + ':' + CONTRACT], { cwd: repoRoot, stdio: 'ignore' });
      return true;
    } catch { return false; }
  })();
  const approvalKind = baseHasContract ? requiredApproval({contract:release,
    changed, prNumber:pr.number, prBody:pr.body || '', headSha:pr.head.sha}) : null;
  const ownerApproval = approvalKind ? await verifiedOwnerComment(
    pr.number, pr.head.sha, approvalKind, token, reader) : false;
  const parsed = fields(pr.body || '');
  const priorDiagnosticCount = baseHasContract && parsed.mode === 'diagnostic' &&
    parsed.stage === status.nextStage && pr.number > release.transition.legacyPrMax
    ? await previousDiagnostics(parsed.stage, pr.number, token, reader) : 0;
  // The native receipt binds the final durable budget generation. Mint it only
  // after all prerequisite reads; no await follows before synchronous checkPr.
  const standingAdmission = resolveAdmission ? await resolveAdmission() : options.standingAdmission;
  must(resolveAdmission === undefined || standingAdmission !== undefined, 'STANDING_ADMISSION_MISSING');
  return { ...checkPr({ contract: release, changed, prNumber: pr.number,
    prBody: pr.body || '', headSha: pr.head.sha, baseHasContract, ownerApproval,
    priorDiagnosticCount, verifiedRuns,baseSha:pr.base.sha,standingAdmission }),
    nextStage: status.nextStage, changedFiles: changed.length };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main({ ci: process.argv.includes('--ci') })
    .then(result => process.stdout.write(JSON.stringify(result) + '\n'))
    .catch(err => {
      process.stderr.write(JSON.stringify({ status: 'RELEASE_GOVERNANCE_BLOCK', reason: err.message }) + '\n');
      process.exitCode = 1;
    });
}
