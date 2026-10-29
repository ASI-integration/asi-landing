import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initializeState, existingState } from '../../strigunov4/execution-adapters/state.mjs';
import { generateKeyPairSync, createHash, sign } from 'node:crypto';
import { assessWitnessedReleaseEnvelopeProposal as assess, assessRepositoryReleaseEnvelopeProposal as assessRepository, inspectAuthenticatedProviderSnapshot as provider, readAuthenticatedProviderSnapshot as readProvider, inspectProtectedRepositorySecurity as inspectSecurity, ENVELOPE_SECURITY_REQUIRED } from '../check-demo-release.mjs';
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
test('signed future/revoked evidence, exhausted budget and UNKNOWN still denied',()=>{
 for(const [k,v] of [['observedAt',1001],['revocation','REVOKED'],['usedOperations',2],['claim','FAILED_LOCKED']]){
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
  for(const p of ENVELOPE_SECURITY_REQUIRED) {
   fs.mkdirSync(path.dirname(path.join(root,p)),{recursive:true});fs.writeFileSync(path.join(root,p),'fixture protected '+p);
  }
  git('add','.');git('-c','core.hooksPath=/dev/null','commit','-m','base');const baseSha=git('rev-parse','HEAD');
  run({root,git,baseSha});
 }finally{fs.rmSync(root,{recursive:true,force:true});}
}
function boundFixture(root,baseSha,headSha,paths){
 const x=fixture();Object.assign(x.request,{baseSha,headSha,changedPaths:paths});
 const security=inspectSecurity({repoRoot:root,baseSha,headSha:baseSha});
 Object.assign(x.envelope,{securityDigest:security.securityDigest,policyDigest:security.policyDigest});
 x.request.securityDigest=security.securityDigest;x.evidence.policyDigest=security.policyDigest;
 x.signedEnvelope=signed(x.envelope,x.owner);x.evidence.envelopeDigest=hash(x.signedEnvelope.payload);
 Object.assign(x.evidence,{baseSha,headSha,changedPaths:paths});x.signedEvidence=signed(x.evidence,x.verifier);
 return [x,{repository:x.request.repo,repoRoot:root,baseSha,headSha}];
}
test('protected-base Git inventory admits routine new heads only with fresh bound witness',()=>repositoryFixture(({root,git,baseSha})=>{
 fs.writeFileSync(path.join(root,'scripts/example.mjs'),'new');git('add','.');git('-c','core.hooksPath=/dev/null','commit','-m','routine');
 const args=boundFixture(root,baseSha,git('rev-parse','HEAD'),['scripts/example.mjs']);
 assert.equal(assessRepository(...args).status,'PROPOSAL_ELIGIBLE');assert.equal(assessRepository(...args).authorized,false);
 args[0].request.headSha='f'.repeat(40);assert.equal(assessRepository(...args).reason,'ENVELOPE_TRUSTED_COMPARISON');
}));

test('protected-base digest rejects changed authority, missing required path and symlink',()=>{
 for(const operation of ['change','delete','symlink']) repositoryFixture(({root,git,baseSha})=>{
  const file=path.join(root,'scripts/strigunov4/execution-adapters/host-authority.mjs');
  if(operation==='change')fs.writeFileSync(file,'changed');
  else {fs.unlinkSync(file);if(operation==='symlink')fs.symlinkSync('host-runtime.mjs',file);}
  git('add','.');git('-c','core.hooksPath=/dev/null','commit','-m',operation);
  const result=inspectSecurity({repoRoot:root,baseSha,headSha:git('rev-parse','HEAD')});
  assert.equal(result.status,'BLOCKED');assert.equal(result.authorized,false);
 });
});
test('repository proposal requires signed digest of actual protected base',()=>repositoryFixture(({root,git,baseSha})=>{
 fs.writeFileSync(path.join(root,'scripts/example.mjs'),'new');git('add','.');git('-c','core.hooksPath=/dev/null','commit','-m','routine');
 const args=boundFixture(root,baseSha,git('rev-parse','HEAD'),['scripts/example.mjs']);
 args[0].envelope.securityDigest='0'.repeat(64);args[0].signedEnvelope=signed(args[0].envelope,args[0].owner);
 assert.equal(assessRepository(...args).reason,'ENVELOPE_SECURITY_DIGEST');
}));
test('repository proposal returns BLOCKED for correctly signed null rather than throwing',()=>repositoryFixture(({root,git,baseSha})=>{
 fs.writeFileSync(path.join(root,'scripts/example.mjs'),'new');git('add','.');git('-c','core.hooksPath=/dev/null','commit','-m','routine');
 const args=boundFixture(root,baseSha,git('rev-parse','HEAD'),['scripts/example.mjs']);
 args[0].signedEnvelope=signed(null,args[0].owner);
 assert.equal(assessRepository(...args).reason,'ENVELOPE_SECURITY_DIGEST');
}));
test('advanced repository and request cannot reuse the previous HEAD witness',()=>repositoryFixture(({root,git,baseSha})=>{
 fs.writeFileSync(path.join(root,'scripts/example.mjs'),'new');git('add','.');git('-c','core.hooksPath=/dev/null','commit','-m','routine');
 const args=boundFixture(root,baseSha,git('rev-parse','HEAD'),['scripts/example.mjs']);
 fs.writeFileSync(path.join(root,'scripts/example.mjs'),'newer');git('add','.');git('-c','core.hooksPath=/dev/null','commit','-m','next');
 args[0].request.headSha=args[1].headSha=git('rev-parse','HEAD');
 assert.equal(assessRepository(...args).reason,'ENVELOPE_EXACT_EVIDENCE');
 assert.equal(assessRepository(...args).authorized,false);
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
 const reviews=[{id:10,state:'APPROVED',commit_id:headSha,user:{id:expected.independentReviewerId},
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
test('newer unbound workflow cannot be hidden behind historical bound success',()=>{
 for(const links of [[],[{number:999,head:{sha:'c'.repeat(40)},base:{sha:'a'.repeat(40)}}]]) {
  const x=providerFixture();x.runs.push({...x.runs[0],id:4,pull_requests:links,conclusion:'failure'});
  assert.equal(provider(x).reason,'PROVIDER_WORKFLOW_IDENTITY');
 }
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

test('newer change request and aged approval supersede historical PASS',()=>{
 const x=providerFixture();
 x.reviews.push({...x.reviews[0],id:11,state:'CHANGES_REQUESTED',submitted_at:'2026-10-29T07:14:45.000Z'});
 assert.equal(provider(x).reason,'PROVIDER_INDEPENDENT_REVIEW');
 x.reviews.pop();x.reviews[0].submitted_at='2026-10-28T07:14:30.000Z';
 assert.equal(provider(x).reason,'PROVIDER_INDEPENDENT_REVIEW');
});
function readerFixture(change = () => {}) {
 const x=providerFixture(), calls=[];
 const fetchImpl=async(url,options)=>{
  calls.push({url,options});
  const u=new URL(url);let value;
  if(u.pathname.endsWith('/reviews')) value=x.reviews;
  else if(u.pathname.includes('/actions/workflows/')) {
   const id=Number(u.pathname.split('/').at(-2));
   const runs=x.runs.filter(r=>r.workflow_id===id);
   value={total_count:runs.length,workflow_runs:runs};
  } else value=x.pr;
  const response=change({url:u,value,calls,x});
  return response || new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
 };
 return {x,calls,input:{token:'offline-fixture-token',expected:x.expected,clock:()=>x.now,fetchImpl}};
}
test('reader obtains bounded authenticated GET observations and never authority',async()=>{
 const f=readerFixture();const result=await readProvider(f.input);
 assert.equal(result.status,'PROVIDER_EVIDENCE_VERIFIED');assert.equal(result.authorized,false);
 assert.equal(result.receipt.requests,5);assert.equal(result.receipt.writes,0);
 assert(!JSON.stringify(result).includes(f.input.token));
 for(const {url,options} of f.calls) {
  assert(url.startsWith('https://api.github.com/repos/ASI-integration/asi-landing/'));
  assert.equal(options.method,'GET');assert.equal(options.redirect,'error');
  assert.equal(options.headers.Authorization,'Bearer '+f.input.token);assert(options.signal);
 }
});
test('reader blocks authentication failure and redirect without retries or leaked body',async()=>{
 for(const status of [302,401,403,429,500]) {
  const f=readerFixture(()=>new Response('private transport details',{status}));
  assert.deepEqual(await readProvider(f.input),{status:'BLOCKED',reason:'PROVIDER_READER_HTTP',authorized:false});
  assert.equal(f.calls.length,1);
 }
 const f=readerFixture();f.input.fetchImpl=async()=>{throw new Error(f.input.token);};
 assert.equal((await readProvider(f.input)).reason,'PROVIDER_READER_UNAVAILABLE');
});
test('reader refuses incomplete, truncated, duplicate or changing page inventories',async()=>{
 for(const alter of [v=>{v.total_count=2;},v=>{v.total_count=300;},
  v=>{v.workflow_runs.push(v.workflow_runs[0]);v.total_count=2;}]) {
  const f=readerFixture(({value,url})=>{if(url.pathname.includes('/workflows/'))alter(value);});
  assert.equal((await readProvider(f.input)).reason,'PROVIDER_READER_INCOMPLETE');
 }
 const f=readerFixture(({url,value})=>{
  if(url.pathname.includes('/workflows/')) {
   value.total_count=url.searchParams.get('page')==='1'?101:102;
   value.workflow_runs=Array.from({length:url.searchParams.get('page')==='1'?100:2},(_,i)=>({...value.workflow_runs[0],id:i+100}));
  }
 });
 assert.equal((await readProvider(f.input)).reason,'PROVIDER_READER_INCOMPLETE');
});
test('reader paginates reviews completely so later denial is not hidden',async()=>{
 const f=readerFixture(({url,value})=>{
  if(url.pathname.endsWith('/reviews')) {
   const review=value[0];
   return new Response(JSON.stringify(url.searchParams.get('page')==='1'
    ? Array.from({length:100},(_,i)=>({...review,id:i+1}))
    : [{...review,id:101,state:'CHANGES_REQUESTED',submitted_at:'2026-10-29T07:14:45.000Z'}]),
    {headers:{'Content-Type':'application/json'}});
  }
 });
 assert.equal((await readProvider(f.input)).reason,'PROVIDER_INDEPENDENT_REVIEW');
 assert.equal(f.calls.length,6);
});
test('reader rechecks PR identity and rejects concurrent head/base movement',async()=>{
 for(const side of ['head','base']) {
  const f=readerFixture(({calls,x,url})=>{
   if(calls.length===5 && url.pathname.endsWith('/552')) {
    const value=structuredClone(x.pr);value[side].sha='e'.repeat(40);
    return new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
   }
  });
  assert.equal((await readProvider(f.input)).reason,'PROVIDER_PR_IDENTITY');
 }
});
test('reader bounds bytes/time and refuses caller-controlled repository before network',async()=>{
 const f=readerFixture(()=>new Response(' '.repeat(2*1024*1024+1),{headers:{'Content-Type':'application/json'}}));
 assert.equal((await readProvider(f.input)).reason,'PROVIDER_READER_RESPONSE');
 const g=readerFixture();let ticks=0;g.input.clock=()=>g.x.now+(ticks++ ? 30001:0);
 assert.equal((await readProvider(g.input)).reason,'PROVIDER_READER_BUDGET');assert.equal(g.calls.length,0);
 const h=readerFixture();h.input.expected={...h.input.expected,repository:'other/repo'};
 assert.equal((await readProvider(h.input)).reason,'PROVIDER_READER_CONTEXT');assert.equal(h.calls.length,0);
});
