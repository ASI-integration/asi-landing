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
import {createBegetNativeRequestAdmission} from './beget-native-request-admission.mjs';
import {createResponsesSourceReviewer,createBoundPublishedModelReview} from './beget-native-source-review.mjs';
import {runNativeSourceChecks} from './beget-native-source-checks.mjs';
import {createResponsesCodeProducer} from '../source-responses-provider.mjs';
import {createPinnedSourceReader} from '../source-git-context.mjs';
// Source candidate composition is imported into the REAL host runtime closure.
 // The active two-witness policy cannot invoke it or grant publication; adoption
 // needs a genuinely signed five-lane catalog and native publisher authority.
import {prepareNativeFiveLaneSource} from './beget-native-five-lane-source.mjs';
export {prepareNativeFiveLaneSource};
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
  const {loadBegetAuthority,BEGET,rootOwned,AUTHORITY_DIR}=await import('./host-authority.mjs');
  const original=JSON.parse(await rootOwned(AUTHORITY_DIR+'/activation.json'));
  // The untrusted schema is only a selector; every V2 field is independently
  // authenticated with the root-owned owner key before it can be used.
  let selected;
  try{selected=JSON.parse(original.payload).schema;}catch{
    throw Error('BEGET_SIGNED_RUNTIME_SCHEMA');
  }
  if(selected==='asi.engine-beget-five-lane-activation.v1')
    return createBegetFiveLaneRuntime();
  must(selected==='asi.engine-beget-activation.v1','BEGET_SIGNED_RUNTIME_SCHEMA');
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

/** Same-ledger, single-lock model reservation. A network timeout consumes a
 * claim forever; no second model request with the same task/input fingerprint.
 * Only an independently owner-signed v2 payload can provide model limits.
 */
export async function reserveNativeModelRequest({store,ledger,transaction,payload,
  revalidate,request}={}){
  const {inspectStandingTransaction}=await import('./state.mjs');
  const {randomUUID}=await import('node:crypto');
  must(payload?.schema==='asi.engine-beget-five-lane-activation.v1'&&
    typeof revalidate==='function','NATIVE_MODEL_SIGNED_POLICY_REQUIRED');
  const lease=inspectStandingTransaction(transaction);
  const generation=request?.model===payload.model.name;
  const review=request?.model===payload.model.reviewName;
  must((generation&&lease.phase==='admission'||
    review&&lease.phase==='started'&&lease.taskId===request?.taskId)&&
    lease.kind==='github-publisher'&&
    lease.root===store?.root&&lease.ledger===ledger&&
    ledger.mode==='FAILED_LOCKED'&&ledger.reason==='IN_FLIGHT_OR_CRASHED',
    'NATIVE_MODEL_EXECUTION_LOCK');
  const m=payload.model,taskId=request?.taskId,baseSha=request?.baseSha;
  must(typeof taskId==='string'&&/^[a-z0-9-]{1,80}$/.test(taskId)&&
    baseSha===payload.baseSha&&(generation||review)&&
    request.maxOutputTokens===m.maxOutputTokens&&
    /^[a-f0-9]{64}$/.test(request.pathDigest),
    'NATIVE_MODEL_TASK_OR_SCOPE');
  must(await revalidate()===true,'NATIVE_MODEL_AUTHORITY_CHANGED');
  const policySha256=digest(JSON.stringify({model:m,sourceSha:payload.baseSha,
    repo:payload.repo,activation:payload.runtimeManifestSha256}));
  const descriptor=Object.getOwnPropertyDescriptor(ledger,'modelReservationBudget');
  must(descriptor?Object.hasOwn(descriptor,'value')&&descriptor.value!==null:
    !('modelReservationBudget' in ledger),'NATIVE_MODEL_BUDGET_HISTORY');
  const old=descriptor?.value??null;
  must(old===null||old?.version===1&&old.policySha256===policySha256&&
    Number.isSafeInteger(old.spentMicrousd)&&old.spentMicrousd>=0&&
    Array.isArray(old.claims)&&old.claims.length<=m.maxCalls&&
    old.claims.every(c=>typeof c.taskId==='string'&&
      /^[a-f0-9]{64}$/.test(c.pathDigest)&&
      c.baseSha===payload.baseSha&&
      [m.name,m.reviewName].includes(c.model)&&
      typeof c.operationId==='string'&&
      /^model-[a-f0-9-]{36}$/.test(c.operationId)&&
      Number.isSafeInteger(c.microusd)&&
      c.microusd===m.reserveMicrousdPerCall)&&
    old.spentMicrousd===old.claims.reduce((n,c)=>n+c.microusd,0)&&
    new Set(old.claims.map(c=>c.operationId)).size===old.claims.length&&
    new Set(old.claims.map(c=>c.taskId+':'+c.model+':'+c.pathDigest)).size===
      old.claims.length,
    'NATIVE_MODEL_BUDGET_HISTORY');
  const claims=old?.claims??[];
  must(!claims.some(c=>c.taskId===taskId&&c.model===request.model&&
      c.pathDigest===request.pathDigest)&&
    claims.length<m.maxCalls&&
    (old?.spentMicrousd??0)+m.reserveMicrousdPerCall<=m.maxPaidMicrousd,
    'NATIVE_MODEL_BUDGET_EXHAUSTED_OR_REPLAY');
  const operationId='model-'+randomUUID();
  const next={version:1,policySha256,
    spentMicrousd:(old?.spentMicrousd??0)+m.reserveMicrousdPerCall,
    claims:[...claims,{taskId,pathDigest:request.pathDigest,baseSha,
      model:request.model,microusd:m.reserveMicrousdPerCall,operationId}]};
  must(await revalidate()===true,'NATIVE_MODEL_AUTHORITY_CHANGED');
  const again=inspectStandingTransaction(transaction);
  must(again.transactionId===lease.transactionId&&again.phase===lease.phase&&
    again.ledger===ledger,'NATIVE_MODEL_TRANSACTION_CHANGED');
  await atomicJson(store.file('autopilot-ledger.json'),
    {...ledger,modelReservationBudget:next});
  ledger.modelReservationBudget=next;
  must((await revalidate())===true&&
    inspectStandingTransaction(transaction).transactionId===lease.transactionId,
    'NATIVE_MODEL_POST_RESERVATION_UNCERTAIN');
  return Object.freeze({authorized:true,taskId,baseSha,model:request.model,
    maxOutputTokens:m.maxOutputTokens,pathDigest:request.pathDigest,
    operationId});
}


