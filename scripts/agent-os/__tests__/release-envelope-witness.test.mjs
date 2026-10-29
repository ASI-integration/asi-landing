import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initializeState, existingState } from '../../strigunov4/execution-adapters/state.mjs';
import { generateKeyPairSync, createHash, sign } from 'node:crypto';
import { assessWitnessedReleaseEnvelopeProposal as assess, assessRepositoryReleaseEnvelopeProposal as assessRepository, inspectAuthenticatedProviderSnapshot as provider } from '../check-demo-release.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
const key=()=>{const p=generateKeyPairSync('ed25519');return {...p,pem:p.publicKey.export({type:'spki',format:'pem'}),digest:hash(p.publicKey.export({type:'spki',format:'der'}))};};
const signed=(payload,k)=>{payload=JSON.stringify(payload);return {payload,signature:sign(null,Buffer.from(payload),k.privateKey).toString('base64')};};
function fixture(){
 const owner=key(),verifier=key(),d='b'.repeat(64),h='a'.repeat(40);
 const envelope={schema:'asi.release-envelope.proposal.v1',repo:'ASI-integration/asi-landing',environment:'beget-staging',target:'pqukibofpo',appId:5514822,installationId:176281163,policyDigest:d,securityDigest:d,notBefore:0,expiresAt:2000,action:'source',allowedPaths:['scripts/example.mjs'],maxOperations:2,paidApiUsd:0,verifierKeySha256:verifier.digest};
 const signedEnvelope=signed(envelope,owner);
 const evidence={schema:'asi.release-envelope-evidence.proposal.v1',changedPaths:['scripts/example.mjs'],envelopeDigest:hash(signedEnvelope.payload),policyDigest:d,revocation:'NOT_REVOKED',observedAt:1000,headSha:h,baseSha:h,artifactDigest:d,ci:'SUCCESS',independentReview:'PASS',branchProtection:'PASS',usedOperations:0,paidApiUsd:0,taskId:'task-1',claim:'UNCLAIMED',externalResult:'NONE'};
 const request={action:'source',repo:envelope.repo,environment:envelope.environment,target:envelope.target,appId:envelope.appId,installationId:envelope.installationId,securityDigest:d,changedPaths:['scripts/example.mjs'],headSha:h,baseSha:h,artifactDigest:d,taskId:'task-1'};
 return {owner,verifier,envelope,evidence,request,now:1000,signedEnvelope,signedEvidence:signed(evidence,verifier),trustedPublicKey:owner.pem,verifierPublicKey:verifier.pem};
}
test('independent signed evidence and unchanged envelope allow refreshed HEAD only after new witness',()=>{
 const x=fixture();assert.equal(assess(x).status,'PROPOSAL_ELIGIBLE');
 const old=x.signedEnvelope;x.request.headSha='c'.repeat(40);
 assert.equal(assess(x).reason,'ENVELOPE_EXACT_EVIDENCE');
 x.evidence.headSha=x.request.headSha;x.signedEvidence=signed(x.evidence,x.verifier);
 assert.equal(assess(x).status,'PROPOSAL_ELIGIBLE');assert.equal(assess(x).authorized,false);assert.equal(x.signedEnvelope,old);
});
test('unbound verifier and self-reviewed owner are denied',()=>{
 const x=fixture();x.verifierPublicKey=key().pem;assert.equal(assess(x).reason,'ENVELOPE_VERIFIER_IDENTITY');
 x.verifierPublicKey=x.owner.pem;x.envelope.verifierKeySha256=x.owner.digest;x.signedEnvelope=signed(x.envelope,x.owner);
 assert.equal(assess(x).reason,'ENVELOPE_VERIFIER_IDENTITY');
});
test('witness tampering and witness from a different envelope denied',()=>{
 const x=fixture();x.signedEvidence.payload=x.signedEvidence.payload.replace('SUCCESS','FAILURE');assert.equal(assess(x).reason,'ENVELOPE_WITNESS_SIGNATURE');
 x.evidence.envelopeDigest='f'.repeat(64);x.signedEvidence=signed(x.evidence,x.verifier);assert.equal(assess(x).reason,'ENVELOPE_WITNESS_BINDING');
});
test('signed stale/revoked evidence, exhausted budget and UNKNOWN still denied',()=>{
 for(const [k,v] of [['observedAt',999],['revocation','REVOKED'],['usedOperations',2],['claim','FAILED_LOCKED']]){
 const x=fixture();x.evidence[k]=v;x.signedEvidence=signed(x.evidence,x.verifier);assert.equal(assess(x).status,'BLOCKED');}
});

