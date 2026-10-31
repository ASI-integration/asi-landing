import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {generateKeyPairSync,createHash,sign} from 'node:crypto';
import {fixture,makeLoop,target} from '../../strigunov4/execution-adapters/publisher-fixture.mjs';
import {createGitHubReader} from '../../strigunov4/execution-adapters/github-readonly.mjs';
import {createPublisherTransport} from '../../strigunov4/execution-adapters/publisher-transport.mjs';
import {bindTask} from '../../strigunov4/execution-adapters/github-publisher.mjs';
import {assessPublisherReleaseEnvelopeProposal as assess,inspectProtectedRepositorySecurity,ENVELOPE_SECURITY_REQUIRED} from '../check-demo-release.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
const key=()=>{const pair=generateKeyPairSync('ed25519');return {...pair,pem:pair.publicKey.export({type:'spki',format:'pem'}),digest:hash(pair.publicKey.export({type:'spki',format:'der'}))};};
const signed=(value,k)=>{const payload=JSON.stringify(value);return {payload,signature:sign(null,Buffer.from(payload),k.privateKey).toString('base64')};};
const now=1000000;
const descriptor=(method='GET',route='branches/main')=>{const payloadSha256=hash(method==='GET'?'':'{}');return {method,route,payloadSha256,requestSha256:hash(JSON.stringify({method,route,payloadSha256}))};};
function args(f,phase,transaction,event){
 const owner=key(),verifier=key();
 const comparison={repository:'ASI-integration/asi-landing',repoRoot:path.join(f.base,'seed'),baseSha:f.sha,headSha:f.sha};
 const security=inspectProtectedRepositorySecurity(comparison);
 const envelope={schema:'asi.release-envelope.proposal.v1',repo:comparison.repository,environment:'beget-staging',target:'pqukibofpo',appId:5514822,installationId:176281163,policyDigest:security.policyDigest||hash('unproven policy'),securityDigest:security.securityDigest||hash('unproven security'),notBefore:now-1000,expiresAt:now+60000,action:'source',allowedPaths:[target],maxOperations:20,paidApiUsd:0,verifierKeySha256:verifier.digest};
 const signedEnvelope=signed(envelope,owner);
 const request={action:'source',repo:envelope.repo,environment:envelope.environment,target:envelope.target,appId:envelope.appId,installationId:envelope.installationId,securityDigest:envelope.securityDigest,changedPaths:[target],headSha:null,baseSha:f.sha,artifactDigest:event?.deltaSha256||'b'.repeat(64),taskId:'fixture-a',taskBinding:bindTask(f.catalog[0]),branch:f.catalog[0].branch};
 const witness={schema:'asi.release-envelope-publisher-evidence.proposal.v1',phase,envelopeDigest:hash(signedEnvelope.payload),policyDigest:envelope.policyDigest,revocation:'NOT_REVOKED',observedAt:now,baseSha:f.sha,headSha:null,artifactDigest:request.artifactDigest,changedPaths:request.changedPaths,taskId:request.taskId,taskBinding:request.taskBinding,branch:request.branch,ci:null,independentReview:null,branchProtection:'PASS',usedOperations:0,paidApiUsd:0,claim:'UNCLAIMED',externalResult:'NONE',...(phase==='LOCAL_DELTA_VERIFIED'?{localChecks:'PASS',independentDeltaReview:'PASS',reviewEvidenceId:event?.reviewEvidenceId}:{})};
 return {input:{signedEnvelope,trustedPublicKey:owner.pem,signedEvidence:signed(witness,verifier),verifierPublicKey:verifier.pem,request,now},context:{phase,transaction,publisherEvidence:event,comparison,descriptor:descriptor()},witness,verifier,owner,envelope};
}
async function setup(t,callback,{admission=false,missingSecurity=false}={}){
 const native=globalThis.fetch;t.after(()=>{globalThis.fetch=native;});
 const seedFiles=Object.fromEntries(ENVELOPE_SECURITY_REQUIRED.filter(p=>!missingSecurity||p!=='AGENTS.md').map(p=>[p,'inert fixture protected '+p+'\n']));
 const f=await fixture(t,{seedFiles});let transaction;
 const loop=await makeLoop(f,{transactionPorts:async context=>{
  transaction=context.transaction;
  if(admission)callback(args(f,'ADMISSION_READ',transaction));
  return {remote:createPublisherTransport({token:'INERT_FIXTURE_ONLY'}),reader:createGitHubReader({token:'INERT_FIXTURE_ONLY'}),fetchSnapshot:async()=>structuredClone(f.snapshot),
   observeLifecycle:event=>{if(event.phase==='LOCAL_DELTA_VERIFIED')callback(args(f,event.phase,transaction,event));return false;}};
 }});
 return {f,loop,get transaction(){return transaction;}};
}
test('native locally checked delta is proposal eligible before a PR or head exists, never authorized',async t=>{
 let result,input;
 const x=await setup(t,a=>{input=a.input;result=assess(a.input,a.context);});
 assert.equal((await x.loop.poll({execute:true})).mode,'FAILED_LOCKED');
 assert.equal(result.status,'PROPOSAL_ELIGIBLE');assert.equal(result.authorized,false);assert.equal(result.permittedEffect,'DRAFT_SOURCE_ONLY');
 assert.equal(input.request.headSha,null);assert.equal(x.f.writes.length,0);
});
test('admission reads do not need future CI and POST cannot borrow the read phase',async t=>{
 const results=[];
 const x=await setup(t,a=>{
  if(a.context.phase!=='ADMISSION_READ')return;
  results.push(assess(a.input,a.context));
  results.push(assess(a.input,{...a.context,descriptor:descriptor('POST','git/trees')}));
 },{admission:true});
 await x.loop.poll({execute:true});
 assert.equal(results[0].status,'PROPOSAL_ELIGIBLE');assert.equal(results[0].permittedEffect,'READ_ONLY');
 assert.equal(results[1].reason,'ENVELOPE_READ_ONLY');assert.equal(x.f.writes.length,0);
});
test('copies, mismatched full task identity and missing signature cannot impersonate native local proof',async t=>{
 const results=[];
 const x=await setup(t,a=>{
  results.push(assess(a.input,{...a.context,publisherEvidence:{...a.context.publisherEvidence}}));
  const request={...a.input.request,taskBinding:'c'.repeat(64)};
  results.push(assess({...a.input,request,signedEvidence:signed({...a.witness,taskBinding:request.taskBinding},a.verifier)},a.context));
  results.push(assess({...a.input,signedEvidence:signed(a.witness,a.owner)},a.context));
 });
 await x.loop.poll({execute:true});assert.equal(results.length,3);assert(results.every(r=>r.status==='BLOCKED'&&r.authorized===false));
});
test('stale local review, wrong delta, forged future CI and wrong review witness all block',async t=>{
 const results=[];
 const x=await setup(t,a=>{
  for(const patch of [{observedAt:now-60001},{artifactDigest:'d'.repeat(64)},{ci:'SUCCESS'},{reviewEvidenceId:'different-review'}]){
   results.push(assess({...a.input,signedEvidence:signed({...a.witness,...patch},a.verifier)},a.context));
  }
 });
 await x.loop.poll({execute:true});assert.equal(results.length,4);assert(results.every(r=>r.status==='BLOCKED'));
});
test('signed witness cannot omit protected base inventory',async t=>{
 let result;
 const x=await setup(t,a=>{result=assess(a.input,a.context);},{missingSecurity:true});
 await x.loop.poll({execute:true});assert.equal(result.reason,'ENVELOPE_SECURITY_DIGEST');assert.equal(x.f.writes.length,0);
});
test('closed native transaction and accessor input/context fail closed without executing getters',async t=>{
 let saved,getters=0;const results=[];
 const x=await setup(t,a=>{
  saved=a;
  results.push(assess({...a.input,get signedEvidence(){getters++;return a.input.signedEvidence;}},a.context));
  results.push(assess(a.input,{...a.context,get transaction(){getters++;return a.context.transaction;}}));
 });
 await x.loop.poll({execute:true});results.push(assess(saved.input,saved.context));
 assert.equal(getters,0);assert.equal(results.length,3);assert(results.every(r=>r.status==='BLOCKED'));
});
test('prepublication evidence cannot claim exact-head verification',async t=>{
 let result;
 const x=await setup(t,a=>{
  result=assess({...a.input,signedEvidence:signed({...a.witness,phase:'EXACT_HEAD_VERIFIED'},a.verifier)},
   {...a.context,phase:'EXACT_HEAD_VERIFIED'});
 });
 await x.loop.poll({execute:true});assert.equal(result.status,'BLOCKED');assert.equal(x.f.writes.length,0);
});

