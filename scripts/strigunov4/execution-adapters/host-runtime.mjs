// Imported only by the existing runner hook. No timer, second daemon or import I/O.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {loadHostAuthority,validateHostLoop,ENGINE_ROOT,LEGACY_STATE} from './host-authority.mjs';
import {createAppTokenProvider} from './host-github-app.mjs';
import {createHostChecks} from './host-checks.mjs';
import {createGitHubReader} from './github-readonly.mjs';
import {createPublisherTransport} from './publisher-transport.mjs';
import {createPublicationLoop} from './publication-loop.mjs';
import {digest,must,regular,atomicJson} from './state.mjs';
import {selectRoute} from '../ASI-STRIGUNOV4-RUNNER-BRIDGE-20261020.mjs';
import {WORK_ORDERS,ENGINE_PILOT} from '../ASI-STRIGUNOV4-MULTIJOB-20261020.mjs';
const exec=promisify(execFile),REPO='ASI-integration/asi-landing';

/** Build ports from an already verified signed host payload. No caller callback,
 * Issue text, environment switch or advisory decision can select a review policy.
 * The reader is the existing authenticated fixed-origin GitHub reader.
 */
export function hostLoopOptions(payload,reader){
  validateHostLoop(payload);
  if(payload.closedLoop===undefined)return {};
  const c=payload.closedLoop;
  return {intervalMs:c.intervalMs,closedLoop:{
    stateDir:path.join(ENGINE_ROOT,'routing'),policy:c.policy,maxTicks:c.maxTicks,
    async readTrustedComments({repository,issue}){
      must(repository===REPO&&issue===511,'OWNER_COMMENT_SCOPE');
      const p=await reader.get('issues/511');
      must(p.number===511&&p.state==='open'&&!p.pull_request&&
        p.url===`https://api.github.com/repos/${REPO}/issues/511`,'OWNER_COMMENT_IDENTITY');
      const comments=await reader.pages('issues/511/comments');
      must(Array.isArray(comments)&&comments.every(v=>Number.isSafeInteger(v.id)&&v.id>0&&
        v.issue_url===p.url),'OWNER_COMMENT_IDENTITY');
      return comments;
    }
  }};
}

export function createHostSnapshot({reader,contract,readProjectGates,baseSha}){
  return async()=>{
    const main=await reader.get('branches/main');
    must(main.protected===true&&main.commit?.sha===baseSha,'MAIN_CHANGED');
    const issue=await reader.get('issues/511');
    must(issue.number===511&&issue.state==='open'&&Array.isArray(issue.labels),'ISSUE_UNVERIFIED');
    must(selectRoute(contract,issue).stage==='S4-G1','PILOT_STAGE_CLOSED');
    const project=await readProjectGates();
    must(project.source==='github-projects-v2'&&Date.now()-Date.parse(project.checkedAt)>=0&&
      Date.now()-Date.parse(project.checkedAt)<30000,'PROJECT_SNAPSHOT_STALE');
    const gate=project.items.filter(i=>i.issue===511&&i.stage==='S4-G1');must(gate.length===1,'PROJECT_CARD');
    const prs={};
    for(const ticket of WORK_ORDERS.filter(w=>w.kind==='review-pr')){
      const p=await reader.get('pulls/'+ticket.pr);
      must(p.number===ticket.pr&&p.head?.repo?.full_name===REPO&&p.base?.repo?.full_name===REPO&&p.base.ref==='main','DEPENDENCY_IDENTITY');
      prs[ticket.pr]={number:p.number,head:p.head.sha,state:p.state,merged:p.merged};
    }
    // Missing exact-head review evidence stays WAIT_CI, never fabricated PASS.
    // The pilot's prerequisite #509 is already merged and pinned in WORK_ORDERS.
    return {mainSha:baseSha,contract,issues:{511:{number:511,state:issue.state,
      labels:issue.labels.map(l=>l.name).sort()}},prs,checks:{},reviews:{},ledger:{},project:{511:gate[0].gate}};
  };
}