test('isolated existing ledger supplies durable budget across two distinct tasks and reopen',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'asi-envelope-budget-'));
 try {
  let store=await initializeState(root);const x=fixture();let effects=0;
  const run=async id=>store.execute('envelope-proposal',async({ledger})=>{
   // Test-only verifier observes the ledger while the existing lock is held.
   const used=Object.values(ledger.jobs).filter(j=>j.kind==='envelope-proposal').length;
   x.request.taskId=id;x.evidence.taskId=id;x.evidence.usedOperations=used;
   x.signedEvidence=signed(x.evidence,x.verifier);
   if(assess(x).status!=='PROPOSAL_ELIGIBLE')return null;
   return {id,sha:x.request.headSha,pr:null,branch:'fixture',stage:'S4-G1',repo:x.request.repo};
  },{verifyTask:async t=>({sha:t.sha})},async()=>{effects++;return {status:'PASS',authorized:false};});
  assert.equal((await run('first-task')).mode,'REPORT_READY');
  store=await existingState(root);
  assert.equal((await run('second-task')).mode,'REPORT_READY');
  store=await existingState(root);
  assert.equal((await run('third-task')).mode,'WAITING');assert.equal(effects,2);
  assert.equal(JSON.parse(fs.readFileSync(store.file('receipts.json'))).completed.length,2);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});


test('signed path inventory rejects omitted protected paths and unsigned substitutions',()=>{
 const x=fixture();x.evidence.changedPaths.push('.github/workflows/pr-validation.yml');
 x.signedEvidence=signed(x.evidence,x.verifier);
 assert.equal(assess(x).reason,'ENVELOPE_WITNESS_PATHS');
 x.request.changedPaths=[...x.evidence.changedPaths];
 assert.equal(assess(x).reason,'ENVELOPE_PROTECTED_CHANGE');
 const y=fixture();y.request.changedPaths=['scripts/other.mjs'];
 assert.equal(assess(y).reason,'ENVELOPE_WITNESS_PATHS');
});
test('missing signed inventory fails closed and tampering invalidates witness',()=>{
 const x=fixture();delete x.evidence.changedPaths;x.signedEvidence=signed(x.evidence,x.verifier);
 assert.equal(assess(x).reason,'ENVELOPE_WITNESS_PATHS');
 const y=fixture();y.signedEvidence.payload=y.signedEvidence.payload.replace('scripts/example.mjs','scripts/other.mjs');
 assert.equal(assess(y).reason,'ENVELOPE_WITNESS_SIGNATURE');
});
test('signed invalid path inventories remain subject to existing path validation',()=>{
 for(const paths of [[],['../scripts/example.mjs'],['scripts/example.mjs','scripts/example.mjs']]){
  const x=fixture();x.evidence.changedPaths=paths;x.request.changedPaths=paths;
  x.signedEvidence=signed(x.evidence,x.verifier);
  assert.equal(assess(x).reason,'ENVELOPE_PROTECTED_CHANGE');assert.equal(assess(x).authorized,false);
 }
});


test('witnessed proposal rejects changed base with unchanged head',()=>{
 const x=fixture();x.request.baseSha='c'.repeat(40);
 assert.equal(assess(x).reason,'ENVELOPE_EXACT_EVIDENCE');assert.equal(assess(x).authorized,false);
});
function repositoryFixture(run){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'asi-envelope-diff-'));
 const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 try {
  git('init');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
  fs.mkdirSync(path.join(root,'scripts'));fs.mkdirSync(path.join(root,'.github'));
  fs.writeFileSync(path.join(root,'scripts/example.mjs'),'old');fs.writeFileSync(path.join(root,'.github/protected.yml'),'protected');
  git('add','.');git('-c','core.hooksPath=/dev/null','commit','-m','base');const baseSha=git('rev-parse','HEAD');
  run({root,git,baseSha});
 }finally{fs.rmSync(root,{recursive:true,force:true});}
}
function boundFixture(root,baseSha,headSha,paths){
 const x=fixture();Object.assign(x.request,{baseSha,headSha,changedPaths:paths});
 Object.assign(x.evidence,{baseSha,headSha,changedPaths:paths});x.signedEvidence=signed(x.evidence,x.verifier);
 return [x,{repository:x.request.repo,repoRoot:root,baseSha,headSha}];
}
test('protected-base Git inventory admits routine new heads only with fresh bound witness',()=>repositoryFixture(({root,git,baseSha})=>{
 fs.writeFileSync(path.join(root,'scripts/example.mjs'),'new');git('add','.');git('-c','core.hooksPath=/dev/null','commit','-m','routine');
 const args=boundFixture(root,baseSha,git('rev-parse','HEAD'),['scripts/example.mjs']);
 assert.equal(assessRepository(...args).status,'PROPOSAL_ELIGIBLE');assert.equal(assessRepository(...args).authorized,false);
 args[0].request.headSha='f'.repeat(40);assert.equal(assessRepository(...args).reason,'ENVELOPE_TRUSTED_COMPARISON');
}));
test('real rename cannot hide protected source even with a signed incomplete inventory',()=>repositoryFixture(({root,git,baseSha})=>{
 git('mv','.github/protected.yml','scripts/renamed.mjs');git('-c','core.hooksPath=/dev/null','commit','-m','rename');
 const args=boundFixture(root,baseSha,git('rev-parse','HEAD'),['scripts/renamed.mjs']);
 assert.equal(assessRepository(...args).reason,'ENVELOPE_DIFF_INVENTORY');
 const full=['.github/protected.yml','scripts/renamed.mjs'];args[0].request.changedPaths=full;args[0].evidence.changedPaths=full;
 args[0].signedEvidence=signed(args[0].evidence,args[0].verifier);
 assert.equal(assessRepository(...args).reason,'ENVELOPE_PROTECTED_CHANGE');
}));
test('missing trusted commit fails closed without conflating diff and signature failures',()=>repositoryFixture(({root,baseSha})=>{
 const args=boundFixture(root,baseSha,'f'.repeat(40),['scripts/example.mjs']);
 assert.equal(assessRepository(...args).reason,'ENVELOPE_DIFF_UNAVAILABLE');
 args[1].repository='other/repo';assert.equal(assessRepository(...args).reason,'ENVELOPE_TRUSTED_COMPARISON');
}));

