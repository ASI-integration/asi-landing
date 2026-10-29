#!/usr/bin/env node
/**
 * ASI demo release gate. Enforce milestone-first work on pull requests.
 * GitHub API owner attestations are independent of the untrusted PR body.
 * This gate does not grant permission for merge, staging or server mutations.
 */
import fs from 'node:fs';
import { createHash, createPublicKey } from 'node:crypto';
import { verifySignedPayload } from '../strigunov4/execution-adapters/host-authority.mjs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const CONTRACT = 'docs/agent-os/releases/strigunov4-demo.json';
export const GOVERNANCE = new Set([
  CONTRACT, 'scripts/agent-os/check-demo-release.mjs',
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
export function assessReleaseEnvelopeProposal({ envelope: e, evidence: v, request: r, now }) {
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
  if (v.ownerVerified !== true || v.ownerId !== OWNER_ID ||
      v.envelopeDigest !== e.envelopeDigest || v.policyDigest !== e.policyDigest ||
      v.revocation !== 'NOT_REVOKED' || v.observedAt !== now) return deny('ENVELOPE_TRUST');
  if (!['source', 'release', 'activation'].includes(e.action) || r.action !== e.action ||
      r.repo !== e.repo || r.target !== e.target || r.environment !== e.environment ||
      r.appId !== e.appId || r.installationId !== e.installationId ||
      r.securityDigest !== e.securityDigest) return deny('ENVELOPE_SCOPE');
  if (!paths(e.allowedPaths) || !paths(r.changedPaths) ||
      !r.changedPaths.every(p => e.allowedPaths.includes(p)) ||
      r.changedPaths.some(p => GOVERNANCE.has(p) || p === 'docs/agent-os/AUTONOMY_POLICY.md' ||
        p.startsWith('.github/') || /(^|\/)(secrets?|authority|permissions)(\/|\.)/i.test(p)))
    return deny('ENVELOPE_PROTECTED_CHANGE');
  if (!sha(r.headSha) || !sha(r.baseSha) || !digest(r.artifactDigest) ||
      v.headSha !== r.headSha || v.baseSha !== r.baseSha || v.artifactDigest !== r.artifactDigest ||
      v.ci !== 'SUCCESS' || v.independentReview !== 'PASS' || v.branchProtection !== 'PASS')
    return deny('ENVELOPE_EXACT_EVIDENCE');
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
  for (const rule of required) {
    const matches = runs.filter(run =>
      run.workflow_id === rule.workflow_id && run.event === rule.event &&
      run.head_sha === rule.head_sha &&
      run.repository?.full_name === REPO &&
      Array.isArray(run.pull_requests) &&
      run.pull_requests.some(p => p.number === expected.number &&
        p.head?.sha === expected.headSha &&
        p.base?.sha === expected.baseSha));
    // Missing PR bindings, unclear attempts, or a newer failing run fail closed.
    if (!matches.length || matches.some(run => !Number.isSafeInteger(run.id) ||
          !Number.isSafeInteger(run.run_attempt) || run.run_attempt < 1))
      return deny('PROVIDER_WORKFLOW_IDENTITY');
    matches.sort((a,b) => b.id - a.id || b.run_attempt - a.run_attempt);
    const latest = matches[0];
    if (latest.status !== 'completed' || latest.conclusion !== 'success')
      return deny('PROVIDER_WORKFLOW_NOT_GREEN');
    const finished = Date.parse(latest.updated_at || '');
    if (!Number.isFinite(finished) || finished > now ||
        finished < now - 60 * 60 * 1000)
      return deny('PROVIDER_WORKFLOW_STALE');
  }
  const matchingReview = reviews.some(review =>
    review?.state === 'APPROVED' &&
    review.commit_id === expected.headSha &&
    review.user?.id === expected.independentReviewerId &&
    Number.isFinite(Date.parse(review.submitted_at || '')) &&
    Date.parse(review.submitted_at) <= now);
  if (!matchingReview) return deny('PROVIDER_INDEPENDENT_REVIEW');
  return {status:'PROVIDER_EVIDENCE_VERIFIED', authorized:false};
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
  return assessWitnessedReleaseEnvelopeProposal(input);
}

export function checkPr({ contract, changed, prNumber, prBody, headSha,
                          baseHasContract, ownerApproval = false, priorDiagnosticCount = 0, verifiedRuns = new Set() }) {
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
  if (!changed.every(p => allowed.has(p))) {
    must(ownerApproval, 'PR_HAS_OUT_OF_STAGE_FILES');
    return { status: 'OWNER_ATTESTED_RELEASE_EXCEPTION', stage: f.stage };
  }
  return { status: 'CURRENT_MILESTONE_SCOPED', stage: f.stage, mode: f.mode };
}
export async function previousDiagnostics(stage, number, token) {
  must(token && /^S4-G[1-6]$/.test(stage), 'DIAGNOSTIC_HISTORY_CONTEXT');
  let count = 0;
  for (let page = 1; page <= 10; page++) {
    const uri = 'https://api.github.com/repos/' + REPO
      + '/pulls?state=all&sort=created&direction=desc&per_page=100&page=' + page;
    const response = await fetch(uri, { headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': 'Bearer ' + token,
      'X-GitHub-Api-Version': '2022-11-28',
    } });
    must(response.ok, 'DIAGNOSTIC_HISTORY_API_FAILED');
    const prs = await response.json();
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
export async function verifiedOwnerComment(number, sha, kind, token) {
  must(Number.isInteger(number) && SHA.test(sha) && token, 'OWNER_ATTESTATION_CONTEXT');
  const exact = 'ASI-OWNER-APPROVE:' + kind + ':' + number + ':' + sha;
  for (let page = 1; page <= 10; page++) {
    const uri = 'https://api.github.com/repos/' + REPO + '/issues/' + number
        + '/comments?per_page=100&page=' + page;
    const response = await fetch(uri, { headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': 'Bearer ' + token,
      'X-GitHub-Api-Version': '2022-11-28',
    } });
    must(response.ok, 'OWNER_ATTESTATION_API_FAILED');
    const comments = await response.json();
    must(Array.isArray(comments), 'OWNER_ATTESTATION_INVALID');
    if (comments.some(x => x.user?.id === OWNER_ID && x.body?.trim() === exact)) return true;
    if (comments.length < 100) return false;
  }
  throw new Error('OWNER_ATTESTATION_PAGINATION_BLOCK');
}
export function requiredApproval({contract, changed, prNumber, prBody, headSha}) {
  if (changed.some(p => GOVERNANCE.has(p))) return 'CONTRACT-CHANGE';
  if (prNumber <= contract.transition.legacyPrMax) {
    return [502, 508, 509].includes(prNumber) &&
      contract.transition.legacyHeads[String(prNumber)] === headSha
      ? null : 'RELEASE-EXCEPTION';
  }
  const next = contract.stages.find(s => s.status !== 'ACCEPTED')?.id;
  const f = fields(prBody || '');
  const stage = contract.stages.find(s => s.id === f.stage);
  return !stage || stage.id !== next ||
    !['implementation', 'diagnostic', 'acceptance'].includes(f.mode) ||
    changed.some(p => ![...stage.files, ...(stage.plannedFiles || [])].includes(p))
    ? 'RELEASE-EXCEPTION' : null;
}
export async function verifyStageRuns(contract, token) {
  const verified = new Set();
  // Only the independently approved, protected physical repair path is accepted
  // at this stage. Other stage workflows require a separately reviewed contract.
  const allowed = new Map([['S4-G1', {
    workflow: '.github/workflows/strigunov4-c4-unit-apply.yml',
    job: 'protected_c4_unit_apply',
  }]]);
  for (const stage of contract.stages) {
    if (stage.status !== 'ACCEPTED') continue;
    must(token && SHA.test(stage.acceptanceSha), 'ACCEPTANCE_SHA_REQUIRED');
    const expected = allowed.get(stage.id);
    must(expected, 'STAGE_ACCEPTANCE_WORKFLOW_NOT_APPROVED');
    for (const proof of stage.proof) {
      const match = typeof proof === 'string' &&
        /^https:\/\/github\.com\/ASI-integration\/asi-landing\/actions\/runs\/([0-9]+)$/.exec(proof);
      must(match, 'ACCEPTANCE_INVALID_PROOF');
      const headers = {Accept:'application/vnd.github+json', Authorization:'Bearer '+token,
        'X-GitHub-Api-Version':'2022-11-28'};
      const uri = 'https://api.github.com/repos/'+REPO+'/actions/runs/'+match[1];
      const get = async (url, label) => {
        const response = await fetch(url, {headers});
        must(response.ok, label);
        return response.json();
      };
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
  const release = JSON.parse(fs.readFileSync(path.join(repoRoot, CONTRACT), 'utf8'));
  const verifiedRuns = options.ci && process.env.GITHUB_TOKEN ?
    await verifyStageRuns(release, process.env.GITHUB_TOKEN) : new Set();
  const status = validateContract(release, trackedFiles(repoRoot), verifiedRuns);
  if (!options.ci) {
    return { status: 'LOCAL_RELEASE_CONTRACT_VALID', ...status };
  }
  if (!['pull_request', 'pull_request_target'].includes(process.env.GITHUB_EVENT_NAME)) {
    return { status: 'CI_NO_PR_CONTEXT', ...status };
  }
  must(!!process.env.GITHUB_EVENT_PATH, 'PR_EVENT_MISSING');
  const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
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
    pr.number, pr.head.sha, approvalKind, process.env.GITHUB_TOKEN) : false;
  const parsed = fields(pr.body || '');
  const priorDiagnosticCount = baseHasContract && parsed.mode === 'diagnostic' &&
    parsed.stage === status.nextStage && pr.number > release.transition.legacyPrMax
    ? await previousDiagnostics(parsed.stage, pr.number, process.env.GITHUB_TOKEN) : 0;
  return { ...checkPr({ contract: release, changed, prNumber: pr.number,
    prBody: pr.body || '', headSha: pr.head.sha, baseHasContract, ownerApproval,
    priorDiagnosticCount, verifiedRuns }),
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
