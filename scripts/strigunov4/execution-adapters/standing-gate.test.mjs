// Isolated protocol fixtures only. Synthetic v0 host grant is explicit; no live authority.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {generateKeyPairSync,sign,createHash} from 'node:crypto';
import {fixture,makeLoop,target} from './publisher-fixture.mjs';
import {bindTask} from './github-publisher.mjs';
import {inspectStandingTransaction} from './state.mjs';
import {createPublisherTransport} from './publisher-transport.mjs';
import {createGitHubReader} from './github-readonly.mjs';
import {createStandingRequestPreview} from './standing-request-guard.mjs';
import {ENVELOPE_SECURITY_REQUIRED,inspectProtectedRepositorySecurity} from '../../agent-os/check-demo-release.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
const key=()=>{const pair=generateKeyPairSync('ed25519');return {...pair,pem:pair.publicKey.export({type:'spki',format:'pem'}),digest:hash(pair.publicKey.export({type:'spki',format:'der'}))};};
const signed=(value,k)=>{const payload=JSON.stringify(value);return {payload,signature:sign(null,Buffer.from(payload),k.privateKey).toString('base64')};};
const descriptor=(method='GET',route='branches/main')=>{const payloadSha256=hash(method==='GET'?'':'{}');return {method,route,payloadSha256,requestSha256:hash(JSON.stringify({method,route,payloadSha256}))};};
async function setup(t,{wrongLocal=false,forgedLocal=false,lateRevocation=false,rollbackRevocation=false,pendingCI=true,skipLocal=false,wrongReviewer=false,gateBudget=false,gateFailure=false,lateGateClock=Infinity}={}){
 const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
 const f=await fixture(t,{realGitObjects:true,ci:pendingCI?'pending':'success',seedFiles:Object.fromEntries(ENVELOPE_SECURITY_REQUIRED.map(p=>[p,'inert protected '+p+'\n']))});
 const now={value:1000000},owner=key(),verifier=key(),comparison={repository:'ASI-integration/asi-landing',repoRoot:path.join(f.base,'seed'),baseSha:f.sha,headSha:f.sha};
 const security=inspectProtectedRepositorySecurity(comparison);assert.equal(security.status,'PROTECTED_SECURITY_VERIFIED');
 const envelope={schema:'asi.release-envelope.proposal.v1',repo:comparison.repository,environment:'beget-staging',target:'pqukibofpo',appId:5514822,installationId:176281163,policyDigest:security.policyDigest,securityDigest:security.securityDigest,notBefore:now.value-1000,expiresAt:now.value+600000,action:'source',allowedPaths:[target],maxOperations:256,maxRequests:gateBudget||256,maxWrites:8,paidApiUsd:0,verifierKeySha256:verifier.digest};
 const signedEnvelope=signed(envelope,owner),envelopeDigest=hash(signedEnvelope.payload);
 const manifest={schema:'asi.release-envelope-revocations.v1',repository:envelope.repo,environment:envelope.environment,target:envelope.target,issuerKeySha256:owner.digest,verifierKeySha256:verifier.digest,sequence:1,issuedAt:now.value-1000,expiresAt:envelope.expiresAt,revokedEnvelopeDigests:[]};
 const revocation=signed(manifest,owner),prior={sequence:1,manifestDigest:hash(revocation.payload),revokedEnvelopeDigests:[]};
 let revoked=false,selected=0,newRevocation=false;const records=[],phases=[],previews=[],providerCalls=[],gateResults=[],gateCalls=[],gateClockCounts=[];let gateActive=false,gateClockCount=0;
 const protectedReader=async p=>p.endsWith('owner-public.pem')?owner.pem:p.endsWith('standing-verifier-public.pem')?verifier.pem:
  JSON.stringify(revoked?signed({...manifest,sequence:2,revokedEnvelopeDigests:[envelopeDigest]},owner):newRevocation?signed({...manifest,sequence:2},owner):revocation);
 const expectedTrust={repository:envelope.repo,environment:envelope.environment,target:envelope.target,issuerKeySha256:owner.digest,verifierKeySha256:verifier.digest,envelopeDigest};
 const deltas=[];
 for(const task of f.catalog){
  const file=path.join(comparison.repoRoot,target);await fs.writeFile(file,task.changes[0].content);
  const diff=execFileSync('git',['diff','--no-ext-diff','--no-textconv','--',target],{cwd:comparison.repoRoot,encoding:'utf8'});
  deltas.push(hash(diff));await fs.writeFile(file,'VALUE = 1\n');
 }
 const loop=await makeLoop(f,{now,timeoutMs:10000,transactionPorts:async({store,transaction})=>{
  const task=f.catalog[selected],artifactDigest=deltas[selected++];
  const lease=inspectStandingTransaction(transaction);if(!lease.ledger.standingRevocationCheckpoint)lease.ledger.standingRevocationCheckpoint=prior;
  const request={action:'source',repo:envelope.repo,environment:envelope.environment,target:envelope.target,appId:envelope.appId,installationId:envelope.installationId,securityDigest:envelope.securityDigest,changedPaths:[target],headSha:null,baseSha:f.sha,artifactDigest,taskId:task.id,taskBinding:bindTask(task),branch:task.branch};
  const witness=(phase,event)=>({schema:'asi.release-envelope-publisher-evidence.proposal.v1',phase,envelopeDigest,policyDigest:envelope.policyDigest,revocation:'NOT_REVOKED',observedAt:now.value,baseSha:f.sha,headSha:event?.headSha??null,artifactDigest,changedPaths:[target],taskId:task.id,taskBinding:request.taskBinding,branch:request.branch,ci:phase==='EXACT_HEAD_VERIFIED'?'SUCCESS':null,independentReview:phase==='EXACT_HEAD_VERIFIED'?'PASS':null,branchProtection:'PASS',usedOperations:0,paidApiUsd:0,claim:'UNCLAIMED',externalResult:'NONE',...(phase==='LOCAL_DELTA_VERIFIED'?{localChecks:'PASS',independentDeltaReview:'PASS',reviewEvidenceId:event.reviewEvidenceId}:{})});
  const preview=createStandingRequestPreview({store,transaction,signedEnvelope,signedEvidence:signed(witness('ADMISSION_READ'),verifier),request,comparison,providerExpected:{independentReviewerId:1234},expectedTrust,clock:()=>{if(gateActive&&++gateClockCount===lateGateClock)now.value=envelope.expiresAt+1;return now.value;},protectedReader,isolatedPreview:true,publisherPhases:true});previews.push(preview);
  // TEST ONLY: this wrapper executes loopback fixture effects under makeLoop's
  // explicit synthetic v0 grant. Production preview.beforeRequest always refuses.
  let gateAttempted=false;
  const runGate=async event=>{
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
    gateActive=true;
    const gate=await preview.readGateProposal({token:'INERT_GATE_FIXTURE',expected,trustedGateContext,
      signedEvidence:signed(gateWitness,verifier),fetchImpl:async url=>{
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
    // Stop the TEST publication after PRE_GATE: it cannot satisfy final CI.
    return false;
  };
  const requestAdmission=async d=>{const r=await preview.reserve(d);records.push({phase:inspectStandingTransaction(transaction).phase,method:d.method,route:d.route,result:r});
   if(!gateAttempted&&r.status==='RESERVED_PREVIEW'&&d.method==='GET'&&f.pulls.size){
    gateAttempted=true;assert.deepEqual(phases.map(p=>p.phase),['LOCAL_DELTA_VERIFIED']);
    const pr=[...f.pulls.values()][0];await runGate({pr:pr.number,headSha:pr.head.sha});
    return false; // Fixture stop: PRE_GATE is not final CI or permission to send.
   }
   return r.status==='RESERVED_PREVIEW';};
  const reader=createGitHubReader({token:'INERT_FIXTURE_ONLY',timeoutMs:10000,requestAdmission}),remote=createPublisherTransport({token:'INERT_FIXTURE_ONLY',timeoutMs:10000,requestAdmission});
  let snapshots=0;
  return {remote,reader,fetchSnapshot:async()=>{if(snapshots++===0)await reader.get('branches/main');return structuredClone(f.snapshot);},observeLifecycle:async event=>{
   if(skipLocal&&event.phase==='LOCAL_DELTA_VERIFIED')return true;
   assert.notEqual(event.phase,'EXACT_HEAD_VERIFIED','PRE_GATE must not await final CI evidence');
   const value=witness(event.phase,event);if(wrongLocal&&event.phase==='LOCAL_DELTA_VERIFIED')value.taskBinding='a'.repeat(64);
   if(lateRevocation&&event.phase==='LOCAL_DELTA_VERIFIED')revoked=true;
   if(rollbackRevocation&&event.phase==='LOCAL_DELTA_VERIFIED')newRevocation=true;
   const result=await preview.observeLifecycle(forgedLocal&&event.phase==='LOCAL_DELTA_VERIFIED'?{...event}:event,{signedEvidence:signed(value,verifier)});
   phases.push(result);if(rollbackRevocation)newRevocation=false;return result.status==='PROPOSAL_ELIGIBLE';
  }};
 }});
 return {f,loop,now,records,phases,previews,providerCalls,gateResults,gateCalls,gateClockCounts,signedEnvelope,envelopeDigest};
}

// Synthetic provider and v0 fixture only; actual Publisher localPhase, native
// execute lock, Git objects and fsynced budgets. No network or live authority.
test('PRE_GATE fixed reads consume the same native Publisher budget, never final authority',async t=>{
 const x=await setup(t);await x.loop.poll({execute:true});
 assert.equal(x.gateResults.length,1);assert.equal(x.gateResults[0].status,'PROPOSAL_ELIGIBLE',JSON.stringify(x.gateResults));
 assert.equal(x.gateResults[0].phase,'PRE_GATE');assert.equal(x.gateResults[0].authorized,false);
 assert.equal(x.gateCalls.length,13);
 for(let i=1;i<x.gateCalls.length;i++)assert.equal(x.gateCalls[i].requests,x.gateCalls[i-1].requests+1);
 assert.equal(await x.previews[0].beforeRequest(),false);
 const ledger=JSON.parse(await fs.readFile(path.join(x.f.root,'state','autopilot-ledger.json'),'utf8'));
 assert.equal(Object.values(ledger.standingDelegationBudget.envelopes)[0].requests,x.gateCalls.at(-1).requests);
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
 assert.equal(x.gateResults[0].status,'BLOCKED');assert.equal(x.gateCalls.length,13);
 const ledger=JSON.parse(await fs.readFile(path.join(x.f.root,'state','autopilot-ledger.json'),'utf8'));
 assert.equal(Object.values(ledger.standingDelegationBudget.envelopes)[0].requests,x.gateCalls.at(-1).requests);
});
