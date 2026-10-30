import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { checkPr, validateContract, CONTRACT, GOVERNANCE, verifiedOwnerComment, previousDiagnostics, requiredApproval, verifyStageRuns, prChanges } from '../check-demo-release.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
// Historical G1-open fixture: regression tests must not depend on today's release stage.
const liveContract = JSON.parse(fs.readFileSync(path.join(root, CONTRACT), 'utf8'));
const seed = structuredClone(liveContract);
seed.stages[0].status = 'IN_PROGRESS';
seed.stages[0].proof = [];
delete seed.stages[0].acceptanceSha;
seed.stages[1].status = 'NOT_STARTED';
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
test('02 only exact-head demo PRs are grandfathered; other legacy PRs require owner decision', () => {
  assert.equal(check().status, 'CURRENT_MILESTONE_SCOPED');
  assert.equal(check({ prNumber: 509,
    headSha: '5ba61e734a1f9a56cd807eee91b4e217bf6ee040',
    changed: ['outside/old-pr-only.ts'] }).status, 'EXISTING_DEMO_PR_GRANDFATHERED');
  assert.throws(() => check({ prNumber: 509, changed: ['outside/old-pr-only.ts'] }),
    /LEGACY_OR_OFF_SCOPE_PR_REQUIRES_OWNER_ATTESTATION/);
  assert.throws(() => check({ prNumber: 4,
    headSha: 'f7e21327304b3fd1d0f69db04d9cfff35c81ae39',
    changed: ['src/location/unrelated.ts'] }),
    /LEGACY_OR_OFF_SCOPE_PR_REQUIRES_OWNER_ATTESTATION/);
  assert.equal(check({ prNumber: 4,
    headSha: 'f7e21327304b3fd1d0f69db04d9cfff35c81ae39',
    ownerApproval: true, changed: ['src/location/unrelated.ts'] }).status,
    'OWNER_ATTESTED_LEGACY_EXCEPTION');
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
  // A planned file is permitted both before its first merge and after
  // it becomes tracked by main; otherwise the release gate deadlocks itself.
  assert.equal(validateContract(copy(), new Set([...known, planned])).nextStage,
    'S4-G1');
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
  next.stages[0].acceptanceSha = sha;
  next.stages[0].proof = ['https://github.com/ASI-integration/asi-landing/actions/runs/39261951787'];
  next.stages[1].status = 'IN_PROGRESS';
  assert.throws(() => validateContract(next, known), /ACCEPTED_REQUIRES_INDEPENDENT_RUN_EVIDENCE/);
  const verified = new Set(next.stages[0].proof);
  const status = validateContract(next, known, verified);
  assert.equal(status.nextStage, 'S4-G2');
  assert.equal(check({ contract: next, prBody: body('S4-G2'),
    changed: ['scripts/strigunov4/c4_operator_host.py'], verifiedRuns: verified }).status, 'CURRENT_MILESTONE_SCOPED');
});
test('11 a finished release cannot quietly reopen without new owner scope', () => {
  const a = copy();
  for (const stage of a.stages) {
    stage.status = 'ACCEPTED';
    stage.acceptanceSha = sha;
    stage.proof = ['https://github.com/ASI-integration/asi-landing/actions/runs/39261951787'];
  }
  assert.throws(() => validateContract(a, known, new Set(a.stages[0].proof)),
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
      {id: 42, user: {id: 207600140, type: 'User'}, author_association: 'OWNER', performed_via_github_app: null, body: 'ASI-OWNER-APPROVE:CONTRACT-CHANGE:520:' + sha},
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

test('15 invalid release mode is independently detected as an owner exception', () => {
  assert.equal(requiredApproval({contract:seed,changed:['scripts/strigunov4/c4_unit_contract.py'],
    prNumber:520,prBody:body('S4-G1','garbage'),headSha:sha}), 'RELEASE-EXCEPTION');
  assert.equal(requiredApproval({contract:seed,changed:['scripts/strigunov4/c4_unit_contract.py'],
    prNumber:520,prBody:body(),headSha:sha}), null);
});
test('16 earlier implementation resets consecutive diagnostic sequence', async () => {
  const old=globalThis.fetch;
  try {
    globalThis.fetch=async()=>({ok:true,json:async()=>[
      {number:519,body:body('S4-G1','diagnostic','1')},
      {number:518,merged_at:'2026-10-20T00:00:00Z',body:body('S4-G1','implementation')},
      {number:517,body:body('S4-G1','diagnostic','1')},
    ]});
    assert.equal(await previousDiagnostics('S4-G1',520,'token'),1);
    for (const state of ['open', 'closed']) {
      globalThis.fetch=async()=>({ok:true,json:async()=>[
        {number:519,state:'closed',merged_at:null,body:body('S4-G1','diagnostic','2')},
        {number:518,state,merged_at:null,body:body('S4-G1','implementation')},
        {number:517,state:'open',merged_at:null,body:body('S4-G1','diagnostic','1')},
        {number:516,merged_at:'2026-10-20T00:00:00Z',body:body('S4-G1','garbage')},
      ]});
      const count=await previousDiagnostics('S4-G1',520,'token');
      assert.equal(count,2);
      assert.throws(()=>check({prNumber:520,prBody:body('S4-G1','diagnostic','3'),
        priorDiagnosticCount:count}),/DIAGNOSTIC_LIMIT_REQUIRES_DECISION/);
    }
  } finally {globalThis.fetch=old;}
});
test('17 protected staging approval, stage workflow and exact SHA are required', async () => {
  const c=copy();c.stages[0].status='ACCEPTED';c.stages[0].acceptanceSha=sha;
  c.stages[0].proof=['https://github.com/ASI-integration/asi-landing/actions/runs/123'];
  c.stages[1].status='IN_PROGRESS';
  const old=globalThis.fetch;
  const evidence = {repository:{full_name:'ASI-integration/asi-landing'},
    head_sha:sha,head_branch:'main',run_attempt:1,
    path:'.github/workflows/strigunov4-c4-unit-apply.yml',
    status:'completed',conclusion:'success',event:'workflow_dispatch'};
  const approvals=[{user:{id:207600140},state:'approved',
    environments:[{name:'staging',can_admins_bypass:false}]}];
  let jobs={total_count:1,jobs:[{name:'protected_c4_unit_apply',
    status:'completed',conclusion:'success'}]};
  let run = {...evidence};
  let auth=approvals;
  globalThis.fetch=async url=>({ok:true,json:async()=>
    url.endsWith('/approvals')?auth:url.includes('/jobs?')?jobs:run});
  try {
    assert.throws(() => validateContract(c,known,new Set()),
      /ACCEPTED_REQUIRES_INDEPENDENT_RUN_EVIDENCE/);
    const verified=await verifyStageRuns(c,'token');
    assert.equal(validateContract(c,known,verified).nextStage,'S4-G2');
    run={...evidence,head_sha:'a'.repeat(40)};
    await assert.rejects(verifyStageRuns(c,'token'),/ACCEPTANCE_UNVERIFIED_RUN/);
    run={...evidence,path:'.github/workflows/other.yml'};
    await assert.rejects(verifyStageRuns(c,'token'),/ACCEPTANCE_UNVERIFIED_RUN/);
    run={...evidence};auth=[];
    await assert.rejects(verifyStageRuns(c,'token'),/ACCEPTANCE_NO_PROTECTED_STAGING_APPROVAL/);
    auth=approvals;jobs={total_count:1,jobs:[{name:'unrelated_job',status:'completed',conclusion:'success'}]};
    await assert.rejects(verifyStageRuns(c,'token'),/ACCEPTANCE_NO_REQUIRED_JOB/);
    jobs={total_count:2,jobs:[{name:'protected_c4_unit_apply',status:'completed',conclusion:'success'}]};
    await assert.rejects(verifyStageRuns(c,'token'),/ACCEPTANCE_NO_REQUIRED_JOB/);
  } finally {globalThis.fetch=old;}
});

test('18 merge-base paths exclude changes made only on the base branch', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'asi-merge-base-'));
  const git=(...args)=>execFileSync('git',args,{cwd:dir,encoding:'utf8'}).trim();
  try {
    git('init','-q');git('config','user.name','Offline test');git('config','user.email','offline@example.invalid');
    fs.writeFileSync(path.join(dir,'common.txt'),'base\n');git('add','.');git('commit','-qm','base');
    const base=git('rev-parse','HEAD');
    fs.writeFileSync(path.join(dir,'base-only.txt'),'unrelated\n');git('add','.');git('commit','-qm','base advance');
    const tip=git('rev-parse','HEAD');
    git('checkout','-q','--detach',base);
    fs.writeFileSync(path.join(dir,'pr-only.txt'),'change\n');git('add','.');git('commit','-qm','PR');
    assert.deepEqual(prChanges(tip,git('rev-parse','HEAD'),dir),['pr-only.txt']);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('19 rename cannot hide governance or out-of-stage source paths', () => {
  for(const source of ['AGENTS.md','unrelated.txt']) {
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'asi-rename-scope-'));
    const git=(...args)=>execFileSync('git',args,{cwd:dir,encoding:'utf8'}).trim();
    try {
      git('init','-q');git('config','user.name','Offline test');git('config','user.email','offline@example.invalid');
      git('config','diff.renames','true');
      fs.writeFileSync(path.join(dir,source),'unchanged content\n');git('add','.');git('commit','-qm','base');
      const base=git('rev-parse','HEAD');
      const target='scripts/strigunov4/protected_c4_unit_apply.py';
      fs.mkdirSync(path.dirname(path.join(dir,target)),{recursive:true});git('mv',source,target);git('commit','-qm','rename');
      const changed=prChanges(base,git('rev-parse','HEAD'),dir);
      assert.deepEqual(new Set(changed),new Set([source,target]));
      assert.throws(()=>check({changed}),source==='AGENTS.md'
        ? /GOVERNANCE_CHANGE_NEEDS_VERIFIED_OWNER_ATTESTATION/ : /PR_HAS_OUT_OF_STAGE_FILES/);
      assert.equal(requiredApproval({contract:seed,changed,prNumber:520,prBody:body(),headSha:sha}),
        source==='AGENTS.md'?'CONTRACT-CHANGE':'RELEASE-EXCEPTION');
    } finally {fs.rmSync(dir,{recursive:true,force:true});}
  }
});

test('20 owner-login App comments and missing origin cannot attest governance', async () => {
  const previous = globalThis.fetch;
  const direct = {id:42,user:{id:207600140,type:'User'},author_association:'OWNER',
    performed_via_github_app:null,body:'ASI-OWNER-APPROVE:CONTRACT-CHANGE:520:'+sha};
  try {
    for (const change of [
      {performed_via_github_app:{id:1144995,slug:'chatgpt-codex-connector'}},
      {performed_via_github_app:{id:15368,slug:'github-actions'}},
      {performed_via_github_app:undefined},
      {user:{id:207600140,type:'Bot'}}, {user:{id:207600140}},
      {author_association:'MEMBER'}, {author_association:undefined},
      {id:undefined}, {body:{trim:()=>direct.body}},
    ]) {
      globalThis.fetch=async()=>({ok:true,json:async()=>[{...direct,...change}]});
      assert.equal(await verifiedOwnerComment(520,sha,'CONTRACT-CHANGE','INERT'),false);
    }
    globalThis.fetch=async()=>({ok:true,json:async()=>[direct]});
    assert.equal(await verifiedOwnerComment(520,sha,'CONTRACT-CHANGE','INERT'),true);
  } finally { globalThis.fetch=previous; }
});
