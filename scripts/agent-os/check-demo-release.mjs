#!/usr/bin/env node
/**
 * ASI demo release gate. Enforce milestone-first work on pull requests.
 * GitHub API owner attestations are independent of the untrusted PR body.
 * This gate does not grant permission for merge, staging or server mutations.
 */
import fs from 'node:fs';
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
export function validateContract(contract, knownPaths) {
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
      must(!p.includes('..') && !p.includes('\\') && !p.startsWith('/') && !available.has(p),
           'PLANNED_FILE_ALREADY_PRESENT_OR_UNSAFE:' + p);
    }
    for (const p of stage.files) {
      must(typeof p === 'string' && !p.includes('..') && !p.startsWith('/') &&
           available.has(p), 'STAGE_FILE_NOT_TRACKED_OR_PINNED:' + p);
      fileCounts[p] = (fileCounts[p] || 0) + 1;
    }
    must(Array.isArray(stage.proof), 'STAGE_PROOF');
    if (stage.status === 'ACCEPTED') {
      must(!openSeen && stage.proof.length >= 1 &&
           stage.proof.every(p => typeof p === 'string' && /^https:\/\/github\.com\/ASI-integration\/asi-landing\/actions\/runs\/[0-9]+/.test(p)),
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
  const raw = execFileSync('git', ['diff', '--name-only', '-z', baseSha, headSha], {
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
export function checkPr({ contract, changed, prNumber, prBody, headSha,
                          baseHasContract, ownerApproval = false, priorDiagnosticCount = 0 }) {
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
    if (contract.transition.legacyHeads[String(prNumber)] === headSha) {
      return { status: 'EXISTING_PR_GRANDFATHERED', stage: null };
    }
    must(ownerApproval, 'LEGACY_HEAD_CHANGED_REQUIRES_OWNER_ATTESTATION');
    return { status: 'OWNER_ATTESTED_LEGACY_CHANGE', stage: null };
  }
  if (governanceChanged) {
    must(ownerApproval, 'GOVERNANCE_CHANGE_NEEDS_VERIFIED_OWNER_ATTESTATION');
    return { status: 'OWNER_ATTESTED_GOVERNANCE_CHANGE', stage: null };
  }
  const f = fields(prBody);
  const next = validateContract(contract, new Set(contract.stages.flatMap(s => s.files))).nextStage;
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
      if (pr.number < number && pr.number > 509 &&
          fields(pr.body || '').stage === stage &&
          fields(pr.body || '').mode === 'diagnostic') count++;
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
export async function main(options = {}) {
  const repoRoot = options.repoRoot || ROOT;
  const release = JSON.parse(fs.readFileSync(path.join(repoRoot, CONTRACT), 'utf8'));
  const status = validateContract(release, trackedFiles(repoRoot));
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
  let ownerApproval = false;
  // No PR self-asserted approval. Verify an exact HEAD-bound owner GitHub comment.
  if (baseHasContract) {
    const gov = changed.some(p => GOVERNANCE.has(p));
    const legacyChanged = pr.number <= release.transition.legacyPrMax &&
      release.transition.legacyHeads[String(pr.number)] !== pr.head.sha;
    const stage = fields(pr.body || '').stage;
    const milestone = release.stages.find(s => s.id === stage);
    const needException = !gov && (!milestone || milestone.id !== status.nextStage ||
      changed.some(p => ![...milestone.files, ...(milestone.plannedFiles || [])].includes(p)));
    if (gov || legacyChanged || (pr.number > release.transition.legacyPrMax && needException)) {
      ownerApproval = await verifiedOwnerComment(
        pr.number, pr.head.sha, gov ? 'CONTRACT-CHANGE' : 'RELEASE-EXCEPTION', process.env.GITHUB_TOKEN,
      );
    }
  }
  const parsed = fields(pr.body || '');
  const priorDiagnosticCount = baseHasContract && parsed.mode === 'diagnostic' &&
    parsed.stage === status.nextStage && pr.number > release.transition.legacyPrMax
    ? await previousDiagnostics(parsed.stage, pr.number, process.env.GITHUB_TOKEN) : 0;
  return { ...checkPr({ contract: release, changed, prNumber: pr.number,
    prBody: pr.body || '', headSha: pr.head.sha, baseHasContract, ownerApproval,
    priorDiagnosticCount }),
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
