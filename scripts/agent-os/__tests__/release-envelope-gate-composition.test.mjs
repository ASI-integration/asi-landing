// Synthetic public keys/provider responses only; temporary Git objects are real.
// No live token, server state, authority activation or external write.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {readAndAssessProtectedGateProposal as read,inspectProtectedRepositorySecurity,
  ENVELOPE_SECURITY_REQUIRED,assessWitnessedReleaseEnvelopeProposal,checkPr} from '../check-demo-release.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
const key=()=>{const x=generateKeyPairSync('ed25519');return {...x,pem:x.publicKey.export({type:'spki',format:'pem'}),digest:hash(x.publicKey.export({type:'spki',format:'der'}))};};
const signed=(value,k)=>{const payload=JSON.stringify(value);return {payload,signature:sign(null,Buffer.from(payload),k.privateKey).toString('base64')};};
const repo='ASI-integration/asi-landing',target='src/routine.txt';
const now=Date.parse('2026-10-29T19:00:00Z');
function fixture(t,{creation=false}={}){
 const taskId=creation?'beget-g2-witness-identity-v1':'routine-task';
 const target=creation?'scripts/strigunov4/test_beget_g2_witness_identity_v1.py':'src/routine.txt';
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'asi-gate-caller-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 git('init');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
 for(const p of [...ENVELOPE_SECURITY_REQUIRED,...(creation?[]:[target])]){fs.mkdirSync(path.dirname(path.join(root,p)),{recursive:true});fs.writeFileSync(path.join(root,p),'inert '+p+'\n');}
 const contents=[Buffer.from('jobs:\n  source_validation: {}\n  channel-manager-recovery-postgres: {}\n  validate: {}\n'),Buffer.from('jobs:\n  release_governance: {}\n')];
 const workflowPaths=['.github/workflows/pr-validation.yml','.github/workflows/asi-release-governance.yml'];
 workflowPaths.forEach((p,i)=>fs.writeFileSync(path.join(root,p),contents[i]));
 git('add','.');git('-c','core.hooksPath=/dev/null','commit','-m','base');const baseSha=git('rev-parse','HEAD');
 const heads=[];for(const value of ['first\n','second\n']){fs.mkdirSync(path.dirname(path.join(root,target)),{recursive:true});fs.writeFileSync(path.join(root,target),value);git('add',target);git('-c','core.hooksPath=/dev/null','commit','-m',value);heads.push(git('rev-parse','HEAD'));}
 const security=inspectProtectedRepositorySecurity({repoRoot:root,baseSha,headSha:baseSha});assert.equal(security.status,'PROTECTED_SECURITY_VERIFIED');
 const owner=key(),verifier=key(),envelope={schema:'asi.release-envelope.proposal.v1',repo,environment:'beget-staging',target:'pqukibofpo',appId:5514822,installationId:176281163,policyDigest:security.policyDigest,securityDigest:security.securityDigest,notBefore:now-10000,expiresAt:now+600000,action:'source',allowedPaths:[target],maxOperations:256,paidApiUsd:0,verifierKeySha256:verifier.digest};
 const signedEnvelope=signed(envelope,owner),envelopeDigest=hash(signedEnvelope.payload);
 const manifest={schema:'asi.release-envelope-revocations.v1',repository:repo,environment:envelope.environment,target:envelope.target,issuerKeySha256:owner.digest,verifierKeySha256:verifier.digest,sequence:1,issuedAt:now-1000,expiresAt:now+600000,revokedEnvelopeDigests:[]};
 const documents={'owner-public.pem':owner.pem,'standing-verifier-public.pem':verifier.pem,'standing-revocations.json':JSON.stringify(signed(manifest,owner))};
 const expectedTrust={repository:repo,environment:envelope.environment,target:envelope.target,issuerKeySha256:owner.digest,verifierKeySha256:verifier.digest,envelopeDigest,minRevocationSequence:1,minRevocationManifestDigest:hash(JSON.stringify(manifest)),priorRevokedEnvelopeDigests:[]};
 const clock={value:now},calls=[],metered=[];let change=()=>{},trustChange=()=>{},trustReads=0;
 const protectedReader=async p=>{trustChange(++trustReads);return documents[path.basename(p)];};
 const candidate=(headSha= heads[0])=>{
  const expected={repository:repo,number:552,baseSha,headSha,independentReviewerId:1234};
  const binding={number:552,base:{sha:baseSha},head:{sha:headSha}};
  const recent=new Date(now-1000).toISOString();
  const run=(id,workflow_id,event,sha,p)=>({id,workflow_id,event,head_sha:sha,path:p,run_attempt:1,status:'in_progress',conclusion:null,repository:{full_name:repo},pull_requests:[binding],updated_at:recent});
  const source=run(41,311380800,'pull_request',headSha,workflowPaths[0]);
  const evaluator=run(42,390653294,'pull_request_target',baseSha,workflowPaths[1]);
  const pins=workflowPaths.map(p=>git('rev-parse',baseSha+':'+p));
  const trustedGateContext={schema:'asi.protected-gate-split.proposal.v1',repository:repo,number:552,baseSha,headSha,evaluatorRunId:42,evaluatorRunAttempt:1,sourceWorkflowBlobSha:pins[0],evaluatorWorkflowBlobSha:pins[1]};
  const jobs=['source_validation','channel-manager-recovery-postgres','validate'].map((name,i)=>({id:101+i,name,run_id:41,head_sha:headSha,status:i===2?'in_progress':'completed',conclusion:i===2?null:'success',completed_at:i===2?null:recent}));
  const snapshot={pr:{number:552,state:'open',user:{id:207600140},base:{ref:'main',sha:baseSha,repo:{full_name:repo}},head:{sha:headSha,repo:{full_name:repo}}},runs:[source,evaluator],jobs,reviews:[{id:9,user:{id:1234},state:'APPROVED',commit_id:headSha,submitted_at:recent}]};
  const request={action:'source',repo,environment:envelope.environment,target:envelope.target,appId:envelope.appId,installationId:envelope.installationId,securityDigest:security.securityDigest,changedPaths:[target],headSha,baseSha,artifactDigest:creation?hash(JSON.stringify([{path:target,beforeSha256:null,afterSha256:hash(execFileSync('git',['cat-file','blob',headSha+':'+target],{cwd:root}))}])):hash(execFileSync('git',['diff','--no-ext-diff','--no-textconv',baseSha,headSha,'--',target],{cwd:root})),taskId,pr:552};
  const witness={schema:'asi.release-envelope-gate-evidence.proposal.v1',phase:'PRE_GATE',envelopeDigest,policyDigest:security.policyDigest,revocation:'NOT_REVOKED',observedAt:now,headSha,baseSha,artifactDigest:request.artifactDigest,changedPaths:[target],ci:'SOURCE_SUCCESS',independentReview:'PASS',branchProtection:'PASS',usedOperations:0,paidApiUsd:0,taskId:request.taskId,claim:'UNCLAIMED',externalResult:'NONE',gateBinding:{...trustedGateContext,sourceRunId:41,sourceRunAttempt:1,independentReviewerId:1234,reviewId:9}};
  const input={signedEnvelope,signedEvidence:signed(witness,verifier),request};
  const context={expected,trustedGateContext,comparison:{repository:repo,repoRoot:root,baseSha,headSha},expectedTrust,token:'inert-fixture-token',clock:()=>clock.value,protectedReader,beforeRequest:async d=>{metered.push(d);return true;},fetchImpl:async url=>{
   calls.push(url);const u=new URL(url),p=u.pathname;let value;
   if(p.includes('/contents/')){const i=p.endsWith('pr-validation.yml')?0:1;value={type:'file',path:workflowPaths[i],sha:pins[i],encoding:'base64',content:contents[i].toString('base64')};}
   else if(p.includes('/workflows/')){const id=Number(p.split('/').at(-2));const runs=snapshot.runs.filter(r=>r.workflow_id===id);value={total_count:runs.length,workflow_runs:runs};}
   else if(p.endsWith('/jobs'))value={total_count:snapshot.jobs.length,jobs:snapshot.jobs};
   else if(p.endsWith('/runs/42'))value=snapshot.runs[1];
   else if(p.endsWith('/reviews'))value=snapshot.reviews;
   else value=snapshot.pr;
   change({u,value,snapshot});return new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
  }};
  return {input,context,witness,snapshot,resign:()=>{input.signedEvidence=signed(witness,verifier);}};
 };
 return {root,git,baseSha,heads,owner,verifier,envelope,signedEnvelope,envelopeDigest,documents,manifest,clock,calls,metered,expectedTrust,candidate,
  change:f=>{change=f;},trustChange:f=>{trustChange=f;},resignRevocation:()=>{documents['standing-revocations.json']=JSON.stringify(signed(manifest,owner));}};
}
test('real two-HEAD Git diff and metered PRE_GATE reads reuse one unchanged owner envelope',async t=>{
 const f=fixture(t),original=JSON.stringify(f.signedEnvelope);
 for(const head of f.heads){const x=f.candidate(head),r=await read(x.input,x.context);assert.equal(r.status,'PROPOSAL_ELIGIBLE',JSON.stringify(r));assert.equal(r.phase,'PRE_GATE');assert.equal(r.permittedEffect,'ADMISSION_REVIEW_ONLY');assert.equal(r.authorized,false);assert.equal(r.requiresAtomicReservation,true);assert.equal(r.providerReceipt.requests,14);}
 assert.notEqual(...f.heads);assert.equal(JSON.stringify(f.signedEnvelope),original);assert.equal(f.calls.length,28);assert.equal(f.metered.length,28);assert(f.metered.every(d=>d.method==='GET'));
});
test('PRE_GATE signature cannot become final witnessed evidence or bypass v0',async t=>{
 const f=fixture(t),x=f.candidate();assert.equal((await read(x.input,x.context)).status,'PROPOSAL_ELIGIBLE');
 assert.equal(assessWitnessedReleaseEnvelopeProposal({...x.input,trustedPublicKey:f.owner.pem,verifierPublicKey:f.verifier.pem,now}).status,'BLOCKED');
 assert.throws(()=>checkPr({contract:{transition:{legacyPrMax:509}},changed:['scripts/agent-os/check-demo-release.mjs'],prNumber:552,headSha:f.heads[0],baseHasContract:true,ownerApproval:false}),/GOVERNANCE_CHANGE_NEEDS_VERIFIED_OWNER_ATTESTATION/);
});
test('wrong phase, whole-workflow success assertion and wrong signed attempt/reviewer binding block',async t=>{
 const f=fixture(t);
 for(const mutate of [w=>w.phase='EXACT_HEAD_VERIFIED',w=>w.ci='SUCCESS',w=>w.gateBinding.sourceRunAttempt=2,w=>w.gateBinding.evaluatorRunId=99,w=>w.gateBinding.reviewId=10,w=>w.gateBinding.independentReviewerId=207600140]){
  const x=f.candidate();mutate(x.witness);x.resign();assert.equal((await read(x.input,x.context)).status,'BLOCKED');
 }
});
test('tampered signatures and wrong trust signer pins block',async t=>{
 const f=fixture(t),x=f.candidate();x.input.signedEvidence.signature='A'.repeat(86)+'==';assert.equal((await read(x.input,x.context)).status,'BLOCKED');
 const y=f.candidate();y.context.expectedTrust={...f.expectedTrust,issuerKeySha256:'a'.repeat(64)};assert.equal((await read(y.input,y.context)).status,'BLOCKED');
});
test('unknown effect, exhausted budget, expiry and stale signed witness block before network',async t=>{
 const f=fixture(t);
 for(const mutate of [w=>w.externalResult='UNKNOWN',w=>w.usedOperations=256,w=>w.observedAt=now-60001,w=>w.claim='FAILED_LOCKED']){
  const x=f.candidate();mutate(x.witness);x.resign();assert.equal((await read(x.input,x.context)).status,'BLOCKED');
 }
 const x=f.candidate();f.clock.value=f.envelope.expiresAt;assert.equal((await read(x.input,x.context)).status,'BLOCKED');assert.equal(f.calls.length,0);
});
test('caller target, PR, base and hidden diff mismatch block',async t=>{
 const f=fixture(t);
 for(const mutate of [x=>x.input.request.target='other',x=>x.input.request.pr=553,x=>x.input.request.baseSha=f.heads[0],x=>x.input.request.changedPaths=[]]){
  const x=f.candidate();mutate(x);assert.equal((await read(x.input,x.context)).status,'BLOCKED');
 }
});
test('real protected rename or deletion cannot hide behind ordinary changedPaths',async t=>{
 const f=fixture(t);f.git('mv','AGENTS.md','src/ordinary.txt');f.git('-c','core.hooksPath=/dev/null','commit','-m','protected rename');
 const x=f.candidate(f.git('rev-parse','HEAD'));x.input.request.changedPaths=['AGENTS.md',target,'src/ordinary.txt'];x.witness.changedPaths=x.input.request.changedPaths;x.resign();
 assert.equal((await read(x.input,x.context)).status,'BLOCKED');assert.equal(f.calls.length,0);
});
test('signed revocation before and during provider collection blocks',async t=>{
 for(const during of [false,true]){
  const f=fixture(t),x=f.candidate();const revoke=()=>{f.manifest.sequence=2;f.manifest.revokedEnvelopeDigests=[f.envelopeDigest];f.resignRevocation();};
  if(during)f.change(({u})=>{if(u.pathname.endsWith('/reviews'))revoke();});else revoke();
  assert.equal((await read(x.input,x.context)).status,'BLOCKED');
 }
});
test('mutable caller contexts are captured before awaits, accessors never run',async t=>{
 const f=fixture(t),x=f.candidate();let called=0;
 Object.defineProperty(x.context,'expected',{get(){called++;return {};}});
 assert.equal((await read(x.input,x.context)).status,'BLOCKED');assert.equal(called,0);assert.equal(f.calls.length,0);
 const y=f.candidate();f.trustChange(n=>{if(n===1){y.context.expected.headSha='f'.repeat(40);y.input.request.headSha='f'.repeat(40);}});
 assert.equal((await read(y.input,y.context)).status,'PROPOSAL_ELIGIBLE');
});
test('provider stale/dismissed review and missing metering deny',async t=>{
 const f=fixture(t),x=f.candidate();delete x.context.beforeRequest;assert.equal((await read(x.input,x.context)).status,'BLOCKED');assert.equal(f.calls.length,0);
 for(const mutate of [s=>s.reviews[0].state='DISMISSED',s=>s.jobs[0].conclusion='failure']){
  const y=f.candidate();mutate(y.snapshot);assert.equal((await read(y.input,y.context)).status,'BLOCKED');
 }
});
test('late expiry and clock regression after asynchronous reads cannot revive a proposal',async t=>{
 for(const time of [now+600000,now-1]){
  const f=fixture(t),x=f.candidate();f.trustChange(n=>{if(n===12)f.clock.value=time;});
  assert.equal((await read(x.input,x.context)).status,'BLOCKED');
 }
});