test('actual native final head plus complete Git diff and bound provider evidence is eligible only for verification',async t=>{
 const native=globalThis.fetch;t.after(()=>{globalThis.fetch=native;});
 const f=await fixture(t,{realGitObjects:true,seedFiles:Object.fromEntries(ENVELOPE_SECURITY_REQUIRED.map(p=>[p,'inert protected '+p+'\n']))});
 const results=[];
 const loop=await makeLoop(f,{transactionPorts:async({transaction})=>({
  remote:createPublisherTransport({token:'INERT_FIXTURE_ONLY'}),reader:createGitHubReader({token:'INERT_FIXTURE_ONLY'}),fetchSnapshot:async()=>structuredClone(f.snapshot),
  observeLifecycle:event=>{
   if(event.phase==='LOCAL_DELTA_VERIFIED')return true;
   const a=args(f,event.phase,transaction,event);
   Object.assign(a.input.request,{headSha:event.headSha,pr:event.pr});a.context.comparison.headSha=event.headSha;
   Object.assign(a.witness,{headSha:event.headSha,ci:'SUCCESS',independentReview:'PASS'});a.input.signedEvidence=signed(a.witness,a.verifier);
   const expected={repository:a.input.request.repo,number:event.pr,baseSha:f.sha,headSha:event.headSha,independentReviewerId:20261029};
   const ref={number:event.pr,head:{sha:event.headSha},base:{sha:f.sha}};
   const pr={number:event.pr,state:'open',user:{id:207600140},head:{sha:event.headSha,repo:{full_name:expected.repository}},base:{ref:'main',sha:f.sha,repo:{full_name:expected.repository}}};
   const runs=[{id:200,workflow_id:311380800,event:'pull_request',head_sha:event.headSha},{id:201,workflow_id:390653294,event:'pull_request_target',head_sha:f.sha}]
    .map(run=>({...run,run_attempt:1,status:'completed',conclusion:'success',repository:{full_name:expected.repository},pull_requests:[ref],updated_at:new Date(now).toISOString()}));
   const reviews=[{id:300,user:{id:expected.independentReviewerId},state:'APPROVED',commit_id:event.headSha,submitted_at:new Date(now).toISOString()}];
   a.context.providerExpected=expected;
   a.context.providerObservation={status:'PROVIDER_EVIDENCE_VERIFIED',authorized:false,snapshot:{pr,runs,reviews,expected,now},receipt:{observedAt:now}};
   results.push(assess(a.input,a.context));
   const failed=structuredClone(a.context.providerObservation);failed.snapshot.runs[0].conclusion='failure';
   results.push(assess(a.input,{...a.context,providerObservation:failed}));
   return true;
  },
 })});
 assert.equal((await loop.poll({execute:true})).mode,'REPORT_READY');
 assert.equal(results.length,2);assert.equal(results[0].status,'PROPOSAL_ELIGIBLE');assert.equal(results[0].permittedEffect,'VERIFICATION_ONLY');
 assert.equal(results[0].authorized,false);assert.equal(results[1].reason,'ENVELOPE_PHASE_PROVIDER');assert.equal(f.writes.length,4);
});
