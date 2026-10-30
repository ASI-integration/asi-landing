import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync,spawn} from 'node:child_process';
import {generateKeyPairSync,sign} from 'node:crypto';
import {closedFixture,makeClosedLoop,tick,readState} from './closed-loop-fixture.mjs';
import {once} from 'node:events';
import {createRequestBudget} from './host-runtime.mjs';
import {BEGET,verifyBegetActivation} from './host-authority.mjs';
import {stagePolicyHash,validateStagePolicy} from './stage-authority.mjs';
import {prepareDelta} from './change-preparer.mjs';
import {runContinuousWorker} from '../ASI-STRIGUNOV4-RUNNER-BRIDGE-20261020.mjs';
import {createBegetChecks,sandboxArguments} from './host-checks.mjs';
import {digest} from './state.mjs';
import {draftBody} from './publisher-transport.mjs';
import {OWNER_LANES,projectOwnerLaneAdmission} from './owner-lanes.mjs';
const advance=f=>{f.now.value+=600000;};
async function setup(t,options={}){
 const f=await closedFixture(t,{beget:true,distinctWorkOrders:true,...options});
 f.closedLoop.continuous=true;f.closedLoop.maxTicks=4;
 f.runChecks=async e=>{
  const cwd=path.join(f.root,'scratchpads',e.taskId,'scripts/strigunov4'),testModule='test_'+e.taskId.replaceAll('-','_');
  execFileSync('/usr/bin/python3',['-I','-S','-B','-c',`import sys,unittest;sys.path.insert(0,'.');s=unittest.defaultTestLoader.loadTestsFromName('${testModule}');r=unittest.TextTestRunner().run(s);assert r.wasSuccessful() and r.testsRun>0`],{cwd,timeout:5000,stdio:'pipe'});
  return {...e,status:'PASS'};
 };
 f.independentReview=async e=>({...e,status:'PASS',independent:true,evidenceId:'FIXTURE_PROTOCOL_ONLY'});
 return f;
}
const loop=f=>makeClosedLoop(f,{enginePilot:false,intervalMs:600000,fencingWitness:async()=>({fixtureFence:true}),runChecks:f.runChecks});

test('published review describes its bound policy while legacy draft bytes remain unchanged',()=>{
 const record={baseSha:'a'.repeat(40),head:'b'.repeat(40),deltaSha256:'c'.repeat(64)};
 assert.equal(digest(draftBody('legacy-job',record)),'8e6eccad129d742e8ef1bc7019832853f11f8cd733a2367ea7225cdd05d78c7e');
 const text=draftBody('legacy-job',{...record,reviewPolicySha256:'d'.repeat(64)});
 assert.ok(text.includes('independent published review (policy SHA256 '+'d'.repeat(64)+')'));
 assert.equal(text.includes('CodeRabbit remain pending'),false);
 assert.throws(()=>draftBody('legacy-job',{...record,reviewPolicySha256:'invalid'}),/PR_REVIEW_POLICY/);
});

test('untracked G2 creations reject whitespace before any scratch write',async t=>{
 for(const suffix of ['# trailing space \n','# trailing tab\t\n','\n',' \t# space before tab\n','\t \t# mixed indent\n']){
  const f=await setup(t),task=f.catalog[0],change=task.changes[0];
  const filename=path.join(f.root,'scratchpads',task.id,change.path);
  await assert.rejects(()=>prepareDelta({root:f.root},task,{admission:{taskId:task.id,head:task.sha,
   stage:task.stage,mode:'ISOLATED_PREPARE_ONLY',paths:[change.path]},
   changes:[{...change,content:change.content+suffix}]}),/NEW_FILE_WHITESPACE/);
  await assert.rejects(fs.stat(filename),{code:'ENOENT'});
 }
});

test('stage admission uses the same maximum branch suffix as Publisher',async t=>{
 const f=await setup(t),p=structuredClone(f.policy);
 p.schema='asi.stage-authority.v1';p.stage='S4-G1';p.issue=511;p.tasks=p.tasks.slice(0,1);
 p.tasks[0].branch='asi/engine-task/'+'a'.repeat(71);
 assert.doesNotThrow(()=>validateStagePolicy(p,f.now.value));
 p.tasks[0].branch+='a';assert.throws(()=>validateStagePolicy(p,f.now.value),/STAGE_TASK_SCOPE/);
});

