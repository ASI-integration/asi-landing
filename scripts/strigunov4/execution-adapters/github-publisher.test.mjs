import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fixture,makeLoop,target} from './publisher-fixture.mjs';
import {createPublisherTransport,bounded} from './publisher-transport.mjs';
const read=async(root,name)=>JSON.parse(await fs.readFile(path.join(root,'state',name),'utf8'));
const tick=loop=>loop.poll({execute:true});
const pause=ms=>new Promise(r=>setTimeout(r,ms));

test('01 real modules: intake, prepare, Python check, draft readback, pending CI, restart, next task',async t=>{
 const f=await fixture(t,{ci:'pending'}),now={value:1000000};let loop=await makeLoop(f,{now});
 assert.equal((await tick(loop)).mode,'WAITING');assert.equal(f.pulls.size,1);
 assert.equal((await read(f.root,'receipts.json')).completed.length,0);
 assert.equal((await read(f.root,'publication-fixture-a.json')).phase,'PUBLISHED_WAITING');
 f.state.ci='success';now.value+=180000;loop=await makeLoop(f,{now});
 const a=await tick(loop);assert.equal(a.mode,'REPORT_READY');assert.equal(a.artifactType,'GITHUB_PR_VERIFIED');
 assert.equal(f.pulls.size,1);now.value+=180000;
 assert.equal((await tick(loop)).mode,'REPORT_READY');assert.equal(f.pulls.size,2);
 now.value+=180000;loop=await makeLoop(f,{now});assert.equal((await tick(loop)).reason,'NO_APPROVED_PUBLICATION_TASK');
 assert.equal((await read(f.root,'receipts.json')).completed.length,2);
 assert.deepEqual(f.writes,['git/trees','git/commits','git/refs','pulls','git/trees','git/commits','git/refs','pulls']);
 assert.equal(await fs.readFile(path.join(f.root,'scratchpads','fixture-a',target),'utf8'),'VALUE = 2\n');
});
test('02 execute false never reads network, changes files or journals',async t=>{
 const f=await fixture(t),loop=await makeLoop(f);const before=await read(f.root,'autopilot-ledger.json');
 assert.equal((await loop.poll()).mode,'OBSERVE_ONLY');assert.equal(f.requests.length,0);
 assert.deepEqual(await read(f.root,'autopilot-ledger.json'),before);
});
test('03 denied capability locks first job and cannot advance',async t=>{
 const f=await fixture(t),loop=await makeLoop(f,{authorize:async()=>({approved:false})});
 assert.equal((await tick(loop)).mode,'FAILED_LOCKED');assert.equal((await tick(loop)).mode,'FAILED_LOCKED');assert.equal(f.writes.length,0);
});
test('04 wrong repository, branch, source SHA, stage and out-of-scope paths are denied',async t=>{
 for(const patch of [{repo:'other/repo'},{branch:'main'},{sha:'f'.repeat(40)},{stage:'S4-G2'},{changes:[{path:'.github/workflows/deploy.yml',content:'x'}]}]){
  const f=await fixture(t);Object.assign(f.catalog[0],patch);const loop=await makeLoop(f);
  assert.equal((await tick(loop)).mode,'FAILED_LOCKED');assert.equal(f.writes.length,0);
 }
});
test('05 prior unknown PR blocks before publication',async t=>{
 const f=await fixture(t);f.pulls.set(999,{number:999,head:{ref:f.catalog[0].branch,repo:{full_name:f.catalog[0].repo}}});
 const loop=await makeLoop(f);assert.equal((await tick(loop)).mode,'FAILED_LOCKED');assert.equal(f.writes.length,0);
});
test('06 same job id with different kind cannot reuse a receipt',async t=>{
 const f=await fixture(t),now={value:1000000};let loop=await makeLoop(f,{now});assert.equal((await tick(loop)).mode,'REPORT_READY');
 f.catalog[0].kind='other-adapter';now.value+=180000;loop=await makeLoop(f,{now});assert.equal((await tick(loop)).mode,'FAILED_LOCKED');assert.equal(f.pulls.size,1);
});
test('07 local check failure and wrong-delta review each stop before writes',async t=>{
 for(const options of [{runChecks:async()=>({status:'FAILED'})},{independentReview:async e=>({...e,status:'PASS',independent:true,evidenceId:'fixture',deltaSha256:'0'.repeat(64)})}]){
  const f=await fixture(t),loop=await makeLoop(f,options);assert.equal((await tick(loop)).mode,'FAILED_LOCKED');assert.equal(f.writes.length,0);
 }
});
test('08 pending review never records a final PASS',async t=>{
 const f=await fixture(t,{review:'pending'}),loop=await makeLoop(f);assert.equal((await tick(loop)).mode,'WAITING');
 assert.equal((await read(f.root,'receipts.json')).completed.length,0);assert.equal(f.pulls.size,1);
});
test('09 paused or failed review freezes queue even after PR creation',async t=>{
 const f=await fixture(t,{review:'Review paused'}),loop=await makeLoop(f);assert.equal((await tick(loop)).mode,'FAILED_LOCKED');
 assert.equal(f.pulls.size,1);assert.equal((await tick(loop)).mode,'FAILED_LOCKED');
 assert.equal((await read(f.root,'receipts.json')).completed.some(r=>r.status==='PASS'),false);
});
test('10 main moves during publication: no next write or promotion',async t=>{
 const f=await fixture(t,{moveAfter:'git/trees'}),loop=await makeLoop(f);assert.equal((await tick(loop)).mode,'FAILED_LOCKED');
 assert.deepEqual(f.writes,['git/trees']);
});
test('11 lost response AFTER remote PR creation locks without duplicate retry',async t=>{
 const f=await fixture(t,{loseResponse:'pulls'}),now={value:1000000};let loop=await makeLoop(f,{now,timeoutMs:300});
 assert.equal((await tick(loop)).mode,'FAILED_LOCKED');assert.equal(f.pulls.size,1);assert.equal(f.state.lost,true);
 assert.equal((await read(f.root,'publication-fixture-a.json')).phase,'INTENT');
 const count=f.requests.length;now.value+=180000;loop=await makeLoop(f,{now});assert.equal((await tick(loop)).mode,'FAILED_LOCKED');assert.equal(f.requests.length,count);
});
test('12 SIGKILL after remote write retains journal lock and blocks restart',async t=>{
 const f=await fixture(t,{loseResponse:'pulls'});const payload=path.join(f.base,'worker.json');
 await fs.writeFile(payload,JSON.stringify({root:f.root,legacy:f.legacy,origin:f.origin,catalog:f.catalog,snapshot:f.snapshot}));
 const helper=new URL('./publisher-fixture.mjs',import.meta.url).href;
 const child=spawn(process.execPath,['--input-type=module','-e',`import fs from 'node:fs/promises';import {makeLoop} from ${JSON.stringify(helper)};const f=JSON.parse(await fs.readFile(process.argv[1],'utf8'));const loop=await makeLoop(f,{timeoutMs:30000});await loop.poll({execute:true});`,payload],{stdio:['ignore','pipe','pipe']});
 let errors='';child.stderr.on('data',b=>errors+=b);t.after(()=>{if(child.exitCode===null)child.kill('SIGKILL');});
 for(let i=0;i<200&&!f.state.lost&&child.exitCode===null;i++)await pause(20);
 assert.equal(f.state.lost,true,errors);const exit=once(child,'exit');child.kill('SIGKILL');await exit;
 assert.equal((await read(f.root,'publication-fixture-a.json')).phase,'INTENT');
 const requests=f.requests.length,loop=await makeLoop(f);assert.equal((await tick(loop)).mode,'BLOCKED');assert.equal(f.requests.length,requests);assert.equal(f.pulls.size,1);
});
test('13 concurrent ticks cannot publish twice',async t=>{
 const f=await fixture(t),loop=await makeLoop(f);const both=await Promise.all([tick(loop),tick(loop)]);
 assert.deepEqual(both.map(x=>x.mode).sort(),['BLOCKED','REPORT_READY']);assert.equal(f.pulls.size,1);
});
test('14 prepared source changed by checker is rejected',async t=>{
 const f=await fixture(t),loop=await makeLoop(f,{runChecks:async e=>{
  await fs.writeFile(path.join(f.root,'scratchpads',e.taskId,target),'VALUE = 100\n');return {...e,status:'PASS'};}});
 assert.equal((await tick(loop)).mode,'FAILED_LOCKED');assert.equal(f.writes.length,0);
});
test('15 remote tree outside the admitted delta is rejected before ref write',async t=>{
 const f=await fixture(t,{badTree:true}),loop=await makeLoop(f);assert.equal((await tick(loop)).mode,'FAILED_LOCKED');assert.deepEqual(f.writes,['git/trees']);
});
test('16 foreign HEAD CI cannot finalize published PR',async t=>{
 const f=await fixture(t,{staleCi:true}),loop=await makeLoop(f);assert.equal((await tick(loop)).mode,'FAILED_LOCKED');assert.equal(f.pulls.size,1);
});
test('17 completed report tampering freezes subsequent work',async t=>{
 const f=await fixture(t),now={value:1000000},loop=await makeLoop(f,{now});assert.equal((await tick(loop)).mode,'REPORT_READY');
 const receipts=await read(f.root,'receipts.json');await fs.writeFile(path.join(f.root,'reports',receipts.completed[0].report),'{}');
 now.value+=180000;assert.equal((await tick(loop)).mode,'FAILED_LOCKED');assert.equal(f.pulls.size,1);
});
test('18 180-second poll limit survives process object restart',async t=>{
 const f=await fixture(t,{ci:'pending'}),now={value:1000000};let loop=await makeLoop(f,{now});await tick(loop);const n=f.requests.length;
 now.value+=30000;loop=await makeLoop(f,{now});assert.equal((await tick(loop)).reason,'POLL_RATE_LIMITED');assert.equal(f.requests.length,n);
});
test('19 transport denies arbitrary writes, protected branch, URL and shell input',async()=>{
 const transport=createPublisherTransport({token:'INERT'});
 assert.equal(transport.updateRef,undefined);assert.equal(transport.merge,undefined);assert.equal(transport.dispatch,undefined);
 for(const p of ['https://evil.invalid','../secrets','actions/workflows/x/dispatches'])assert.throws(()=>transport.get(p));
 assert.throws(()=>transport.createBranch('main','a'.repeat(40)));assert.throws(()=>transport.createDraft('asi/engine-task/a','$(touch secret)'));
});
test('20 abort-ignoring late response poisons transport; never a second call',async()=>{
 const previous=globalThis.fetch;let calls=0,finish;
 globalThis.fetch=()=>{calls++;return new Promise(r=>finish=r);};
 try{const transport=createPublisherTransport({token:'INERT',timeoutMs:10});await assert.rejects(transport.get('branches/main'),/REMOTE_RESULT_UNKNOWN/);
  finish(new Response('{}'));await pause(10);await assert.rejects(transport.get('branches/main'),/TRANSPORT_LOCKED/);assert.equal(calls,1);
 }finally{globalThis.fetch=previous;}
});
test('21 unknown host exception is redacted in every state/report file',async t=>{
 const f=await fixture(t),loop=await makeLoop(f,{authorize:async()=>{throw Error('CANARY_PRIVATE_TOKEN');}});assert.equal((await tick(loop)).mode,'FAILED_LOCKED');
 for(const dir of ['state','reports'])for(const item of await fs.readdir(path.join(f.root,dir),{withFileTypes:true})){
  if(item.isFile())assert.equal((await fs.readFile(path.join(f.root,dir,item.name),'utf8')).includes('CANARY_PRIVATE_TOKEN'),false);
 }
});
test('22 release stage cannot advance to physical G2',async t=>{
 const f=await fixture(t);f.snapshot.contract.stages[0].status='ACCEPTED';const loop=await makeLoop(f);
 assert.equal((await tick(loop)).mode,'FAILED_LOCKED');assert.equal(f.writes.length,0);
});
test('23 deadline rejects invalid configuration',async()=>{
 for(const ms of [0,-1,Infinity,30001])await assert.rejects(bounded(async()=>1,ms),/DEADLINE_REQUIRED/);
});
test('24 real ASI governance event requires exact approved workflow and head/base association',async t=>{
 const policies=[{name:'validate',workflowId:10},{name:'release_governance',workflowId:390653294,event:'pull_request_target'}];
 const f=await fixture(t,{targetGovernance:true}),loop=await makeLoop(f,{ciPolicies:policies});
 assert.equal((await tick(loop)).mode,'REPORT_READY');
 for(const options of [{wrongAssociation:true},{staleCi:true}]){
  const g=await fixture(t,{targetGovernance:true,...options}),other=await makeLoop(g,{ciPolicies:policies});
  assert.notEqual((await tick(other)).mode,'REPORT_READY');assert.equal((await read(g.root,'receipts.json')).completed.some(x=>x.status==='PASS'),false);
 }
 const g=await fixture(t,{targetGovernance:true}),other=await makeLoop(g,{ciPolicies:[policies[0],{...policies[1],workflowId:123}]});
 assert.equal((await tick(other)).mode,'FAILED_LOCKED');
 assert.equal(g.writes.length,0);
});
test('25 an operation capability cannot be reused by another task',async t=>{
 const f=await fixture(t),now={value:1000000},loop=await makeLoop(f,{now,authorize:async request=>({approved:true,request,
  automaticCiApproved:true,automaticReviewApproved:true,operationId:'single-operation',expiresAt:999999999})});
 assert.equal((await tick(loop)).mode,'REPORT_READY');now.value+=180000;
 assert.equal((await tick(loop)).mode,'FAILED_LOCKED');assert.equal(f.pulls.size,1);
});
test('26 CI changes while review is read: no final receipt or next task',async t=>{
 const f=await fixture(t,{failDuringReview:true}),loop=await makeLoop(f);
 assert.equal((await tick(loop)).mode,'FAILED_LOCKED');assert.equal(f.pulls.size,1);
 assert.equal((await read(f.root,'receipts.json')).completed.some(r=>r.status==='PASS'),false);
});
test('27 changed dispatcher dependency prevents the next mutation',async t=>{
 const f=await fixture(t),loop=await makeLoop(f,{runChecks:async e=>{
  f.snapshot.reviews[509].completed=false;return {...e,status:'PASS'};}});
 assert.equal((await tick(loop)).mode,'FAILED_LOCKED');assert.equal(f.writes.length,0);
});
test('28 present malformed publication journal cannot be treated as absent',async t=>{
 for(const value of [null,[],0,'invalid']){
  const f=await fixture(t);await fs.writeFile(path.join(f.root,'state','publication-fixture-a.json'),JSON.stringify(value));
  const loop=await makeLoop(f);assert.equal((await tick(loop)).mode,'FAILED_LOCKED');assert.equal(f.writes.length,0);
 }
});
test('29 present malformed poll state blocks rather than resetting cadence',async t=>{
 for(const value of [null,[],0,{}, {at:'1000000'}]){
  const f=await fixture(t);await fs.writeFile(path.join(f.root,'state','publisher-poll.json'),JSON.stringify(value));
  const loop=await makeLoop(f);assert.equal((await tick(loop)).mode,'FAILED_LOCKED');assert.equal(f.requests.length,0);
 }
});
test('30 composite evidence budget covers multiple bounded HTTP calls',async t=>{
 const f=await fixture(t,{delay:25}),loop=await makeLoop(f,{timeoutMs:120});
 assert.equal((await tick(loop)).mode,'REPORT_READY');assert.equal(f.pulls.size,1);
});