function providerFixture() {
 const repo='ASI-integration/asi-landing';
 const baseSha='a'.repeat(40),headSha='c'.repeat(40);
 const now=Date.parse('2026-10-29T07:15:00.000Z');
 const expected={repository:repo,number:552,baseSha,headSha,independentReviewerId:20261029};
 const pullRef={number:552,head:{sha:headSha},base:{sha:baseSha}};
 const pr={number:552,state:'open',user:{id:207600140},
  head:{sha:headSha,repo:{full_name:repo}},
  base:{ref:'main',sha:baseSha,repo:{full_name:repo}}};
 const workflows=[
  {id:2,workflow_id:311380800,event:'pull_request',head_sha:headSha},
  {id:3,workflow_id:390653294,event:'pull_request_target',head_sha:baseSha},
 ].map(run=>({...run,run_attempt:1,status:'completed',conclusion:'success',
   repository:{full_name:repo},pull_requests:[pullRef],
   updated_at:'2026-10-29T07:14:00.000Z'}));
 const reviews=[{state:'APPROVED',commit_id:headSha,user:{id:expected.independentReviewerId},
   submitted_at:'2026-10-29T07:14:30.000Z'}];
 return {pr,runs:workflows,reviews,expected,now};
}
test('provider snapshots need both required workflow identities and independent exact-head review',()=>{
 const x=providerFixture();
 assert.deepEqual(provider(x),{status:'PROVIDER_EVIDENCE_VERIFIED',authorized:false});
 const next=structuredClone(x);next.expected.headSha='f'.repeat(40);
 assert.equal(provider(next).reason,'PROVIDER_PR_IDENTITY');
});
test('latest failed job or spoofed workflow cannot be treated as success',()=>{
 const x=providerFixture();x.runs.push({...x.runs[0],id:4,conclusion:'failure'});
 assert.equal(provider(x).reason,'PROVIDER_WORKFLOW_NOT_GREEN');
 x.runs.pop();x.runs[0].workflow_id=123;
 assert.equal(provider(x).reason,'PROVIDER_WORKFLOW_IDENTITY');
});
test('owner self-review, dismissed review and old SHA never establish independence',()=>{
 const x=providerFixture();x.expected.independentReviewerId=207600140;
 assert.equal(provider(x).reason,'PROVIDER_PR_IDENTITY');
 x.expected.independentReviewerId=20261029;x.reviews[0].state='DISMISSED';
 assert.equal(provider(x).reason,'PROVIDER_INDEPENDENT_REVIEW');
 x.reviews[0].state='APPROVED';x.reviews[0].commit_id='e'.repeat(40);
 assert.equal(provider(x).reason,'PROVIDER_INDEPENDENT_REVIEW');
});
test('missing provider PR association and stale run fail closed',()=>{
 const x=providerFixture();x.runs[0].pull_requests=[];
 assert.equal(provider(x).reason,'PROVIDER_WORKFLOW_IDENTITY');
 x.runs[0].pull_requests=x.runs[1].pull_requests;
 x.runs[0].updated_at='2026-10-29T04:00:00.000Z';
 assert.equal(provider(x).reason,'PROVIDER_WORKFLOW_STALE');
});