test('real witness changes: two disjoint file creations through existing Publisher and Dispatcher; fixture writes only',async t=>{
 const f=await setup(t,{ci:'pending'});assert.equal((await tick(await loop(f))).mode,'WAITING');assert.equal(f.pulls.size,1);
 f.state.ci='success';advance(f);assert.equal((await tick(await loop(f))).mode,'REPORT_READY');
 advance(f);assert.equal((await tick(await loop(f))).mode,'REPORT_READY');assert.equal(f.pulls.size,2);
 const receipts=await readState(f,'receipts.json');assert.equal(receipts.completed.length,2);
 const count=(await readState(f,'publisher-poll.json')).count;
 // More than 100 no-work polls are neither renewed task grants nor publications.
 for(let i=0;i<105;i++){advance(f);assert.equal((await tick(await loop(f))).reason,'NO_ELIGIBLE_APPROVED_TASK');}
 assert.equal((await readState(f,'publisher-poll.json')).count,count);assert.equal(f.writes.length,8);
});
test('finite work budget persists across restart; IDLE cannot replenish pending-CI quota',async t=>{
 const f=await setup(t,{ci:'pending'});f.closedLoop.maxTicks=1;
 assert.equal((await tick(await loop(f))).mode,'WAITING');advance(f);
 assert.equal((await tick(await loop(f))).reason,'WORK_POLL_BUDGET_EXHAUSTED');assert.equal(f.pulls.size,1);
 advance(f);f.closedLoop.maxTicks=2;assert.equal((await tick(await loop(f))).mode,'FAILED_LOCKED');
});
test('expired or revoked task authority cannot use continuing process as new consent',async t=>{
 for(const mode of ['expiry','revoke']){const f=await setup(t);if(mode==='expiry')f.now.value=f.policy.expiresAt;else f.comments=[];
 // Keep the original trusted-reader closure and remove its data on revocation.
 if(mode==='revoke')f.closedLoop.readTrustedComments=async()=>[];
 assert.equal((await tick(await loop(f))).mode,'FAILED_LOCKED');assert.equal(f.writes.length,0);}
});
test('new-file authority rejects replacement, unrelated filename and historical job identities',async t=>{
 for(const mutate of [f=>f.catalog[0].changes[0].beforeSha256='a'.repeat(64),
  f=>f.catalog[0].changes[0].path='scripts/strigunov4/foreign.py',f=>f.catalog[0].id='g1-receipt-replay-20261022']){
  const f=await setup(t);mutate(f);
  await assert.rejects(async()=>{const r=await tick(await loop(f));assert.notEqual(r.mode,'FAILED_LOCKED');});assert.equal(f.writes.length,0);
 }
});
test('competing workers and unknown remote response never duplicate either work order',async t=>{
 const f=await setup(t);const results=await Promise.all([loop(f).then(tick),loop(f).then(tick)]);
 assert.deepEqual(results.map(x=>x.mode).sort(),['BLOCKED','REPORT_READY']);assert.equal(f.pulls.size,1);
 const g=await setup(t,{loseResponse:'pulls'});assert.equal((await tick(await loop(g))).mode,'FAILED_LOCKED');
 advance(g);assert.equal((await tick(await loop(g))).mode,'FAILED_LOCKED');assert.equal(g.pulls.size,1);
});
test('worker remains alive beyond 100 iterations; bounded backoff, safe output and graceful stop',async()=>{
 const stop=new AbortController(),logs=[],waits=[];let n=0;
 await runContinuousWorker({signal:stop.signal,iteration:async()=>{if(++n===110)stop.abort();if(n<4)throw Error('SECRET');return {mode:'WAITING',raw:'SECRET'};},
  wait:async ms=>{waits.push(ms);},emit:x=>logs.push(x)});
 assert.equal(n,110);assert.ok(waits.every(x=>x>=600000&&x<=3600000));assert.equal(JSON.stringify(logs).includes('SECRET'),false);
});
test('Beget signature pins host, finite scope, no spend and expiry; old G1 approvals cannot authorize it',async t=>{
 const f=await setup(t),{privateKey,publicKey}=generateKeyPairSync('ed25519');
 const p={schema:'asi.engine-beget-activation.v1',...BEGET,repo:'ASI-integration/asi-landing',stage:'S4-G2',baseSha:f.sha,
 notBefore:f.policy.notBefore,expiresAt:f.policy.expiresAt,automaticCiApproved:true,automaticReviewApproved:true,
 budget:{paidUsd:0,maxTasks:2,maxMutations:8,maxRequests:10000},githubApp:{appId:1,installationId:2},
 closedLoop:{continuous:true,reviewMode:'signed-offline-delta',intervalMs:600000,maxTicks:100,policy:f.policy},
 ciPolicies:[{name:'validate',workflowId:311380800,event:'pull_request'},{name:'release_governance',workflowId:390653294,event:'pull_request_target'}]};
 for(const field of ['catalogSha256','runtimeManifestSha256','fenceSha256','reviewsSha256','releaseSha256'])p[field]='a'.repeat(64);
 const envelope=v=>{const payload=JSON.stringify(v);return {payload,signature:sign(null,Buffer.from(payload),privateKey).toString('base64')};};
 const pem=publicKey.export({type:'spki',format:'pem'});assert.equal(verifyBegetActivation(envelope(p),pem,f.now.value).host,BEGET.host);
 for(const bad of [{host:'asi-agent-runner'},{schema:'asi.engine-activation.v1'},{stage:'S4-G3'},
 {expiresAt:p.notBefore+15*86400000},{budget:{...p.budget,paidUsd:1}},{root:'/tmp/other'}]){
  assert.throws(()=>verifyBegetActivation(envelope({...p,...bad}),pem,f.now.value));
 }
 assert.throws(()=>verifyBegetActivation(envelope(p),pem,p.expiresAt));
});
test('offline review requires authenticated independent evidence and exact delta, never tests-as-review',async t=>{
 const f=await setup(t);let verified=0;
 const tasks=f.catalog.map(t=>({id:t.id,baseSha:t.sha,status:'PASS',findings:0,
 deltaSha256:digest(JSON.stringify(t.changes.map(c=>({path:c.path,beforeSha256:null,afterSha256:digest(c.content)}))))}));
 const reviewsRaw=JSON.stringify({schema:'asi.offline-delta-review.v1',repository:'ASI-integration/asi-landing',tasks,notBefore:0,expiresAt:2000000});
 const checks=await createBegetChecks({root:f.root,catalog:f.catalog,reviewsRaw,reviewPolicySha256:digest(reviewsRaw),clock:()=>1000000,
 revalidate:async()=>{},verifyReviewProvenance:async()=>{verified++;throw Error('NO_INDEPENDENT_REVIEW');}});
 await assert.rejects(()=>checks.publishedReview.verify({id:tasks[0].id,deltaSha256:tasks[0].deltaSha256}));assert.equal(verified,1);
});

 test('request and mutation budgets survive process reconstruction; no silent reset',async t=>{
 const f=await setup(t),payload={budget:{maxRequests:3,maxMutations:1}};
 const file=path.join(f.root,'state/api-budget.json');
 await fs.writeFile(file,JSON.stringify({policySha256:digest(JSON.stringify(payload)),requests:0,mutations:0}));
 const budget=()=>createRequestBudget({root:f.root,payload,revalidate:async()=>{}});
 await budget()({mutation:true});await assert.rejects(()=>budget()({mutation:true}));
 await budget()({});await budget()({});await assert.rejects(()=>budget()({}));
 assert.deepEqual(JSON.parse(await fs.readFile(file)),{policySha256:digest(JSON.stringify(payload)),requests:3,mutations:1});
 });
 test('G2 SIGKILL after publication leaves durable brake; restart cannot retry',async t=>{
 const f=await setup(t,{loseResponse:'pulls'}),data=path.join(f.base,'child.json');
 await fs.writeFile(data,JSON.stringify({root:f.root,legacy:f.legacy,origin:f.origin,catalog:f.catalog,snapshot:f.snapshot,routing:f.routing,policy:f.policy,comments:f.comments}));
 const helper=new URL('./publisher-fixture.mjs',import.meta.url).href;
 const code=`import fs from 'node:fs/promises';import {makeLoop} from ${JSON.stringify(helper)};
 const f=JSON.parse(await fs.readFile(process.argv[1]));const l=await makeLoop(f,{timeoutMs:30000,enginePilot:false,
 fencingWitness:async()=>({fixture:true}),runChecks:async e=>({...e,status:'PASS'}),
 publishedReview:{policySha256:'a'.repeat(64),verify:async()=>{throw Error('UNREACHABLE')}},
 closedLoop:{stateDir:f.routing,policy:f.policy,readTrustedComments:async()=>f.comments,maxTicks:8,continuous:true}});await l.poll({execute:true});`;
 const child=spawn(process.execPath,['--input-type=module','-e',code,data],{stdio:['ignore','pipe','pipe']});
 let errors='';child.stderr.on('data',x=>errors+=x);t.after(()=>child.kill('SIGKILL'));
 for(let i=0;i<250&&!f.state.lost&&child.exitCode===null;i++)await new Promise(r=>setTimeout(r,20));
 assert.equal(f.state.lost,true,errors);const end=once(child,'exit');child.kill('SIGKILL');await end;
 const count=f.requests.length;advance(f);assert.equal((await tick(await loop(f))).mode,'BLOCKED');assert.equal(f.requests.length,count);assert.equal(f.pulls.size,1);
 });
 test('partial journal never becomes clean state on restart',async t=>{
 const f=await setup(t),file=path.join(f.root,'state/autopilot-ledger.json');await fs.writeFile(file,'{');
 assert.equal((await tick(await loop(f))).mode,'FAILED_LOCKED');assert.equal(await fs.readFile(file,'utf8'),'{');assert.equal(f.writes.length,0);
 });