/** V2 runs only when the original owner's signed activation explicitly switches
 * the SAME installed service to five-lane mode. Legacy activation remains v1.
 * No user text, environment variable or unsigned manifest toggles this path.
 */
// Source-shape check only. Protected signature and exact runtime hashes are
// enforced separately by the native root-owned loader before every use.
export function isBegetV2RuntimeManifest(m){
  return m?.schema==='asi.beget-engine-source.v1'&&
    ['REVIEWED_PROTECTED_ACTIVE_RUNTIME_V1',
      'OWNER_SIGNED_TECHNICAL_ACCEPTANCE_V1'].includes(m.nativeFiveLaneWiring)&&
    m.installable===false&&Array.isArray(m.files)&&m.files.length>=30&&
    ['unitSha256','nodeSha256','bwrapSha256','catalogSha256'].every(k=>
      typeof m[k]==='string'&&/^[a-f0-9]{64}$/.test(m[k]));
}
export async function createBegetFiveLaneRuntime(){
  const {loadBegetFiveLaneAuthority,BEGET,rootOwned,AUTHORITY_DIR}=
    await import('./host-authority.mjs');
  const {createNativeFiveLanePublicationLoop}=await import('./publication-loop.mjs');
  const {verifyPreparedDelta}=await import('./change-preparer.mjs');
  const {execFile:execSource}=await import('node:child_process');
  const {promisify:promisifySource}=await import('node:util');
  const authority=await loadBegetFiveLaneAuthority(),{payload,catalog}=authority;
  must(os.hostname()===BEGET.host&&os.userInfo().username===BEGET.user,
    'NATIVE_FIVE_LANE_HOST_IDENTITY');
  const raw=await rootOwned(BEGET.runtime+'/manifest.json');
  must(digest(raw)===payload.runtimeManifestSha256,
    'NATIVE_FIVE_LANE_MANIFEST_CHANGED');
  const m=JSON.parse(raw);
  // The updater requires installable:false because its independent signed
  // active-upgrade grant, not the source-package flag, controls execution.
  must(isBegetV2RuntimeManifest(m),
    'NATIVE_FIVE_LANE_REVIEWED_RUNTIME_REQUIRED');
  for(const f of m.files){
    must(/^scripts\/[A-Za-z0-9_./-]+\.mjs$/.test(f.path)&&
      !f.path.includes('..')&&/^[a-f0-9]{64}$/.test(f.sha256)&&
      digest(await rootOwned(BEGET.runtime+'/'+f.path))===f.sha256,
      'NATIVE_FIVE_LANE_RUNTIME_FILE_CHANGED');
  }
  must(digest(await rootOwned('/etc/systemd/system/'+BEGET.service))===
    m.unitSha256&&
    process.execPath===BEGET.runtime+'/node'&&
    digest(await rootOwned(BEGET.runtime+'/node',150000000,{encoding:null}))===
      m.nodeSha256&&
    digest(await rootOwned(BEGET.runtime+'/bwrap',2000000,{encoding:null}))===
      m.bwrapSha256,
    'NATIVE_FIVE_LANE_UNIT_OR_BINARY_CHANGED');
  // Secret is read only by the signed service identity; never log or export.
  const apiKey=String(await rootOwned(AUTHORITY_DIR+'/openai-api-key',20000,
    {secret:true})).trim();
  must(apiKey.length>=16,'NATIVE_FIVE_LANE_MODEL_SECRET_ABSENT');
  const app=createAppTokenProvider(payload.githubApp,{beforeRequest:async()=>{
    await authority.revalidate();await authority.fencingWitness();
  }});
  const makeTransactionPorts=async({store,ledger,transaction,catalog:signedCatalog})=>{
    must(digest(JSON.stringify(signedCatalog))===authority.catalogDigest,
      'NATIVE_FIVE_LANE_CATALOG_CHANGED');
    const requestAdmission=createBegetNativeRequestAdmission({
      store,ledger,transaction,authority});
    const beforeRequest=async()=>{
      await authority.revalidate();await authority.fencingWitness();
    };
    const reader=createGitHubReader({token:app.token,
      requestAdmission,beforeRequest});
    const remote=createPublisherTransport({token:app.token,
      requestAdmission,beforeRequest});
    let nativeTask=null;
    const getContext=async({id,baseSha,paths})=>{
      const get=createPinnedSourceReader({
        checkout:path.join(store.root,'scratchpads',id),
        admittedTasks:signedCatalog});
      return get({id,baseSha,paths});
    };
    const produce=createResponsesCodeProducer({
      model:payload.model.name,apiKey,
      maxOutputTokens:payload.model.maxOutputTokens,
      getContext,
      admitRequest:request=>reserveNativeModelRequest({
        store,ledger,transaction,payload,
        revalidate:authority.revalidate,request})
    });
    const reviewSource=createResponsesSourceReviewer({
      model:payload.model.reviewName,generatorModel:payload.model.name,
      apiKey,maxOutputTokens:payload.model.maxOutputTokens,
      admitRequest:request=>reserveNativeModelRequest({
        store,ledger,transaction,payload,
        revalidate:authority.revalidate,request}),
      async getPreparedDiff(e){
        must(nativeTask?.id===e.taskId&&nativeTask.sha===e.baseSha,
          'NATIVE_REVIEW_TASK_UNBOUND');
        await verifyPreparedDelta(store,nativeTask,e.deltaSha256);
        const cwd=path.join(store.root,'scratchpads',e.taskId);
        const {stdout}=await promisifySource(execSource)('/usr/bin/git',
          ['-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false',
          'diff','--no-ext-diff','--no-textconv','--',
          ...nativeTask.changes.map(c=>c.path)],{
          cwd,timeout:10000,maxBuffer:150000,
          env:{PATH:'/usr/bin:/bin',GIT_CONFIG_NOSYSTEM:'1',
            GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0'}
        });
        await verifyPreparedDelta(store,nativeTask,e.deltaSha256);
        return stdout;
      }
    });
    return Object.freeze({reader,remote,produce,
      revalidate:authority.revalidate,
      bindTask(task){must(nativeTask===null&&task&&
        signedCatalog.some(t=>t.id===task.id&&t.baseSha===task.sha),
        'NATIVE_FIVE_LANE_TASK_BINDING');nativeTask=task;return true;},
      async runChecks(e,{signal}={}){
        must(nativeTask?.id===e.taskId&&nativeTask.sha===e.baseSha,
          'NATIVE_FIVE_LANE_CHECK_SCOPE');
        await verifyPreparedDelta(store,nativeTask,e.deltaSha256);
        // Unlike synthetic source-package tests, the native Publisher must
        // actually execute the admitted test file in a no-network bwrap
        // namespace, or schema-check a fixed signed RU fixture.
        must(digest(await rootOwned('/usr/bin/bwrap',2000000,{encoding:null}))===
          m.bwrapSha256,'NATIVE_BWRAP_APPARMOR_BINARY_CHANGED');
        const checks=await runNativeSourceChecks({
          task:nativeTask,workspace:path.join(store.root,'scratchpads',e.taskId),
          nodeExecutable:BEGET.runtime+'/node',signal
        });
        await verifyPreparedDelta(store,nativeTask,e.deltaSha256);
        must(checks.status==='PASS'&&checks.isolated===true&&
          checks.networkDisabled===true,'NATIVE_LOCAL_CHECK_NOT_PROVEN');
        return {...e,status:'PASS'};
      },
      independentReview:reviewSource,
      publishedReview:createBoundPublishedModelReview({
        policySha256:payload.reviewsSha256,
        model:payload.model.reviewName,reviewSource,
        getBoundTask:()=>nativeTask,revalidate:authority.revalidate
      })
    });
  };
  const loop=await createNativeFiveLanePublicationLoop({
    authority,makeTransactionPorts});
  return Object.freeze({async iteration(){
    await authority.revalidate();return loop.poll({execute:true});
  }});
}
