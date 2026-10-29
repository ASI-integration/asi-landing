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
async function setup(t,{wrongLocal=false,forgedLocal=false,lateRevocation=false,rollbackRevocation=false,pendingCI=false,skipLocal=false,wrongReviewer=false}={}){
 const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
 const f=await fixture(t,{realGitObjects:true,ci:pendingCI?'pending':'success',seedFiles:Object.fromEntries(ENVELOPE_SECURITY_REQUIRED.map(p=>[p,'inert protected '+p+'\n']))});
 const now={value:1000000},owner=key(),verifier=key(),comparison={repository:'ASI-integration/asi-landing',repoRoot:path.join(f.base,'seed'),baseSha:f.sha,headSha:f.sha};
 const security=inspectProtectedRepositorySecurity(comparison);assert.equal(security.status,'PROTECTED_SECURITY_VERIFIED');
 const envelope={schema:'asi.release-envelope.proposal.v1',repo:comparison.repository,environment:'beget-staging',target:'pqukibofpo',appId:5514822,installationId:176281163,policyDigest:security.policyDigest,securityDigest:security.securityDigest,notBefore:now.value-1000,expiresAt:now.value+600000,action:'source',allowedPaths:[target],maxOperations:256,maxRequests:256,maxWrites:8,paidApiUsd:0,verifierKeySha256:verifier.digest};
 const signedEnvelope=signed(envelope,owner),envelopeDigest=hash(signedEnvelope.payload);
 const manifest={schema:'asi.release-envelope-revocations.v1',repository:envelope.repo,environment:envelope.environment,target:envelope.target,issuerKeySha256:owner.digest,verifierKeySha256:verifier.digest,sequence:1,issuedAt:now.value-1000,expiresAt:envelope.expiresAt,revokedEnvelopeDigests:[]};
 const revocation=signed(manifest,owner),prior={sequence:1,manifestDigest:hash(revocation.payload),revokedEnvelopeDigests:[]};
 let revoked=false,selected=0,newRevocation=false;const records=[],phases=[],previews=[],providerCalls=[];
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
  const preview=createStandingRequestPreview({store,transaction,signedEnvelope,signedEvidence:signed(witness('ADMISSION_READ'),verifier),request,comparison,providerExpected:{independentReviewerId:1234},expectedTrust,clock:()=>now.value,protectedReader,isolatedPreview:true,publisherPhases:true});previews.push(preview);
  // TEST ONLY: this wrapper executes loopback fixture effects under makeLoop's
  // explicit synthetic v0 grant. Production preview.beforeRequest always refuses.
  const beforeRequest=async d=>{const r=await preview.reserve(d);records.push({phase:inspectStandingTransaction(transaction).phase,method:d.method,route:d.route,result:r});return r.status==='RESERVED_PREVIEW';};
  const reader=createGitHubReader({token:'INERT_FIXTURE_ONLY',timeoutMs:10000,beforeRequest}),remote=createPublisherTransport({token:'INERT_FIXTURE_ONLY',timeoutMs:10000,beforeRequest});
  let snapshots=0;
  return {remote,reader,fetchSnapshot:async()=>{if(snapshots++===0)await reader.get('branches/main');return structuredClone(f.snapshot);},observeLifecycle:async event=>{
   if(skipLocal&&event.phase==='LOCAL_DELTA_VERIFIED')return true;
   if(event.phase==='EXACT_HEAD_VERIFIED'){
    const expected={repository:envelope.repo,number:event.pr,baseSha:f.sha,headSha:event.headSha,independentReviewerId:wrongReviewer?1235:1234};
    const bound={number:event.pr,head:{sha:event.headSha},base:{sha:f.sha}};
    const snapshot={pr:{...f.pulls.get(event.pr),user:{id:4567}},runs:[{workflow_id:311380800,event:'pull_request',head_sha:event.headSha},{workflow_id:390653294,event:'pull_request_target',head_sha:f.sha}].map((r,i)=>({...r,id:100+i,run_attempt:1,repository:{full_name:envelope.repo},pull_requests:[bound],status:'completed',conclusion:'success',updated_at:new Date(now.value).toISOString()})),reviews:[{id:9,user:{id:1234},state:'APPROVED',commit_id:event.headSha,submitted_at:new Date(now.value).toISOString()}]};
    const result=await preview.readProvider({token:'INERT_PROVIDER_FIXTURE',publisherEvidence:event,expected,fetchImpl:async url=>{
     const disk=JSON.parse(await fs.readFile(store.file('autopilot-ledger.json'),'utf8'));
     providerCalls.push({budget:Object.values(disk.standingDelegationBudget.envelopes)[0].requests,url});
     const u=new URL(url),body=u.pathname.endsWith('/reviews')?snapshot.reviews:u.pathname.endsWith('/runs')?{total_count:1,workflow_runs:snapshot.runs.filter(r=>u.pathname.includes(String(r.workflow_id)))}:snapshot.pr;
     return new Response(JSON.stringify(body),{status:200,headers:{'content-type':'application/json'}});
    }});
    if(result.status!=='PROVIDER_EVIDENCE_VERIFIED'){phases.push(result);return false;}
    // Mutating the returned data cannot forge the privately retained observation.
    result.snapshot.reviews[0].state='DISMISSED';
   }
   const value=witness(event.phase,event);if(wrongLocal&&event.phase==='LOCAL_DELTA_VERIFIED')value.taskBinding='a'.repeat(64);
   if(lateRevocation&&event.phase==='LOCAL_DELTA_VERIFIED')revoked=true;
   if(rollbackRevocation&&event.phase==='LOCAL_DELTA_VERIFIED')newRevocation=true;
   const result=await preview.observeLifecycle(forgedLocal&&event.phase==='LOCAL_DELTA_VERIFIED'?{...event}:event,{signedEvidence:signed(value,verifier)});
   phases.push(result);if(rollbackRevocation)newRevocation=false;return result.status==='PROPOSAL_ELIGIBLE';
  }};
 }});
 return {f,loop,now,records,phases,previews,providerCalls,signedEnvelope,envelopeDigest};
}
test('two native publications reuse one signed envelope and budget without future-PR admission',async t=>{
 const x=await setup(t);const first=await x.loop.poll({execute:true});
 assert.equal(first.mode,'REPORT_READY');x.now.value+=180000;
 const second=await x.loop.poll({execute:true});assert.equal(second.mode,'REPORT_READY',JSON.stringify({second,last:x.records.at(-1),phases:x.phases,requests:x.f.requests.length}));
 assert.equal(x.f.pulls.size,2);assert.equal(new Set([...x.f.pulls.values()].map(p=>p.head.sha)).size,2);
 assert.deepEqual(x.phases.map(p=>p.phase),['LOCAL_DELTA_VERIFIED','EXACT_HEAD_VERIFIED','LOCAL_DELTA_VERIFIED','EXACT_HEAD_VERIFIED']);
 assert(x.phases.every(p=>p.authorized===false));assert.equal(x.providerCalls.length,10);
 assert(x.providerCalls.every((c,i)=>i===0||c.budget>x.providerCalls[i-1].budget));
 for(const p of x.previews)assert.equal(await p.beforeRequest(descriptor('POST','git/trees')),false);
 const ledger=JSON.parse(await fs.readFile(path.join(x.f.root,'state','autopilot-ledger.json'),'utf8'));
 const budgets=Object.values(ledger.standingDelegationBudget.envelopes);assert.equal(budgets.length,1);assert.equal(budgets[0].writes,8);
 assert(budgets[0].requests<=256);assert.equal(budgets[0].requests,x.f.requests.length+x.providerCalls.length);
 const receipts=JSON.parse(await fs.readFile(path.join(x.f.root,'state','receipts.json'),'utf8'));
 assert.equal(receipts.completed.filter(r=>r.status==='PASS').length,2);
 const bindings=Object.values(ledger.standingRequestBindings);assert(bindings.every(b=>b.candidateSha===null&&b.headBinding==='ORIGINAL_BASE_BEFORE_PUBLICATION'));
 assert(bindings.filter(b=>b.method==='POST'&&b.route!=='graphql').every(b=>b.evidencePhase==='LOCAL_DELTA_VERIFIED'));
 for(const phase of ['admission','preflight','started','postflight'])assert(x.records.some(r=>r.phase===phase),phase);
});
test('wrong signed task, copied native proof and freshly revoked envelope block before first write',async t=>{
 for(const options of [{wrongLocal:true},{forgedLocal:true},{lateRevocation:true}]){
  const x=await setup(t,options);assert.equal((await x.loop.poll({execute:true})).mode,'FAILED_LOCKED');
  assert.equal(x.f.writes.length,0);assert.equal(x.phases.at(-1).status,'BLOCKED');
  assert(x.records.some(r=>r.phase==='admission'&&r.result.status==='RESERVED_PREVIEW'));
 }
});
test('pending remote CI cannot emit exact-head verification even after local publication',async t=>{
 const x=await setup(t,{pendingCI:true});assert.equal((await x.loop.poll({execute:true})).mode,'WAITING');
 assert.equal(x.f.writes.length,4);assert.deepEqual(x.phases.map(p=>p.phase),['LOCAL_DELTA_VERIFIED']);assert.equal(x.providerCalls.length,0);
});