test('installer ignores access-time updates but rejects inode replacement',()=>{
 const code=`import importlib.util,tempfile,sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
s=importlib.util.spec_from_file_location('installer',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
with tempfile.TemporaryDirectory() as d:
 f=Path(d)/'artifact';f.write_bytes(b'{}');before=f.stat();fields=('st_dev','st_ino','st_mode','st_uid','st_gid','st_nlink','st_size','st_mtime_ns','st_ctime_ns')
 after=SimpleNamespace(**{k:getattr(before,k) for k in fields},st_atime=before.st_atime+5)
 with patch.object(m.os,'fstat',side_effect=[before,after]):assert m.regular_bytes(f)==b'{}'
 after.st_ino+=1
 with patch.object(m.os,'fstat',side_effect=[before,after]):
  try:m.regular_bytes(f);raise AssertionError('inode mutation accepted')
  except m.Block as e:assert str(e)=='FILE_CHANGED'
`;
 execFileSync('/usr/bin/python3',['-I','-S','-B','-c',code,new URL('./beget-install.py',import.meta.url).pathname],{timeout:5000});
});

test('installer rejects invalid activation and untraversable authority before claims',()=>{
 const code=`import importlib.util,sys,stat
from types import SimpleNamespace
from unittest.mock import patch
s=importlib.util.spec_from_file_location('installer',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
p={'host':m.HOST,'service':m.UNIT,'notBefore':100,'expiresAt':200}
m.activation_preclaim(p,150)
for delta in ({'host':'other'},{'service':'other'},{'expiresAt':150},{'notBefore':151},{'notBefore':True}):
 try:m.activation_preclaim(dict(p,**delta),150);raise AssertionError('invalid activation accepted')
 except m.Block:pass
for mode,accepted in ((0o700,False),(0o711,True),(0o777,False)):
 with patch.object(m.Path,'lstat',return_value=SimpleNamespace(st_uid=0,st_mode=stat.S_IFDIR|mode)):
  try:m.authority_traversal();assert accepted
  except m.Block:assert not accepted
`;
 execFileSync('/usr/bin/python3',['-I','-S','-B','-c',code,new URL('./beget-install.py',import.meta.url).pathname],{timeout:5000});
});

