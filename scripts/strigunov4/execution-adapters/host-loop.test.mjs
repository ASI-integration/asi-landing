import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {generateKeyPairSync,sign} from 'node:crypto';
import {verifySignedArtifact,validateHostRequest,ENGINE_ROOT,LEGACY_STATE} from './host-authority.mjs';
import {hostLoopOptions} from './host-runtime.mjs';
import {buildRuntimeClosure} from './host-package.mjs';
import {verifyOwnerStageDecision,stagePolicyHash} from './stage-authority.mjs';
import {digest} from './state.mjs';
import {closedFixture,makeClosedLoop,tick} from './closed-loop-fixture.mjs';
const repo='ASI-integration/asi-landing',base='a'.repeat(40),hash='b'.repeat(64);
const now=()=>Date.now();
function payload(){
 const p={schema:'asi.engine-activation.v1',repo,root:ENGINE_ROOT,legacyStateDir:LEGACY_STATE,
  stage:'S4-G1',host:'asi-agent-runner',service:'asi-strigunov-agent.service',ownerApprovalId:'TEST_ONLY',
  githubApp:{appId:123,installationId:456},ciPolicies:[{name:'validate',workflowId:311380800},
  {name:'release_governance',workflowId:390653294,event:'pull_request_target'}],
  notBefore:now()-1000,expiresAt:now()+86400000,runnerSha256:hash,catalogSha256:hash,
  baseSha:base,automaticCiApproved:true,automaticReviewApproved:true};
 p.closedLoop={intervalMs:600000,maxTicks:100,reviewMode:'coderabbit',policy:{schema:'asi.stage-authority.v1',
  repository:repo,stage:'S4-G1',issue:511,baseSha:base,notBefore:p.notBefore,expiresAt:p.expiresAt,
  tasks:[{id:'actual-task',workOrderId:'actual-order',branch:'asi/engine-task/actual-task',baseSha:base,
   paths:['scripts/strigunov4/test_c4_unit_readonly.py'],operations:['create-tree','create-commit','create-branch','create-draft-pr']}]}};
 return p;
}
function verify(p){const k=generateKeyPairSync('ed25519'),raw=JSON.stringify(p);return verifySignedArtifact(
 {payload:raw,signature:sign(null,Buffer.from(raw),k.privateKey).toString('base64')},k.publicKey.export({type:'spki',format:'pem'}));}
