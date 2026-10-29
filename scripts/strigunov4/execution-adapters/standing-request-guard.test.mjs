import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {generateKeyPairSync,sign,createHash} from 'node:crypto';
import {initializeState,digest,LIVE_ROOT} from './state.mjs';
import {createStandingRequestPreview} from './standing-request-guard.mjs';
import {ENVELOPE_SECURITY_REQUIRED,inspectProtectedRepositorySecurity} from '../../agent-os/check-demo-release.mjs';
const now=1793260000000;
const hash=x=>createHash('sha256').update(x).digest('hex');
const key=()=>{const p=generateKeyPairSync('ed25519');return {...p,pem:p.publicKey.export({type:'spki',format:'pem'}),digest:hash(p.publicKey.export({type:'spki',format:'der'}))};};
const signed=(p,k)=>{const payload=JSON.stringify(p);return {payload,signature:sign(null,Buffer.from(payload),k.privateKey).toString('base64')};};
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'standing-glue-')),repo=path.join(root,'repo'),state=path.join(root,'state-root');fs.mkdirSync(repo);fs.mkdirSync(state,{mode:0o700});
 const git=(...args)=>execFileSync('git',args,{cwd:repo,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 git('init');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
 for(const p of [...ENVELOPE_SECURITY_REQUIRED,'scripts/example.mjs']){fs.mkdirSync(path.dirname(path.join(repo,p)),{recursive:true});fs.writeFileSync(path.join(repo,p),'fixture '+p);}
 git('add','.');git('-c','core.hooksPath=/dev/null','commit','-m','base');const baseSha=git('rev-parse','HEAD');
 fs.writeFileSync(path.join(repo,'scripts/example.mjs'),'routine change');git('add','.');git('-c','core.hooksPath=/dev/null','commit','-m','routine');const headSha=git('rev-parse','HEAD');
 const comparison={repository:'ASI-integration/asi-landing',repoRoot:repo,baseSha,headSha},security=inspectProtectedRepositorySecurity(comparison),owner=key(),verifier=key();
 assert.equal(security.status,'PROTECTED_SECURITY_VERIFIED');
 const envelope={schema:'asi.release-envelope.proposal.v1',repo:comparison.repository,environment:'beget-staging',target:'pqukibofpo',appId:5514822,installationId:176281163,policyDigest:security.policyDigest,securityDigest:security.securityDigest,notBefore:now-1000,expiresAt:now+100000,action:'source',allowedPaths:['scripts/example.mjs'],maxOperations:10,maxRequests:10,maxWrites:3,paidApiUsd:0,verifierKeySha256:verifier.digest};
 const signedEnvelope=signed(envelope,owner),envelopeDigest=hash(signedEnvelope.payload),artifactDigest='f'.repeat(64);
 const request={action:'source',repo:envelope.repo,environment:envelope.environment,target:envelope.target,appId:envelope.appId,installationId:envelope.installationId,securityDigest:security.securityDigest,changedPaths:['scripts/example.mjs'],headSha,baseSha,artifactDigest,taskId:'source-task'};
 const signedEvidence=signed({schema:'asi.release-envelope-evidence.proposal.v1',changedPaths:request.changedPaths,envelopeDigest,policyDigest:security.policyDigest,revocation:'NOT_REVOKED',observedAt:now,headSha,baseSha,artifactDigest,ci:'SUCCESS',independentReview:'PASS',branchProtection:'PASS',usedOperations:0,paidApiUsd:0,taskId:request.taskId,claim:'UNCLAIMED',externalResult:'NONE'},verifier);
 const providerExpected={repository:envelope.repo,number:123,baseSha,headSha,independentReviewerId:1234};
 const bound={number:123,head:{sha:headSha},base:{sha:baseSha}};
 const pr={number:123,state:'open',base:{ref:'main',sha:baseSha,repo:{full_name:envelope.repo}},head:{sha:headSha,repo:{full_name:envelope.repo}},user:{id:4567}};
 const runs=[{workflow_id:311380800,event:'pull_request',head_sha:headSha},{workflow_id:390653294,event:'pull_request_target',head_sha:baseSha}].map((r,i)=>({...r,id:100+i,run_attempt:1,repository:{full_name:envelope.repo},pull_requests:[bound],status:'completed',conclusion:'success',updated_at:new Date(now).toISOString()}));
 const reviews=[{id:9,user:{id:1234},state:'APPROVED',commit_id:headSha,submitted_at:new Date(now).toISOString()}];
 const providerObservation={status:'PROVIDER_EVIDENCE_VERIFIED',authorized:false,snapshot:{pr,runs,reviews,expected:providerExpected,now},receipt:{observedAt:now}};
 const manifest={schema:'asi.release-envelope-revocations.v1',repository:envelope.repo,environment:envelope.environment,target:envelope.target,issuerKeySha256:owner.digest,verifierKeySha256:verifier.digest,sequence:1,issuedAt:now-1000,expiresAt:now+100000,revokedEnvelopeDigests:[]};
 const sr=signed(manifest,owner),prior={sequence:1,manifestDigest:hash(sr.payload),revokedEnvelopeDigests:[]};
 const expectedTrust={repository:envelope.repo,environment:envelope.environment,target:envelope.target,issuerKeySha256:owner.digest,verifierKeySha256:verifier.digest,envelopeDigest};
 const protectedReader=async p=>p.endsWith('owner-public.pem')?owner.pem:p.endsWith('standing-verifier-public.pem')?verifier.pem:JSON.stringify(sr);
 const input={signedEnvelope,signedEvidence,request,comparison,providerObservation,providerExpected,expectedTrust,clock:()=>now,protectedReader,isolatedPreview:true};
 const task={id:'source-task',sha:baseSha,repo:envelope.repo,branch:'fixture',stage:'S4-G1',pr:null};
 return {root,state,input,prior,task,close:()=>fs.rmSync(root,{recursive:true,force:true})};
}
const descriptor=(method='GET',route='branches/main')=>{const payloadSha256=digest('');return {method,route,payloadSha256,requestSha256:digest(JSON.stringify({method,route,payloadSha256}))};};
test('real signed trust/Git/provider model reserves pre-STARTED reads and STARTED writes under one real transaction, never admits transport',async()=>{
 const x=fixture();try{const store=await initializeState(x.state);let preview;
 const result=await store.execute('github-publisher',async({ledger,transaction})=>{ledger.standingRevocationCheckpoint=x.prior;preview=createStandingRequestPreview({...x.input,store,transaction});assert.equal(await preview.beforeRequest(),false);assert.equal((await preview.reserve(descriptor())).status,'RESERVED_PREVIEW');return x.task;},{verifyTask:async()=>({sha:x.task.sha})},async()=>{const r=await preview.reserve(descriptor('POST','git/trees'));assert.equal(r.status,'RESERVED_PREVIEW');assert.equal(r.authorized,false);assert.equal(r.taskSha,x.task.sha);return {status:'PASS'};});
 assert.equal(result.status,'PASS');const ledger=JSON.parse(fs.readFileSync(store.file('autopilot-ledger.json')));assert.equal(Object.keys(ledger.standingRequestBindings).length,2);assert.equal(Object.values(ledger.standingDelegationBudget.envelopes)[0].requests,2);assert.equal(ledger.standingRevocationCheckpoint.sequence,1);
 assert.equal((await preview.reserve(descriptor())).status,'BLOCKED');
 }finally{x.close();}
});
test('admission write, stale provider and missing history fail closed without budget',async()=>{
 for(const mode of ['write','stale','missing']){const x=fixture();try{const store=await initializeState(x.state);await store.execute('github-publisher',async({ledger,transaction})=>{if(mode!=='missing')ledger.standingRevocationCheckpoint=x.prior;if(mode==='stale')x.input.providerObservation.snapshot.reviews[0].state='DISMISSED';const p=createStandingRequestPreview({...x.input,store,transaction});assert.equal((await p.reserve(mode==='write'?descriptor('POST','git/trees'):descriptor())).status,'BLOCKED');assert.equal(ledger.standingDelegationBudget,undefined);return null;},{},()=>{});}finally{x.close();}}
});
test('live-root preview construction is always rejected before any trust read',()=>{
 assert.throws(()=>createStandingRequestPreview({store:{root:LIVE_ROOT},isolatedPreview:true}),/STANDING_TRANSACTION_INVALID/);
});

test('expiry after reservation denies and retains spent claim',async()=>{
 const x=fixture();try{const store=await initializeState(x.state);let calls=0;
  await store.execute('github-publisher',async({ledger,transaction})=>{
   ledger.standingRevocationCheckpoint=x.prior;
   // The final trust reread happens only after the real budget commit.
   const protectedReader=async p=>{calls++;return x.input.protectedReader(p);};
   const clock=()=>calls>6?now+100001:now;
   const preview=createStandingRequestPreview({...x.input,store,transaction,clock,protectedReader});
   assert.equal((await preview.reserve(descriptor())).status,'BLOCKED');
   assert.equal(Object.values(ledger.standingDelegationBudget.envelopes)[0].requests,1);
   assert.equal(Object.keys(ledger.standingRequestBindings).length,1);return null;
  },{},()=>{});
 }finally{x.close();}
});
test('caller store facade cannot redirect journal or lock paths outside authenticated lease',async()=>{
 const x=fixture();try{const store=await initializeState(x.state),external=path.join(x.root,'external');fs.mkdirSync(external);let called=false;
  await store.execute('github-publisher',async({ledger,transaction})=>{
   ledger.standingRevocationCheckpoint=x.prior;
   const facade={root:store.root,file(name){called=true;return path.join(external,name);}};
   const preview=createStandingRequestPreview({...x.input,store:facade,transaction});
   assert.equal((await preview.reserve(descriptor())).status,'RESERVED_PREVIEW');
   assert.equal(called,false);assert.deepEqual(fs.readdirSync(external),[]);
   const disk=JSON.parse(fs.readFileSync(store.file('autopilot-ledger.json')));
   assert.equal(Object.values(disk.standingDelegationBudget.envelopes)[0].requests,1);return null;
  },{},()=>{});
 }finally{x.close();}
});

test('accessor root facade is rejected without invoking its getter',async()=>{
 const x=fixture();try{const store=await initializeState(x.state);let called=false;
  await store.execute('github-publisher',async({ledger,transaction})=>{
   ledger.standingRevocationCheckpoint=x.prior;
   const facade={get root(){called=true;return store.root;},file:store.file};
   assert.throws(()=>createStandingRequestPreview({...x.input,store:facade,transaction}),/STANDING_STORE_MISMATCH/);
   assert.equal(called,false);assert.equal(ledger.standingDelegationBudget,undefined);return null;
  },{},()=>{});
 }finally{x.close();}
});