test('package builder rejects dirty source before creating output',async t=>{
 const {buildBegetCandidate}=await import('./host-package.mjs');
 const dir=await fs.mkdtemp('/tmp/asi-package-source-');t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const git=(...args)=>execFileSync('/usr/bin/git',args,{cwd:dir,stdio:'pipe'});
 git('init');git('config','user.email','fixture@example.invalid');git('config','user.name','Fixture');
 await fs.writeFile(path.join(dir,'source'),'original');git('add','source');git('commit','-m','fixture');
 const outputParent=await fs.mkdtemp('/tmp/asi-package-output-');
 t.after(()=>fs.rm(outputParent,{recursive:true,force:true}));
 const sha=git('rev-parse','HEAD').toString().trim(),output=path.join(outputParent,'output');
 for(const kind of ['tracked','untracked']){
  if(kind==='tracked')await fs.writeFile(path.join(dir,'source'),'changed');
  else{git('checkout','--','source');await fs.writeFile(path.join(dir,'extra'),'untracked');}
  await assert.rejects(()=>buildBegetCandidate({repository:dir,output,baseSha:sha}),/PACKAGE_DIRTY_SOURCE/);
  await assert.rejects(()=>fs.stat(output),{code:'ENOENT'});
 }
});

test('five owner lanes preserve literal repository and branch identity without running a new dispatcher',()=>{
 assert.deepEqual(OWNER_LANES.map(x=>x.id),['engine','ru-auth','p0-integration','p0-trust','p0-atomic-budget']);
 assert.deepEqual(OWNER_LANES.map(x=>x.pr),[549,554,552,null,null]);
 assert.equal(new Set(OWNER_LANES.map(x=>x.branch)).size,5);
 assert.ok(OWNER_LANES.every(x=>x.repository==='ASI-integration/asi-landing'&&Object.isFrozen(x)));
 assert.ok(Object.isFrozen(OWNER_LANES));
});
test('a scheduled task, GitHub commit or forged host PID is never accepted as a server lane heartbeat',async()=>{
 for(const v of [undefined,{}, {catalog:OWNER_LANES},{
   admission:{root:'/var/lib/asi-engine'},
   catalog:OWNER_LANES.map(x=>({id:x.id,branch:x.branch,repo:x.repository,kind:'github-publisher',changes:[]})),
   revalidate:async()=>{},fencingWitness:async()=>({sha256:'0'.repeat(64)}),
   systemd:{host:'pqukibofpo',unit:'asi-strigunov-agent.service',MainPID:3456,InvocationID:'fake'},
   heartbeat:{at:new Date().toISOString(),mode:'RUNNING'}
 }]){
   const rows=await projectOwnerLaneAdmission(v);
   assert.equal(rows.length,5);
   assert.ok(rows.every(x=>x.status==='UNKNOWN'&&x.lastHeartbeat===null&&x.currentTask===null));
 }
});