test('signed host options wire native CodeRabbit and fixed routing without new authority',()=>{
 const p=verify(payload()),o=hostLoopOptions(p,{});
 assert.equal(o.intervalMs,600000);assert.equal(o.closedLoop.stateDir,ENGINE_ROOT+'/routing');
 assert.equal(o.closedLoop.policy,p.closedLoop.policy);assert.equal(o.publishedReview,undefined);
 const old=payload();delete old.closedLoop;assert.deepEqual(hostLoopOptions(verify(old),{}),{});
 for(const change of [p=>p.host='pqukibofpo',p=>p.stage='S4-G2',p=>p.closedLoop.reviewMode='skip',
  p=>p.closedLoop.intervalMs=15000,p=>p.closedLoop.maxTicks=101,p=>p.closedLoop.extra=true,
  p=>p.closedLoop.policy.baseSha='c'.repeat(40),p=>p.closedLoop.policy.expiresAt++,
  p=>{p.expiresAt+=14*86400000;p.closedLoop.policy.expiresAt=p.expiresAt;}]){
  const bad=payload();change(bad);assert.throws(()=>verify(bad));
 }
});
test('native host capability cannot authorize a source-selected alternative reviewer',()=>{
 const p=payload(),c=[{id:'actual-task',branch:'asi/engine-task/actual-task',changes:[{path:'scripts/strigunov4/test_c4_unit_readonly.py'}]}];
 const request={taskId:c[0].id,taskBinding:digest(JSON.stringify(c[0])),repo,baseSha:base,stage:'S4-G1',
  branch:c[0].branch,paths:c[0].changes.map(c=>c.path),operations:['create-tree','create-commit','create-branch','create-draft-pr']};
 validateHostRequest(p,c,request);
 assert.throws(()=>validateHostRequest(p,c,{...request,reviewPolicySha256:hash}),/REVIEW_POLICY_NOT_ADMITTED/);
 assert.throws(()=>validateHostRequest(p,c,{...request,branch:'main'}),/TASK_AUTHORITY/);
});
test('real reader port fetches exact issue/comment identities and rechecks revocation',async()=>{
 const p=verify(payload()),url=`https://api.github.com/repos/${repo}/issues/511`,calls=[];
 let issue={number:511,state:'open',url},comments=[{id:12,issue_url:url,user:{id:207600140},
  created_at:new Date(p.notBefore).toISOString(),updated_at:new Date(p.notBefore).toISOString(),
  body:'ASI-OWNER-STAGE-APPROVE:S4-G1:511:'+stagePolicyHash(p.closedLoop.policy)}];
 const reader={get:async r=>{calls.push(r);return issue;},pages:async r=>{calls.push(r);return comments;}};
 const {readTrustedComments}=hostLoopOptions(p,reader).closedLoop;
 await verifyOwnerStageDecision(p.closedLoop.policy,{readTrustedComments});
 assert.deepEqual(calls,['issues/511','issues/511/comments']);
 comments=[];await assert.rejects(verifyOwnerStageDecision(p.closedLoop.policy,{readTrustedComments}),/NOT_VERIFIED/);
 for(const bad of [{...issue,url:url.replace('ASI-integration','foreign')},{...issue,pull_request:{}},{...issue,state:'closed'}]){
  issue=bad;await assert.rejects(readTrustedComments({repository:repo,issue:511}),/IDENTITY/);
 }
 await assert.rejects(readTrustedComments({repository:repo,issue:512}),/SCOPE/);
});
test('reader refuses foreign comments, unavailable source and forged owner identity',async()=>{
 const p=verify(payload()),url=`https://api.github.com/repos/${repo}/issues/511`;
 const reader={get:async()=>({number:511,state:'open',url}),pages:async()=>[{id:12,issue_url:url+'/wrong'}]};
 const {readTrustedComments}=hostLoopOptions(p,reader).closedLoop;
 await assert.rejects(readTrustedComments({repository:repo,issue:511}),/IDENTITY/);
 reader.pages=async()=>[{id:12,issue_url:url,user:{id:1},body:'ASI-OWNER-STAGE-APPROVE:S4-G1:511:'+stagePolicyHash(p.closedLoop.policy),created_at:new Date(p.notBefore).toISOString(),updated_at:new Date(p.notBefore).toISOString()}];
 await assert.rejects(verifyOwnerStageDecision(p.closedLoop.policy,{readTrustedComments}),/NOT_VERIFIED/);
 reader.pages=async()=>{throw Error('UNAVAILABLE');};
 await assert.rejects(verifyOwnerStageDecision(p.closedLoop.policy,{readTrustedComments}),/UNAVAILABLE/);
});
test('closed loop without alternative port still requires actual CodeRabbit evidence',async t=>{
 const f=await closedFixture(t,{ci:'pending'});
 const loop=await makeClosedLoop(f,{publishedReview:undefined});
 assert.equal((await tick(loop)).mode,'WAITING');
 const writes=f.writes.length;f.now.value+=180001;f.state.ci='success';
 const r=await tick(loop);assert.equal(r.mode,'REPORT_READY');assert.equal(f.writes.length,writes);
});
test('native review skip cannot promote a published PR',async t=>{
 const f=await closedFixture(t,{review:'Review skipped'});
 const r=await tick(await makeClosedLoop(f,{publishedReview:undefined}));
 assert.equal(r.mode,'FAILED_LOCKED');
 const writes=f.writes.length;f.now.value+=180001;
 assert.equal((await tick(await makeClosedLoop(f,{publishedReview:undefined}))).mode,'FAILED_LOCKED');
 assert.equal(f.writes.length,writes);
});
test('runtime source closure includes sibling Dispatcher, resolves imports and never installs',async t=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'asi-runtime-source-'));t.after(()=>fs.rm(temp,{recursive:true,force:true}));
 const repository=fileURLToPath(new URL('../../..',import.meta.url));
 const out=path.join(temp,'closure');const m=await buildRuntimeClosure({repository,output:out});
 assert.equal(m.installable,false);assert.ok(m.files['global-dispatcher/dispatcher.mjs']);
 for(const [file,h] of Object.entries(m.files))assert.equal(digest(await fs.readFile(path.join(out,'scripts',file))),h);
 assert.equal(typeof (await import(pathToFileURL(path.join(out,m.entry)).href)).engineIteration,'function');
 assert.equal((await fs.readdir(out)).sort().join(','),'manifest.json,scripts');
 await assert.rejects(buildRuntimeClosure({repository,output:out}),{code:'EEXIST'});
});