test('a mutually signed but unmeasured artifact digest is rejected before provider reads',async t=>{
 const f=fixture(t),x=f.candidate();x.input.request.artifactDigest='f'.repeat(64);
 x.witness.artifactDigest=x.input.request.artifactDigest;x.resign();
 assert.equal((await read(x.input,x.context)).reason,'ENVELOPE_ARTIFACT_DIGEST');assert.equal(f.calls.length,0);
});
test('existing Publisher creation manifest is reconstructed from actual new blob bytes',async t=>{
 const f=fixture(t,{creation:true}),x=f.candidate();
 assert.equal((await read(x.input,x.context)).status,'PROPOSAL_ELIGIBLE');
 x.input.request.artifactDigest='f'.repeat(64);x.witness.artifactDigest=x.input.request.artifactDigest;x.resign();
 assert.equal((await read(x.input,x.context)).reason,'ENVELOPE_ARTIFACT_DIGEST');
});
test('unsupported creation and mode changes are not accepted as edit artifacts',async t=>{
 const f=fixture(t),x=f.candidate();f.git('update-index','--chmod=+x',target);
 f.git('-c','core.hooksPath=/dev/null','commit','-m','mode');const y=f.candidate(f.git('rev-parse','HEAD'));
 assert.equal((await read(y.input,y.context)).reason,'ENVELOPE_ARTIFACT_SCOPE');
 const g=fixture(t,{creation:true}),z=g.candidate();z.input.request.taskId='unknown-create';z.witness.taskId='unknown-create';z.resign();
 assert.equal((await read(z.input,z.context)).reason,'ENVELOPE_ARTIFACT_SCOPE');
 assert.equal(x.input.request.taskId,'routine-task');
});
test('authenticated source pending retains metered receipt without granting eligibility',async t=>{
 const f=fixture(t),x=f.candidate();Object.assign(x.snapshot.jobs[0],{status:'queued',conclusion:null,completed_at:null});
 const r=await read(x.input,x.context);assert.equal(r.status,'WAITING',JSON.stringify(r));
 assert.equal(r.reason,'GATE_SOURCE_PENDING');assert.equal(r.authorized,false);assert.equal(r.permittedEffect,'NONE');
 assert.equal(r.providerReceipt.requests,14);assert.equal(f.metered.length,14);assert.equal(r.revocationCheckpoint.sequence,1);
 x.witness.gateBinding.sourceRunAttempt=2;x.resign();assert.equal((await read(x.input,x.context)).status,'BLOCKED');
});