test('Bubblewrap sandbox keeps network unshared and host mounts read-only after distro-path repair', () => {
  const args=sandboxArguments('/tmp/asi-bwrap-fixture');
  for(const required of ['--die-with-parent','--new-session','--unshare-all','--clearenv','--ro-bind','--tmpfs']) {
    assert.ok(args.includes(required), 'missing '+required);
  }
  for(const forbidden of ['--share-net','--bind','--bind-try','--unshare-user-try']) {
    assert.equal(args.includes(forbidden),false,'unsafe '+forbidden);
  }
  const envNames=[];
  for(let i=0;i<args.length-2;i++)if(args[i]==='--setenv')envNames.push(args[i+1]);
  assert.deepEqual(envNames,['PATH','LANG'],'sandbox must not inherit extra environment variables');
  const ro=[];
  for(let i=0;i<args.length-2;i++) if(args[i]==='--ro-bind')ro.push([args[i+1],args[i+2]]);
  for(const expected of [['/usr','/usr'],['/lib','/lib'],['/tmp/asi-bwrap-fixture','/work']]) {
    assert.ok(ro.some(x=>x[0]===expected[0]&&x[1]===expected[1]),'missing readonly mount '+expected.join(' '));
  }
  assert.throws(()=>sandboxArguments('relative/path'),/CHECK_WORKSPACE/);
});