test('native local observer durably advances revocation floor before next metered request',async t=>{
 const x=await setup(t,{rollbackRevocation:true});assert.equal((await x.loop.poll({execute:true})).mode,'FAILED_LOCKED');
 assert.equal(x.phases[0].status,'PROPOSAL_ELIGIBLE');assert.equal(x.f.writes.length,0);
 const ledger=JSON.parse(await fs.readFile(path.join(x.f.root,'state','autopilot-ledger.json'),'utf8'));
 assert.equal(ledger.standingRevocationCheckpoint.sequence,2);
 assert.equal(x.records.at(-1).result.status,'BLOCKED');
});

test('native local observer acknowledgement without signed phase witness cannot admit a write',async t=>{
 const x=await setup(t,{skipLocal:true});assert.equal((await x.loop.poll({execute:true})).mode,'FAILED_LOCKED');
 assert.equal(x.f.writes.length,0);assert.deepEqual(x.phases,[]);
 assert.equal(x.records.at(-1).result.status,'BLOCKED');assert.equal(x.records.at(-1).method,'POST');
});

test('provider reviewer identity is pinned before the future PR exists',async t=>{
 const x=await setup(t,{wrongReviewer:true});assert.equal((await x.loop.poll({execute:true})).mode,'FAILED_LOCKED');
 assert.equal(x.providerCalls.length,0);assert.equal(x.phases.at(-1).status,'BLOCKED');
 assert.equal(x.f.writes.length,4);
});
