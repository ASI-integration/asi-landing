// Isolated protocol fixtures only. Synthetic v0 host grant is explicit; no live authority.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {generateKeyPairSync,sign,createHash} from 'node:crypto';
import {fixture,makeLoop,target} from './publisher-fixture.mjs';
import {bindTask,inspectPublisherLifecycleEvidence} from './github-publisher.mjs';
import {inspectStandingTransaction} from './state.mjs';
import {createPublisherTransport} from './publisher-transport.mjs';
import {createGitHubReader} from './github-readonly.mjs';
import {createStandingRequestPreview,inspectStandingAdmissionReceipt} from './standing-request-guard.mjs';
import {ENVELOPE_SECURITY_REQUIRED,inspectProtectedRepositorySecurity,checkPr,main} from '../../agent-os/check-demo-release.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
const key=()=>{const pair=generateKeyPairSync('ed25519');return {...pair,pem:pair.publicKey.export({type:'spki',format:'pem'}),digest:hash(pair.publicKey.export({type:'spki',format:'der'}))};};
const signed=(value,k)=>{const payload=JSON.stringify(value);return {payload,signature:sign(null,Buffer.from(payload),k.privateKey).toString('base64')};};
const descriptor=(method='GET',route='branches/main')=>{const payloadSha256=hash(method==='GET'?'':'{}');return {method,route,payloadSha256,requestSha256:hash(JSON.stringify({method,route,payloadSha256}))};};
async function setup(t,{adoptionMode=null,wrongLocal=false,forgedLocal=false,lateRevocation=false,rollbackRevocation=false,pendingCI=true,sourcePending=false,resumeSame=false,gateMode=null,skipLocal=false,wrongReviewer=false,gateBudget=false,gateFailure=false,lateGateClock=Infinity}={}){
 const compiled=adoptionMode?.startsWith('compiled'),gitTrust=adoptionMode?.startsWith('git-trust');
 const now={value:1000000},owner=key(),verifier=key();
 const manifest={schema:'asi.release-envelope-revocations.v1',repository:'ASI-integration/asi-landing',environment:'beget-staging',target:'pqukibofpo',issuerKeySha256:owner.digest,verifierKeySha256:verifier.digest,sequence:1,issuedAt:now.value-1000,expiresAt:adoptionMode==='consume-expiry'?now.value+1000:now.value+600000,revokedEnvelopeDigests:[]};
 const revocation=signed(manifest,owner),prior={sequence:1,manifestDigest:hash(revocation.payload),revokedEnvelopeDigests:[]};
 const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
 const seedFiles=Object.fromEntries(ENVELOPE_SECURITY_REQUIRED.map(p=>[p,'inert protected '+p+'\n']));
 // Fixture-only: reproduce the pinned NORMAL owner baseline and audited bootstrap source.
 seedFiles['docs/agent-os/owner-security-baseline.json']=await fs.readFile(new URL('../../../docs/agent-os/owner-security-baseline.json',import.meta.url),'utf8');
 seedFiles['scripts/strigunov4/execution-adapters/beget-install.py']=await fs.readFile(new URL('./beget-install.py',import.meta.url),'utf8');
 if((gitTrust||compiled)&&adoptionMode!=='compiled-missing-registry'){
  const registry={schema:'asi.standing-trust-registry.v1',repository:manifest.repository,environment:manifest.environment,target:manifest.target,issuerKeySha256:owner.digest,verifierKeySha256:verifier.digest,minRevocationSequence:1,minRevocationManifestDigest:prior.manifestDigest,priorRevokedEnvelopeDigests:[]};
  for(const [name,content] of Object.entries({'registry.json':JSON.stringify(registry),'owner-public.pem':owner.pem,'standing-verifier-public.pem':verifier.pem,'standing-revocations.json':JSON.stringify(revocation)}))seedFiles['docs/agent-os/standing-trust/'+name]=content;
 }
 let release;
 if(adoptionMode){
  release=JSON.parse(await fs.readFile(new URL('../../../docs/agent-os/releases/strigunov4-demo.json',import.meta.url),'utf8'));
  release.stages.forEach((s,i)=>{s.status=i?'NOT_STARTED':'IN_PROGRESS';s.proof=[];delete s.acceptanceSha;s.files=['scripts/strigunov4/fixture_stage_'+i+'_a.py','scripts/strigunov4/fixture_stage_'+i+'_b.py'];s.plannedFiles=[];});
  if(compiled){release.stages[0].status='ACCEPTED';release.stages[0].acceptanceSha='a'.repeat(40);release.stages[0].proof=['https://github.com/ASI-integration/asi-landing/actions/runs/777'];release.stages[1].status='IN_PROGRESS';release.stages[1].files.push(target);}
  release.stages[0].plannedFiles=release.stages[0].plannedFiles.filter(p=>p!==target);release.stages[0].files.push(target);
  for(const s of release.stages)for(const p of s.files)if(!Object.hasOwn(seedFiles,p))seedFiles[p]='inert fixture\n';
  seedFiles['docs/agent-os/releases/strigunov4-demo.json']=JSON.stringify(release);
 }
 const f=await fixture(t,{realGitObjects:true,ci:pendingCI?'pending':'success',seedFiles});
 const source={pending:sourcePending},comparison={repository:'ASI-integration/asi-landing',repoRoot:path.join(f.base,'seed'),baseSha:f.sha,headSha:f.sha};
 const security=inspectProtectedRepositorySecurity(comparison);assert.equal(security.status,'PROTECTED_SECURITY_VERIFIED');
 const envelope={schema:'asi.release-envelope.proposal.v1',repo:comparison.repository,environment:'beget-staging',target:'pqukibofpo',appId:5514822,installationId:176281163,policyDigest:security.policyDigest,securityDigest:security.securityDigest,notBefore:now.value-1000,expiresAt:now.value+600000,action:'source',allowedPaths:[target],maxOperations:256,maxRequests:gateBudget||256,maxWrites:8,paidApiUsd:0,verifierKeySha256:verifier.digest};
 const signedEnvelope=signed(envelope,owner),envelopeDigest=hash(signedEnvelope.payload);
 const adoption={schema:'asi.standing-adoption.v1',ownerId:207600140,mode:'ROUTINE_SOURCE_ADMISSION_ONLY',repo:envelope.repo,environment:envelope.environment,target:envelope.target,envelopeDigest,securityDigest:security.securityDigest,policyDigest:security.policyDigest,appId:envelope.appId,installationId:envelope.installationId,issuerKeySha256:owner.digest,verifierKeySha256:verifier.digest,notBefore:envelope.notBefore,expiresAt:envelope.expiresAt};
 if(adoptionMode==='identity')adoption.appId++;
 if(adoptionMode==='target')adoption.target='other';
 if(adoptionMode==='security')adoption.securityDigest='a'.repeat(64);
 if(adoptionMode==='expired')adoption.expiresAt=now.value-1;
 const releaseReads=[];
 const adoptionSigned=signed(adoption,adoptionMode==='signer'?verifier:owner),admissions=[];
 let revoked=false,selected=0,newRevocation=false;const records=[],phases=[],previews=[],providerCalls=[],gateResults=[],gateCalls=[],gateClockCounts=[],gateEvents=[];let gateActive=false,gateClockCount=0;
 let adoptionReads=0;
 const adoptionBytes=()=>{if(++adoptionReads===2&&adoptionMode==='late-expiry')now.value=envelope.expiresAt+1;return JSON.stringify(adoptionSigned);};
 const protectedReader=async p=>p.endsWith('standing-adoption.json')?adoptionBytes():p.endsWith('owner-public.pem')?owner.pem:p.endsWith('standing-verifier-public.pem')?verifier.pem:
  JSON.stringify(revoked?signed({...manifest,sequence:2,revokedEnvelopeDigests:[envelopeDigest]},owner):newRevocation?signed({...manifest,sequence:2},owner):revocation);
 const expectedTrust={repository:envelope.repo,environment:envelope.environment,target:envelope.target,issuerKeySha256:owner.digest,verifierKeySha256:verifier.digest,envelopeDigest};
 const deltas=[];
 for(const task of f.catalog){
  const file=path.join(comparison.repoRoot,target);await fs.writeFile(file,task.changes[0].content);
  const diff=execFileSync('git',['diff','--no-ext-diff','--no-textconv','--',target],{cwd:comparison.repoRoot,encoding:'utf8'});
  deltas.push(hash(diff));await fs.writeFile(file,'VALUE = 1\n');
 }
 const loop=await makeLoop(f,{now,timeoutMs:gateMode==='timeout'?300:10000,transactionPorts:async({store,transaction})=>{
  const task=f.catalog[resumeSame?0:selected],artifactDigest=deltas[resumeSame?0:selected++];
  const lease=inspectStandingTransaction(transaction);if(!lease.ledger.standingRevocationCheckpoint)lease.ledger.standingRevocationCheckpoint=prior;
  const request={action:'source',repo:envelope.repo,environment:envelope.environment,target:envelope.target,appId:envelope.appId,installationId:envelope.installationId,securityDigest:envelope.securityDigest,changedPaths:[target],headSha:null,baseSha:f.sha,artifactDigest,taskId:task.id,taskBinding:bindTask(task),branch:task.branch};
  const witness=(phase,event)=>({schema:'asi.release-envelope-publisher-evidence.proposal.v1',phase,envelopeDigest,policyDigest:envelope.policyDigest,revocation:'NOT_REVOKED',observedAt:now.value,baseSha:f.sha,headSha:event?.headSha??null,artifactDigest,changedPaths:[target],taskId:task.id,taskBinding:request.taskBinding,branch:request.branch,ci:phase==='EXACT_HEAD_VERIFIED'?'SUCCESS':null,independentReview:phase==='EXACT_HEAD_VERIFIED'?'PASS':null,branchProtection:'PASS',usedOperations:0,paidApiUsd:0,claim:'UNCLAIMED',externalResult:'NONE',...(phase==='LOCAL_DELTA_VERIFIED'?{localChecks:'PASS',independentDeltaReview:'PASS',reviewEvidenceId:event.reviewEvidenceId}:{})});
  const preview=createStandingRequestPreview({store,transaction,signedEnvelope,signedEvidence:signed(witness('ADMISSION_READ'),verifier),request,comparison,providerExpected:{independentReviewerId:1234},expectedTrust,admissionBaseSha:f.sha,clock:()=>{if(gateActive&&++gateClockCount===lateGateClock)now.value=envelope.expiresAt+1;return now.value;},protectedReader,isolatedPreview:true,publisherPhases:true,expectedAdoptionDigest:adoptionMode==='missing'?null:adoptionMode==='pin'?'a'.repeat(64):hash(adoptionSigned.payload)});previews.push(preview);
  // TEST ONLY: this wrapper executes loopback fixture effects under makeLoop's
  // explicit synthetic v0 grant. Production preview.beforeRequest always refuses.
  const runGate=async event=>{
    gateEvents.push(event);
    if(gateMode==='timeout'){await new Promise(r=>setTimeout(r,1500));assert.throws(()=>inspectPublisherLifecycleEvidence(event,transaction),/UNTRUSTED/);gateClockCounts.push(-1);return {status:'BLOCKED'};}
    const expected={repository:envelope.repo,number:event.pr,baseSha:f.sha,headSha:event.headSha,independentReviewerId:wrongReviewer?1235:1234};
    const bound={number:event.pr,head:{sha:event.headSha},base:{sha:f.sha}};
    const snapshot={pr:{...f.pulls.get(event.pr),user:{id:4567}},runs:[{workflow_id:311380800,event:'pull_request',head_sha:event.headSha},{workflow_id:390653294,event:'pull_request_target',head_sha:f.sha}].map((r,i)=>({...r,id:100+i,run_attempt:1,repository:{full_name:envelope.repo},pull_requests:[bound],status:'completed',conclusion:'success',updated_at:new Date(now.value).toISOString()})),reviews:[{id:9,user:{id:1234},state:'APPROVED',commit_id:event.headSha,submitted_at:new Date(now.value).toISOString()}]};
    const workflowPaths=['.github/workflows/pr-validation.yml','.github/workflows/asi-release-governance.yml'];
    const contents=await Promise.all(workflowPaths.map(p=>fs.readFile(path.join(comparison.repoRoot,p))));
    const blobs=contents.map(b=>createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex'));
    const trustedGateContext={schema:'asi.protected-gate-split.proposal.v1',repository:envelope.repo,
      number:event.pr,baseSha:f.sha,headSha:event.headSha,evaluatorRunId:101,evaluatorRunAttempt:1,
      sourceWorkflowBlobSha:blobs[0],evaluatorWorkflowBlobSha:blobs[1]};
    const gateWitness={schema:'asi.release-envelope-gate-evidence.proposal.v1',phase:'PRE_GATE',
      envelopeDigest,policyDigest:envelope.policyDigest,revocation:'NOT_REVOKED',observedAt:now.value,
      baseSha:f.sha,headSha:event.headSha,artifactDigest,changedPaths:[target],taskId:task.id,
      ci:'SOURCE_SUCCESS',independentReview:'PASS',branchProtection:'PASS',usedOperations:0,
      paidApiUsd:0,claim:'UNCLAIMED',externalResult:'NONE',gateBinding:{...trustedGateContext,
        sourceRunId:100,sourceRunAttempt:1,independentReviewerId:1234,reviewId:9}};
    snapshot.runs.forEach((r,i)=>{r.path=workflowPaths[i];r.status='in_progress';r.conclusion=null;});
    const jobs=['source_validation','channel-manager-recovery-postgres','validate'].map((name,i)=>({
      id:201+i,name,run_id:100,head_sha:event.headSha,status:i===2?'in_progress':'completed',
      conclusion:i===2?null:'success',completed_at:i===2?null:new Date(now.value).toISOString()}));
    if(source.pending){jobs[0].status='in_progress';jobs[0].conclusion=null;jobs[0].completed_at=null;}
    gateActive=true;
    const gate=await preview.readGateProposal({token:'INERT_GATE_FIXTURE',expected,trustedGateContext,
      publisherEvidence:gateMode==='forged'?{...event}:event,signedEvidence:signed(gateWitness,verifier),fetchImpl:async url=>{
        const disk=JSON.parse(await fs.readFile(store.file('autopilot-ledger.json'),'utf8'));
        gateCalls.push({url,requests:Object.values(disk.standingDelegationBudget.envelopes)[0].requests});
        assert.equal((await preview.reserve(descriptor())).status,'BLOCKED');
        if(gateFailure)throw Error('inert unknown provider outcome');
        const u=new URL(url),p=u.pathname;let value;
        if(p.includes('/contents/')){const i=p.endsWith('pr-validation.yml')?0:1;value={type:'file',path:workflowPaths[i],sha:blobs[i],encoding:'base64',content:contents[i].toString('base64')};}
        else if(p.includes('/workflows/')){value={total_count:1,workflow_runs:snapshot.runs.filter(r=>p.includes(String(r.workflow_id)))};}
        else if(p.endsWith('/jobs'))value={total_count:jobs.length,jobs};
        else if(p.endsWith('/runs/101'))value=snapshot.runs[1];
        else if(p.endsWith('/reviews'))value=snapshot.reviews;
        else value=snapshot.pr;
        return new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
      }});
    gateActive=false;gateClockCounts.push(gateClockCount);gateResults.push(gate);
    if(gitTrust){
      const priorFetch=globalThis.fetch;let reads=0;
      globalThis.fetch=async url=>{
        assert.equal(new URL(url).pathname,'/repos/ASI-integration/asi-landing/branches/main');
        const disk=JSON.parse(await fs.readFile(store.file('autopilot-ledger.json'),'utf8'));
        releaseReads.push({route:'branches/main',requests:Object.values(disk.standingDelegationBudget.envelopes)[0].requests});
        assert.equal((await preview.reserve(descriptor())).status,'BLOCKED');
        if(adoptionMode==='git-trust-unknown')throw Error('inert unknown');
        const sha=++reads===2&&adoptionMode==='git-trust-moved'?'f'.repeat(40):f.sha;
        return new Response(JSON.stringify({name:'main',protected:adoptionMode!=='git-trust-unprotected',commit:{sha}}),{headers:{'Content-Type':'application/json'}});
      };
      // Git object bytes, never this tampered local registry, supply trust.
      const registryFile=path.join(comparison.repoRoot,'docs/agent-os/standing-trust/registry.json');
      const before=await fs.readFile(registryFile);await fs.writeFile(registryFile,'{}');
      try{admissions.push({result:await preview.readProtectedGitTrust(gate,{token:'INERT_GIT_TRUST'})});}
      finally{globalThis.fetch=priorFetch;await fs.writeFile(registryFile,before);}
    }else if(compiled){
      const pr=f.pulls.get(event.pr);pr.body='Release-Stage: S4-G2\nRelease-Mode: diagnostic\nRelease-Diagnostic-Iteration: 1';
      if(adoptionMode==='compiled-outscope')pr.body='Release-Stage: S4-G6\nRelease-Mode: implementation';
      const priorFetch=globalThis.fetch;let prReads=0,mainReads=0;
      globalThis.fetch=async(url,init)=>{
        const u=new URL(url),route=u.pathname.split('/asi-landing/')[1];
        const disk=JSON.parse(await fs.readFile(store.file('autopilot-ledger.json'),'utf8'));
        releaseReads.push({route,requests:Object.values(disk.standingDelegationBudget.envelopes)[0].requests});
        assert.equal((await preview.reserve(descriptor())).status,'BLOCKED');
        let value;
        if(route==='branches/main')value={name:'main',protected:true,commit:{sha:++mainReads===3&&adoptionMode==='compiled-final-base-change'?'f'.repeat(40):f.sha}};
        else if(route===`pulls/${event.pr}`){
          if(++prReads===2&&adoptionMode==='compiled-pr-change')pr.body+='\nchanged';
          value=pr;
        }else if(route==='actions/runs/777')value={repository:{full_name:envelope.repo},status:'completed',conclusion:adoptionMode==='compiled-run-fail'?'failure':'success',head_sha:'a'.repeat(40),head_branch:'main',path:'.github/workflows/strigunov4-c4-unit-apply.yml',event:'workflow_dispatch',run_attempt:1};
        else if(route==='actions/runs/777/approvals')value=[{user:{id:207600140},state:'approved',environments:[{name:'staging',can_admins_bypass:false}]}];
        else if(route==='actions/runs/777/jobs')value={total_count:1,jobs:[{name:'protected_c4_unit_apply',status:'completed',conclusion:'success'}]};
        else if(route==='pulls'||route.startsWith('issues/'))value=[];
        else throw Error('UNEXPECTED_RELEASE_READ');
        if(adoptionMode==='compiled-unknown'&&route.endsWith('/approvals'))throw Error('inert unknown');
        if(adoptionMode==='compiled-revocation'&&prReads===2)revoked=true;
        return new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
      };
      // The working copy must not supply the protected contract to this caller.
      const contractPath=path.join(comparison.repoRoot,'docs/agent-os/releases/strigunov4-demo.json');
      const before=await fs.readFile(contractPath);await fs.writeFile(contractPath,'{}');
      let result;
      try{result=await preview.runAdoptedReleaseAdmission(gate,{token:'INERT_COMPILED_RELEASE'});}
      finally{globalThis.fetch=priorFetch;await fs.writeFile(contractPath,before);}
      admissions.push({result,ledgerAtAdmission:JSON.parse(await fs.readFile(store.file('autopilot-ledger.json'),'utf8'))});
    }else if(adoptionMode){
      const admission=await preview.readAdoptedSourceAdmission(adoptionMode==='copied'?{...gate}:gate);
      const contract=release;
      const args={contract,changed:[target],prNumber:event.pr,headSha:event.headSha,baseSha:f.sha,prBody:'Release-Stage: S4-G1\nRelease-Mode: implementation',baseHasContract:true,standingAdmission:admission};
      if(adoptionMode==='consume-expiry')now.value+=2000;
      if(adoptionMode==='consume-freshness-boundary')now.value+=60000;
      let status;try{status=checkPr(args).status;}catch(e){status=e.message;}
      let mainStatus;
      const env={GITHUB_EVENT_NAME:process.env.GITHUB_EVENT_NAME,GITHUB_EVENT_PATH:process.env.GITHUB_EVENT_PATH};
      const eventPath=path.join(f.base,'admission-event.json');
      await fs.writeFile(eventPath,JSON.stringify({repository:{full_name:envelope.repo},number:event.pr,pull_request:{number:event.pr,body:args.prBody,base:{ref:'main',sha:f.sha},head:{sha:event.headSha,repo:{full_name:envelope.repo}}}}));
      process.env.GITHUB_EVENT_NAME='pull_request_target';process.env.GITHUB_EVENT_PATH=eventPath;
      try{mainStatus=(await main({ci:true,repoRoot:comparison.repoRoot,standingAdmission:admission})).status;}catch(e){mainStatus=e.message;}
      finally{for(const [k,v] of Object.entries(env)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
      admissions.push({admission,args,status,mainStatus});
    }
    if(gateMode==='remote-change')f.pulls.get(event.pr).head.sha='f'.repeat(40);
    return gate; // Proposal only; final CI remains pending.
  };
  const requestAdmission=async d=>{const r=await preview.reserve(d);records.push({phase:inspectStandingTransaction(transaction).phase,method:d.method,route:d.route,result:r});
   return r.status==='RESERVED_PREVIEW';};
  const reader=createGitHubReader({token:'INERT_FIXTURE_ONLY',timeoutMs:10000,requestAdmission}),remote=createPublisherTransport({token:'INERT_FIXTURE_ONLY',timeoutMs:10000,requestAdmission});
  let snapshots=0;
  return {remote,reader,inspectGate:runGate,fetchSnapshot:async()=>{if(snapshots++===0)await reader.get('branches/main');return structuredClone(f.snapshot);},observeLifecycle:async event=>{
   if(skipLocal&&event.phase==='LOCAL_DELTA_VERIFIED')return true;
   if(adoptionMode==='two-head'&&event.phase==='EXACT_HEAD_VERIFIED')return true;
   assert.notEqual(event.phase,'EXACT_HEAD_VERIFIED','PRE_GATE must not await final CI evidence');
   const value=witness(event.phase,event);if(wrongLocal&&event.phase==='LOCAL_DELTA_VERIFIED')value.taskBinding='a'.repeat(64);
   if(lateRevocation&&event.phase==='LOCAL_DELTA_VERIFIED')revoked=true;
   if(rollbackRevocation&&event.phase==='LOCAL_DELTA_VERIFIED')newRevocation=true;
   const result=await preview.observeLifecycle(forgedLocal&&event.phase==='LOCAL_DELTA_VERIFIED'?{...event}:event,{signedEvidence:signed(value,verifier)});
   phases.push(result);if(rollbackRevocation)newRevocation=false;return result.status==='PROPOSAL_ELIGIBLE';
  }};
 }});
 return {f,loop,now,source,records,phases,previews,providerCalls,gateResults,gateCalls,gateClockCounts,gateEvents,signedEnvelope,envelopeDigest,admissions,releaseReads};
}

// Synthetic provider and v0 fixture only; actual Publisher localPhase, native
// execute lock, Git objects and fsynced budgets. No network or live authority.
test('PRE_GATE fixed reads consume the same native Publisher budget, never final authority',async t=>{
 const x=await setup(t);await x.loop.poll({execute:true});
 assert.equal(x.gateResults.length,1);assert.equal(x.gateResults[0].status,'PROPOSAL_ELIGIBLE',JSON.stringify(x.gateResults));
 assert.equal(x.gateResults[0].phase,'PRE_GATE');assert.equal(x.gateResults[0].authorized,false);
 assert.equal(x.gateCalls.length,14);
 for(let i=1;i<x.gateCalls.length;i++)assert.equal(x.gateCalls[i].requests,x.gateCalls[i-1].requests+1);
 assert.equal(await x.previews[0].beforeRequest(),false);
 const ledger=JSON.parse(await fs.readFile(path.join(x.f.root,'state','autopilot-ledger.json'),'utf8'));
 assert(Object.values(ledger.standingDelegationBudget.envelopes)[0].requests>=x.gateCalls.at(-1).requests);
 assert.equal(x.phases.some(p=>p.phase==='EXACT_HEAD_VERIFIED'),false);
});
test('PRE_GATE identity mismatch blocks before provider fetch',async t=>{
 const x=await setup(t,{wrongReviewer:true});await x.loop.poll({execute:true});
 assert.equal(x.gateResults[0].status,'BLOCKED');assert.equal(x.gateCalls.length,0);
});
test('PRE_GATE unknown provider outcome retains charged read and poisons later requests',async t=>{
 const x=await setup(t,{gateFailure:true});await x.loop.poll({execute:true});
 assert.equal(x.gateResults[0].status,'BLOCKED');assert.equal(x.gateCalls.length,1);
 assert.equal((await x.previews[0].reserve(descriptor())).status,'BLOCKED');
 const ledger=JSON.parse(await fs.readFile(path.join(x.f.root,'state','autopilot-ledger.json'),'utf8'));
 assert.equal(Object.values(ledger.standingDelegationBudget.envelopes)[0].requests,x.gateCalls[0].requests);
});

test('PRE_GATE budget exhaustion stops reads at the existing durable cap',async t=>{
 const baseline=await setup(t);await baseline.loop.poll({execute:true});
 const cap=baseline.gateCalls[0].requests+2;
 const x=await setup(t,{gateBudget:cap});await x.loop.poll({execute:true});
 assert.equal(x.gateResults[0].status,'BLOCKED');assert(x.gateCalls.length>0&&x.gateCalls.length<13);
 const ledger=JSON.parse(await fs.readFile(path.join(x.f.root,'state','autopilot-ledger.json'),'utf8'));
 assert.equal(Object.values(ledger.standingDelegationBudget.envelopes)[0].requests,cap);
});
test('PRE_GATE expiry at final return preserves all charges and refuses eligibility',async t=>{
 const baseline=await setup(t);await baseline.loop.poll({execute:true});
 assert.equal(baseline.gateResults[0].status,'PROPOSAL_ELIGIBLE');
 const x=await setup(t,{lateGateClock:baseline.gateClockCounts[0]});await x.loop.poll({execute:true});
 assert.equal(x.gateResults[0].status,'BLOCKED');assert.equal(x.gateCalls.length,14);
 const ledger=JSON.parse(await fs.readFile(path.join(x.f.root,'state','autopilot-ledger.json'),'utf8'));
 assert(Object.values(ledger.standingDelegationBudget.envelopes)[0].requests>=x.gateCalls.at(-1).requests);
});


test('fixture checkout retains Git tree modes under private host umask',async t=>{
 const x=await setup(t,{resumeSame:true});
 const scratch=path.join(x.f.root,'scratchpads',x.f.catalog[0].id);
 for(const name of ['.coderabbit.yaml',target]){
   const st=await fs.lstat(path.join(scratch,name));
   const gitMode=execFileSync('/usr/bin/git',['ls-tree','HEAD','--',name],{cwd:scratch,encoding:'utf8'}).split(' ')[0];
   assert.equal(gitMode,'100644');
   assert.equal(st.mode&0o777,0o644,name);
 }
});
test('WAITING resume keeps rejecting altered tracked Git file modes',async t=>{
 const x=await setup(t,{resumeSame:true});
 assert.equal((await x.loop.poll({execute:true})).mode,'WAITING');
 const writes=[...x.f.writes],gateCount=x.gateCalls.length;
 const scratch=path.join(x.f.root,'scratchpads',x.f.catalog[0].id);
 const file=path.join(scratch,'.coderabbit.yaml');
 assert.equal((await fs.lstat(file)).mode&0o777,0o644);
 await fs.chmod(file,0o600);
 x.now.value+=180000;
 const result=await x.loop.poll({execute:true});
 assert.equal(result.mode,'FAILED_LOCKED');
 assert.deepEqual(x.f.writes,writes);
 assert.equal(x.gateCalls.length,gateCount);
});
test('native checkpoint resumes WAITING with fresh local proof and no publication replay',async t=>{
 const x=await setup(t,{resumeSame:true});
 assert.equal((await x.loop.poll({execute:true})).mode,'WAITING');
 const writes=[...x.f.writes],first=x.gateCalls.at(-1).requests;
 x.now.value+=180000;
 assert.equal((await x.loop.poll({execute:true})).mode,'WAITING');
 assert.deepEqual(x.f.writes,writes);assert.equal(x.gateResults.length,2);
 assert(x.gateCalls.at(-1).requests>first);
 assert.deepEqual(x.phases.map(p=>p.phase),['LOCAL_DELTA_VERIFIED','LOCAL_DELTA_VERIFIED']);
});
test('WAITING resume refuses changed scratch bytes without replay',async t=>{
 const x=await setup(t,{resumeSame:true});assert.equal((await x.loop.poll({execute:true})).mode,'WAITING');
 const writes=[...x.f.writes];await fs.writeFile(path.join(x.f.root,'scratchpads','fixture-a',target),'VALUE = 999\n');
 x.now.value+=180000;assert.equal((await x.loop.poll({execute:true})).mode,'FAILED_LOCKED');
 assert.deepEqual(x.f.writes,writes);assert.equal(x.gateResults.length,1);
});
test('forged native checkpoint denies before provider reads',async t=>{
 const x=await setup(t,{gateMode:'forged'});assert.equal((await x.loop.poll({execute:true})).mode,'FAILED_LOCKED');
 assert.equal(x.gateCalls.length,0);
});
test('remote HEAD change during gate cannot reach final CI or receipt',async t=>{
 const x=await setup(t,{gateMode:'remote-change'});assert.equal((await x.loop.poll({execute:true})).mode,'FAILED_LOCKED');
 assert.equal(x.gateResults[0].status,'PROPOSAL_ELIGIBLE');assert.equal(x.f.writes.length,4);
});

test('authenticated pending source preserves WAITING and resumes with no write replay',async t=>{
 const x=await setup(t,{resumeSame:true,sourcePending:true});
 assert.equal((await x.loop.poll({execute:true})).mode,'WAITING');
 assert.equal(x.gateResults[0].status,'WAITING',JSON.stringify(x.gateResults));
 const writes=[...x.f.writes],spent=x.gateCalls.at(-1).requests;
 x.source.pending=false;x.now.value+=180000;
 assert.equal((await x.loop.poll({execute:true})).mode,'WAITING');
 assert.equal(x.gateResults[1].status,'PROPOSAL_ELIGIBLE');
 assert.deepEqual(x.f.writes,writes);assert(x.gateCalls.at(-1).requests>spent);
});
test('timed-out gate revokes its native event before late continuation',async t=>{
 const x=await setup(t,{gateMode:'timeout'});assert.equal((await x.loop.poll({execute:true})).mode,'FAILED_LOCKED');
 await new Promise(r=>setTimeout(r,1600));assert.equal(x.gateCalls.length,0);assert.equal(x.gateEvents.length,1);assert.deepEqual(x.gateClockCounts,[-1]);
});

// Source-only signed adoption fixture. Production remains unconfigured/v0.
test('native signed admission is routine-only, noncopyable and expires with callback',async t=>{
 const x=await setup(t,{adoptionMode:'valid'});await x.loop.poll({execute:true});
 const a=x.admissions[0];assert.equal(a.status,'STANDING_SOURCE_ADMISSION_VERIFIED',JSON.stringify(a));
 assert.equal(a.mainStatus,'STANDING_SOURCE_ADMISSION_VERIFIED',JSON.stringify(a));
 assert.equal(a.admission.authorized,false);
 assert.throws(()=>checkPr({...a.args,standingAdmission:{...a.admission}}),/STANDING_ADMISSION_UNTRUSTED/);
 assert.throws(()=>checkPr(a.args),/PUBLICATION_EVIDENCE_UNTRUSTED/);
 assert.throws(()=>checkPr({...a.args,changed:['AGENTS.md']}),/GOVERNANCE_CHANGE_NEEDS_VERIFIED_OWNER_ATTESTATION/);
 assert.throws(()=>checkPr({...a.args,changed:['src/outside.ts']}),/PR_HAS_OUT_OF_STAGE_FILES/);
 const protectedPath='scripts/strigunov4/execution-adapters/example.mjs',contract=structuredClone(a.args.contract);contract.stages[0].files.push(protectedPath);
 assert.throws(()=>checkPr({...a.args,contract,changed:[protectedPath]}),/STANDING_PROTECTED_CHANGE/);
 assert.equal(checkPr({...a.args,standingAdmission:undefined}).status,'CURRENT_MILESTONE_SCOPED');
});
test('missing tampered expired signer or executor adoption blocks native admission',async t=>{
 for(const mode of ['missing','pin','expired','signer','identity','target','security','late-expiry','copied']){
  const x=await setup(t,{adoptionMode:mode});await x.loop.poll({execute:true});
  assert.equal(x.admissions[0].admission.status,'BLOCKED',mode);
 }
});

test('two native published HEADs reuse one pinned adoption without owner comments',async t=>{
 const x=await setup(t,{adoptionMode:'two-head',pendingCI:false});
 assert.equal((await x.loop.poll({execute:true})).mode,'REPORT_READY');
 x.now.value+=180000;x.f.state.ci='pending';
 const second=await x.loop.poll({execute:true});assert.equal(second.mode,'WAITING',JSON.stringify({second,admissions:x.admissions.map(a=>({status:a.status,main:a.mainStatus})),gates:x.gateResults}));
 assert.equal(x.admissions.length,2);
 assert(x.admissions.every(a=>a.status==='STANDING_SOURCE_ADMISSION_VERIFIED'&&a.mainStatus==='STANDING_SOURCE_ADMISSION_VERIFIED'));
 assert.notEqual(x.admissions[0].args.headSha,x.admissions[1].args.headSha);
});

test('native admission consumption refuses expired revocation and exact freshness boundary',async t=>{
 for(const mode of ['consume-expiry','consume-freshness-boundary']){
 const x=await setup(t,{adoptionMode:mode});await x.loop.poll({execute:true});
 assert.equal(x.admissions[0].admission.status,'STANDING_SOURCE_ADMISSION_VERIFIED');
 assert.equal(x.admissions[0].status,'STANDING_ADMISSION_STALE');
 assert.equal(x.admissions[0].mainStatus,'STANDING_ADMISSION_STALE');
 }
});


test('compiled native release caller meters accepted-stage and diagnostic reads before minting',async t=>{
 const x=await setup(t,{adoptionMode:'compiled'});await x.loop.poll({execute:true});
 assert.equal(x.admissions[0].result.status,'STANDING_SOURCE_ADMISSION_VERIFIED',JSON.stringify(x.admissions));
 assert.equal(x.admissions[0].result.authorized,false);
 assert.deepEqual(x.releaseReads.map(r=>r.route),['branches/main','branches/main','pulls/600','actions/runs/777','actions/runs/777/approvals','actions/runs/777/jobs','pulls','pulls/600','branches/main']);
 for(let i=1;i<x.releaseReads.length;i++)assert.equal(x.releaseReads[i].requests,x.releaseReads[i-1].requests+1);
 assert.equal(await x.previews[0].beforeRequest(),false);
 const input=x.admissions[0].result.signingInput;
 assert.equal(input.requiresIndependentSignature,true);assert.equal(input.authorized,false);
 assert.equal(hash(input.payload),input.payloadSha256);assert(Object.isFrozen(input));
 const claim=JSON.parse(input.payload),ledger=x.admissions[0].ledgerAtAdmission;
 assert.equal(claim.schema,'asi.standing-admission-signing-input.v1');assert.equal(claim.authorized,false);
 assert.equal(claim.publisher.taskId,x.f.catalog[0].id);assert.equal(claim.publisher.taskBinding,bindTask(x.f.catalog[0]));
 assert.match(claim.publisher.transactionId,/^[a-f0-9-]{36}$/);
 assert.equal(claim.headSha,x.gateEvents[0].headSha);assert.equal(claim.baseSha,x.f.sha);
 assert.equal(claim.prBodySha256,hash('Release-Stage: S4-G2\nRelease-Mode: diagnostic\nRelease-Diagnostic-Iteration: 1'));
 assert.equal(claim.stage,'S4-G2');assert.equal(claim.mode,'diagnostic');
 assert.equal(claim.appId,5514822);assert.equal(claim.installationId,176281163);
 assert.equal(claim.gateBinding.sourceRunId,100);assert.equal(claim.gateBinding.evaluatorRunId,101);
 assert.equal(claim.gateBinding.independentReviewerId,1234);assert.equal(claim.gateBinding.reviewId,9);
 assert.equal(claim.envelopeDigest,x.envelopeDigest);assert.match(claim.adoptionDigest,/^[a-f0-9]{64}$/);
 assert.equal(claim.budget.purpose,'OBSERVED_SPEND_ONLY');
 assert.equal(claim.budget.journalDigest,hash(JSON.stringify(ledger.standingDelegationBudget)));
 assert.equal(claim.budget.requests,x.releaseReads.at(-1).requests);
 assert.deepEqual(claim.revocation,ledger.standingRevocationCheckpoint);
 assert(claim.expiresAt>claim.observedAt&&claim.expiresAt-claim.observedAt<=60000);
 assert.throws(()=>inspectStandingAdmissionReceipt(input,{}),/UNTRUSTED/);
 assert.throws(()=>inspectStandingAdmissionReceipt(JSON.parse(input.payload),{}),/UNTRUSTED/);
});
test('compiled release caller fails closed on stale PR failed proof unknown response or revocation',async t=>{
 for(const mode of ['compiled-pr-change','compiled-run-fail','compiled-unknown','compiled-revocation','compiled-outscope','compiled-final-base-change','compiled-missing-registry']){
  const x=await setup(t,{adoptionMode:mode});await x.loop.poll({execute:true});
  assert.equal(x.admissions[0].result.status,'BLOCKED',mode);
  assert.equal(x.admissions[0].result.signingInput,undefined);
  if(mode==='compiled-outscope')assert(x.releaseReads.some(r=>r.route==='issues/600/comments'));
  if(mode==='compiled-run-fail')assert.equal(x.releaseReads.length,4);
  if(mode==='compiled-unknown')assert.equal(x.releaseReads.length,5);
  assert.equal((await x.previews[0].reserve(descriptor())).status,'BLOCKED',mode);
  const ledger=JSON.parse(await fs.readFile(path.join(x.f.root,'state','autopilot-ledger.json'),'utf8'));
  assert(Object.values(ledger.standingDelegationBudget.envelopes)[0].requests>=x.releaseReads.at(-1).requests);
 }
});
test('native main refuses arbitrary or copied reader ports without ambient fallback',async()=>{
 for(const reader of [{get:async()=>[]},createGitHubReader({token:'INERT'}),createGitHubReader({token:'INERT',requestAdmission:async()=>true}),{...createGitHubReader({token:'INERT'})}])
  await assert.rejects(main({ci:true,githubReader:reader,prEvent:{}}),/NATIVE_RELEASE_CONTEXT_REQUIRED/);
});

test('compiled release caller stops at remaining durable budget without refund or fallback',async t=>{
 const baseline=await setup(t,{adoptionMode:'compiled'});await baseline.loop.poll({execute:true});
 assert.equal(baseline.admissions[0].result.status,'STANDING_SOURCE_ADMISSION_VERIFIED');
 const cap=baseline.releaseReads.at(-1).requests-1;
 const x=await setup(t,{adoptionMode:'compiled',gateBudget:cap});await x.loop.poll({execute:true});
 assert.equal(x.admissions[0].result.status,'BLOCKED');
 assert.equal(x.releaseReads.length,8);
 const ledger=JSON.parse(await fs.readFile(path.join(x.f.root,'state','autopilot-ledger.json'),'utf8'));
 assert.equal(Object.values(ledger.standingDelegationBudget.envelopes)[0].requests,cap);
});


test('native protected Git trust reads share Publisher budget and ignore worktree registry',async t=>{
 const x=await setup(t,{adoptionMode:'git-trust'});await x.loop.poll({execute:true});
 assert.equal(x.admissions[0].result.status,'PROTECTED_GIT_TRUST_VERIFIED',JSON.stringify(x.admissions));
 assert.equal(x.admissions[0].result.authorized,false);
 assert.deepEqual(x.releaseReads.map(x=>x.route),['branches/main','branches/main']);
 assert.equal(x.releaseReads[1].requests,x.releaseReads[0].requests+1);
 assert.equal(await x.previews[0].beforeRequest(),false);
});
test('native Git trust current-main movement or unknown response retains spend and poisons lane',async t=>{
 for(const mode of ['git-trust-moved','git-trust-unknown','git-trust-unprotected']){
  const x=await setup(t,{adoptionMode:mode});await x.loop.poll({execute:true});
  assert.equal(x.admissions[0].result.status,'BLOCKED',mode);
  assert.equal((await x.previews[0].reserve(descriptor())).status,'BLOCKED',mode);
  const ledger=JSON.parse(await fs.readFile(path.join(x.f.root,'state','autopilot-ledger.json'),'utf8'));
  assert.equal(Object.values(ledger.standingDelegationBudget.envelopes)[0].requests,x.releaseReads.at(-1).requests);
 }
});