let active;
async function construct({readProjectGates}){
  const authority=await loadHostAuthority(),{payload,catalog}=authority;
  must(os.hostname()===payload.host,'HOST_NOT_ADMITTED');
  const task=catalog[0];
  must(task.workOrderId===ENGINE_PILOT.id&&task.changes.length===1&&task.changes[0].path===ENGINE_PILOT.paths[0],'PILOT_SCOPE');
  const runner='/home/project_ayfaar/asi-strigunov-agent/bin/runner.mjs';await regular(runner);
  must(digest(await fs.readFile(runner))===payload.runnerSha256,'RUNNER_NOT_ADMITTED');
  const seed=path.join(ENGINE_ROOT,'scratchpads',task.id);
  const {stdout}=await exec('/usr/bin/git',['-c','core.hooksPath=/dev/null','show',payload.baseSha+':docs/agent-os/releases/strigunov4-demo.json'],
    {cwd:seed,timeout:5000,maxBuffer:1000000,env:{PATH:'/usr/bin:/bin',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'}});
  const contract=JSON.parse(stdout),app=createAppTokenProvider(payload.githubApp);
  const reader=createGitHubReader({token:app.token}),remote=createPublisherTransport({token:app.token});
  const checks=createHostChecks({root:ENGINE_ROOT,catalog,
    codexHome:'/home/project_ayfaar/asi-strigunov-agent/codex-home',reviewDirectory:path.join(ENGINE_ROOT,'review')});
  const fetchSnapshot=createHostSnapshot({reader,contract,readProjectGates,baseSha:payload.baseSha});
  const loop=await createPublicationLoop({root:ENGINE_ROOT,legacyStateDir:LEGACY_STATE,catalog,fetchSnapshot,
    reader,remote,authorize:authority.authorize,...checks,ciPolicies:payload.ciPolicies,
    liveAdmission:authority.admission,enginePilot:true,timeoutMs:30000,...hostLoopOptions(payload,reader)});
  return {authority,loop};
}
export async function engineIteration(ports){
  // Rejected construction stays rejected until operator restart: no silent
  // fallback to the legacy publisher and no repeated authentication attempts.
  active??=construct(ports);
  try{const {authority,loop}=await active;await authority.revalidate();
    const r=await loop.poll({execute:true});
    return {event:'engine_tick',mode:r.mode,reason:r.reason??null,pr:r.pr??null,head:r.head??null};
  }catch{return {event:'engine_tick',mode:'BLOCKED',reason:'HOST_ACTIVATION_OR_PORT_UNVERIFIED'};}
}

/** Native Beget profile for the SAME publication loop and Dispatcher. No state
 * migration and no new scheduler; the existing runner owns process cadence. */
export async function createBegetRuntime(){
  const {loadBegetAuthority,BEGET,rootOwned}=await import('./host-authority.mjs');
  const {createBegetChecks}=await import('./host-checks.mjs');
  const authority=await loadBegetAuthority(),{payload,catalog}=authority;
  must(os.hostname()===BEGET.host&&os.userInfo().username===BEGET.user,'BEGET_HOST_IDENTITY');
  const manifestRaw=await rootOwned(BEGET.runtime+'/manifest.json');
  must(digest(manifestRaw)===payload.runtimeManifestSha256,'RUNTIME_MANIFEST_CHANGED');
  const manifest=JSON.parse(manifestRaw);
  must(manifest.schema==='asi.beget-engine-source.v1'&&Array.isArray(manifest.files)&&manifest.files.length<=100,'RUNTIME_MANIFEST');
  must(process.execPath===BEGET.runtime+'/node'&&
    digest(await rootOwned(BEGET.runtime+'/node',150000000,{encoding:null}))===manifest.nodeSha256&&
    digest(await rootOwned(BEGET.runtime+'/bwrap',2000000,{encoding:null}))===manifest.bwrapSha256&&
    digest(await rootOwned('/etc/systemd/system/'+BEGET.service))===manifest.unitSha256,'RUNTIME_DEPENDENCY_OR_UNIT_CHANGED');
  for(const f of manifest.files){
    must(/^scripts\/[a-zA-Z0-9_./-]+\.mjs$/.test(f.path)&&!f.path.includes('..')&&/^[a-f0-9]{64}$/.test(f.sha256),'RUNTIME_PATH');
    must(digest(await rootOwned(BEGET.runtime+'/'+f.path))===f.sha256,'RUNTIME_CHANGED');
  }
  const beforeRequest=createRequestBudget({root:BEGET.root,payload,revalidate:authority.revalidate});
  const app=createAppTokenProvider(payload.githubApp,{beforeRequest});
  const reader=createGitHubReader({token:app.token,beforeRequest}),remote=createPublisherTransport({token:app.token,beforeRequest});
  const checks=await createBegetChecks({root:BEGET.root,catalog,reviewsRaw:authority.files['reviews.json'],
    reviewPolicySha256:payload.reviewsSha256,revalidate:authority.revalidate,
    async verifyReviewProvenance(v){
      const ownerCI=v.schema==='asi.owner-ci-delta-review.v1';
      must(Number.isSafeInteger(v.sourcePr)&&v.sourcePr>0&&/^[a-f0-9]{40}$/.test(v.sourceSha),
        'REVIEW_PROVENANCE_SCHEMA');
      const p=await reader.get('pulls/'+v.sourcePr);
      must(p.number===v.sourcePr&&p.head?.sha===v.sourceSha&&p.head?.repo?.full_name===REPO&&
        p.base?.repo?.full_name===REPO&&Number.isSafeInteger(p.user?.id),'REVIEW_SOURCE_IDENTITY');
      if(ownerCI){
        must(v.sourcePr===549&&v.ownerId===207600140&&p.user.id===v.ownerId&&
          v.scope==='BEGET_G2_TWO_DRAFT_WITNESSES'&&
          Number.isSafeInteger(v.validationRunId)&&v.validationRunId>0&&
          Number.isSafeInteger(v.governanceRunId)&&v.governanceRunId>0&&
          v.validationRunId!==v.governanceRunId,'OWNER_REVIEW_SCOPE');
        const comments=await reader.pages('issues/'+v.sourcePr+'/comments');
        const exact='ASI-OWNER-APPROVE:CONTRACT-CHANGE:'+v.sourcePr+':'+v.sourceSha;
        must(comments.some(c=>c.user?.id===v.ownerId&&c.body?.trim()===exact),
          'OWNER_ATTESTATION_NOT_VERIFIED');
        for(const [id,workflow,event] of [
          [v.validationRunId,311380800,'pull_request'],
          [v.governanceRunId,390653294,'pull_request_target']]){
          const run=await reader.get('actions/runs/'+id);
          must(run.id===id&&run.workflow_id===workflow&&run.event===event&&
            run.head_sha===v.sourceSha&&run.status==='completed'&&
            run.conclusion==='success'&&run.repository?.full_name===REPO,
            'OWNER_CI_EXACT_HEAD_UNVERIFIED');
        }
        return;
      }
      must(Number.isSafeInteger(v.reviewerId)&&v.reviewerId>0&&
        p.user.id!==v.reviewerId,'REVIEW_PROVENANCE_SCHEMA');
      const reviews=await reader.pages('pulls/'+v.sourcePr+'/reviews');
      const latest=reviews.filter(r=>r.user?.id===v.reviewerId).sort((a,b)=>b.id-a.id)[0];
      must(latest?.commit_id===v.sourceSha&&latest.state==='APPROVED'&&
        latest.body==='ASI-OFFLINE-DELTA-REVIEW:'+digest(JSON.stringify(v.tasks))&&
        Date.parse(latest.submitted_at)<=Date.now()&&Date.parse(latest.submitted_at)>=v.notBefore&&Date.parse(latest.submitted_at)<v.expiresAt,'INDEPENDENT_REVIEW_UNVERIFIED');
    }});
  const seed=path.join(BEGET.root,'scratchpads',catalog[0].id);
  const {stdout}=await exec('/usr/bin/git',['-c','core.hooksPath=/dev/null','show',payload.baseSha+':docs/agent-os/releases/strigunov4-demo.json'],
    {cwd:seed,timeout:5000,maxBuffer:1000000,env:{PATH:'/usr/bin:/bin',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'}});
  must(digest(stdout)===payload.releaseSha256,'RELEASE_NOT_ADMITTED');const contract=JSON.parse(stdout);
  async function snapshot(){
    await authority.revalidate();await checks.verifyReviews();const m=await reader.get('branches/main'),issue=await reader.get('issues/512');
    must(m.protected===true&&m.commit?.sha===payload.baseSha&&selectRoute(contract,issue).stage==='S4-G2','BEGET_STAGE_OR_MAIN_CHANGED');
    // Independently re-read the canonical G1 physical witness, not a fixture PASS.
    const proofs=contract.stages[0].proof;must(Array.isArray(proofs)&&proofs.length===1,'G1_PROOF_MISSING');
    const match=/^https:\/\/github.com\/ASI-integration\/asi-landing\/actions\/runs\/([1-9][0-9]*)$/.exec(proofs[0]);
    must(match,'G1_PROOF_SCOPE');const run=await reader.get('actions/runs/'+match[1]);
    must(run.id===Number(match[1])&&run.status==='completed'&&run.conclusion==='success'&&
      run.head_sha===contract.stages[0].acceptanceSha&&run.repository?.full_name===REPO,'G1_PROOF_UNVERIFIED');
    const jobs=await reader.pages('actions/runs/'+run.id+'/attempts/'+run.run_attempt+'/jobs','jobs');
    must(jobs.length>0&&jobs.every(j=>j.status==='completed'&&j.conclusion==='success'),'G1_JOBS_UNVERIFIED');
    const fresh=await reader.get('branches/main');must(fresh.commit?.sha===m.commit.sha,'SNAPSHOT_CHANGED');
    return {mainSha:payload.baseSha,contract,issues:{512:{number:512,state:issue.state,labels:issue.labels.map(l=>l.name).sort()}},
      // This source preparation gate is signed in the exact native stage policy;
      // it grants no physical G2 acceptance or mutable project permissions.
      project:{512:'PREPARATION_ONLY'},ledger:{},prs:{},checks:{},reviews:{}};
  }
  const readTrustedComments=async({repository,issue})=>{
    must(repository===REPO&&issue===512,'OWNER_COMMENT_SCOPE');const p=await reader.get('issues/512');
    must(p.number===512&&p.state==='open'&&!p.pull_request&&p.url===`https://api.github.com/repos/${REPO}/issues/512`,'OWNER_COMMENT_IDENTITY');
    const comments=await reader.pages('issues/512/comments');must(comments.every(c=>c.issue_url===p.url),'OWNER_COMMENT_IDENTITY');return comments;
  };
  const loop=await createPublicationLoop({root:BEGET.root,catalog,reader,remote,fetchSnapshot:snapshot,
    authorize:authority.authorize,fencingWitness:authority.fencingWitness,...checks,ciPolicies:payload.ciPolicies,
    liveAdmission:authority.admission,timeoutMs:30000,intervalMs:payload.closedLoop.intervalMs,
    closedLoop:{...payload.closedLoop,stateDir:BEGET.root+'/routing',readTrustedComments}});
  return {async iteration(){
    // Expired admission is an idle BLOCKED service, never another signed grant.
    await authority.revalidate();await authority.fencingWitness();return loop.poll({execute:true});
  }};
}

export function createRequestBudget({root,payload,revalidate}){
  const stateDir=path.join(root,'state'),budgetFile=path.join(stateDir,'api-budget.json');
  const lock=path.join(stateDir,'api-budget.lock'),policyHash=digest(JSON.stringify(payload));
  // Use the existing durable directory-lock protocol even outside the unit's
  // flock. A crash/uncertain write leaves the marker for protected review.
  const syncDirectory=async()=>{
    const handle=await fs.open(stateDir,'r');try{await handle.sync();}finally{await handle.close();}
  };
  let busy=false;
  const beforeRequest=async({mutation=false}={})=>{
    must(!busy,'CONCURRENT_API_REQUEST');busy=true;
    let release=false;
    try{
      must(process.platform==='linux'&&await fs.realpath(stateDir)===path.resolve(stateDir),'API_BUDGET_DIRECTORY');
      const st=await fs.stat(stateDir);
      must(st.isDirectory()&&st.uid===process.getuid()&&!(st.mode&0o022),'API_BUDGET_DIRECTORY');
      try{await fs.mkdir(lock,{mode:0o700});}
      catch(e){if(e.code==='EEXIST')throw Error('API_BUDGET_LOCKED_OR_CRASHED');throw e;}
      await syncDirectory();
      // Until a write starts, a rejection is known not to have reserved spend.
      release=true;
      await revalidate();await regular(budgetFile);const b=JSON.parse(await fs.readFile(budgetFile));
      must(b.policySha256===policyHash&&Number.isSafeInteger(b.requests)&&b.requests>=0&&
        Number.isSafeInteger(b.mutations)&&b.mutations>=0&&b.mutations<=b.requests&&
        b.requests<payload.budget.maxRequests&&b.mutations<=payload.budget.maxMutations&&
        (!mutation||b.mutations<payload.budget.maxMutations),'API_BUDGET_EXHAUSTED_OR_CHANGED');
      release=false;
      await atomicJson(budgetFile,{...b,requests:b.requests+1,mutations:b.mutations+Number(mutation)});
      release=true;
    }finally{
      try{
        if(release){
          try{await fs.rmdir(lock);await syncDirectory();}
          catch{
            await fs.mkdir(lock,{mode:0o700}).catch(()=>{});
            await syncDirectory().catch(()=>{});
            throw Error('API_BUDGET_LOCK_RELEASE_UNVERIFIED');
          }
        }
      }finally{busy=false;}
    }
  };
  return beforeRequest;
}
