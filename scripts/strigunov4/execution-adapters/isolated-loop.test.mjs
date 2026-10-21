import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync,spawn} from 'node:child_process';
import {createIsolatedAcceptanceLoop,createReadOnlyRunnerBridge} from '../ASI-STRIGUNOV4-RUNNER-BRIDGE-20261020.mjs';
import {independentCodeRabbit} from '../ASI-STRIGUNOV4-GITHUB-SNAPSHOT-20261020.mjs';
import {atomicWriteJson,createOrchestrator} from '../ASI-STRIGUNOV4-ORCHESTRATOR-CANDIDATE-20261020.mjs';
import {WORK_ORDERS} from '../ASI-STRIGUNOV4-MULTIJOB-20261020.mjs';
import {initializeState,existingState,atomicJson,digest} from './state.mjs';
const jobs=WORK_ORDERS.filter(j=>j.stage==='S4-G1'&&j.kind!=='physical-gate');
const source=jobs.at(-1), file=source.paths[0], initial='VALUE = 1\n', next='VALUE = 2\n';
const policy=[{name:'validate',workflowId:10},{name:'release_governance',workflowId:20}];
const read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
async function fixture(t){
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'asi-s4g1-integration-'));
 t.after(()=>fs.rm(base,{recursive:true,force:true}));
 const root=path.join(base,'isolated'),legacy=path.join(base,'legacy');
 await fs.mkdir(root,{mode:0o700});await fs.mkdir(legacy,{mode:0o700});
 const store=await initializeState(root),cwd=path.join(root,'scratchpads',source.id);
 await fs.mkdir(cwd,{mode:0o700});await fs.mkdir(path.dirname(path.join(cwd,file)),{recursive:true,mode:0o700});
 await fs.writeFile(path.join(cwd,file),initial);
 const git=args=>execFileSync('/usr/bin/git',args,{cwd,stdio:'pipe',env:{PATH:'/usr/bin:/bin',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'}}).toString().trim();
 git(['init']);git(['add',file]);git(['-c','core.hooksPath=/dev/null','-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','isolated fixture']);
 const head=git(['rev-parse','HEAD']);git(['checkout','--detach']);
 const old={version:1,completed:[{id:'unrelated-historical-pass',sha:'a'.repeat(40),pr:1,status:'PASS',retained:'unchanged'}]};
 await fs.writeFile(path.join(legacy,'receipts.json'),JSON.stringify(old));
 await fs.writeFile(path.join(legacy,'heartbeat.json'),' { "mode": "WAITING" }\n');
 const snapshot={mainSha:head,contract:{schemaVersion:'asi.demo-release.v1',releaseId:'STRIGUNOV4-READY-FOR-DEMO',state:'FROZEN_ON_OWNER_MERGE',stages:[1,2,3,4,5,6].map(i=>({id:'S4-G'+i,status:i===1?'IN_PROGRESS':'NOT_STARTED',proof:[],files:[],plannedFiles:i===1?source.paths:[]}))},issues:{511:{number:511,state:'open',labels:['agent-source-ready']}},project:{511:'PREPARATION_ONLY'},prs:{},checks:{},reviews:{},ledger:{}};
 for(const j of jobs.filter(j=>j.pr)){
  snapshot.prs[j.pr]={number:j.pr,head:j.head,branch:'asi/review-'+j.pr,state:'open',merged:false};
  snapshot.checks[j.pr]={head:j.head,validate:'success',release_governance:'success'};
  snapshot.reviews[j.pr]={head:j.head,completed:true,actionable:false};
 }
 const knobs={ci:'success',review:'clear',verifyCalls:0,admissions:0,reads:0};
 const runs=jobs.filter(j=>j.pr).flatMap((j,k)=>policy.map((p,i)=>({id:100+k*10+i,workflow_id:p.workflowId,head_sha:j.head,event:'pull_request',pull_requests:[{number:j.pr}],run_attempt:1,status:'completed',conclusion:'success'})));
 const github={
  verifyTask:async task=>{knobs.verifyCalls++;if(knobs.hold)await knobs.hold();if(knobs.throwVerify)throw Error('PRIVATE_ERROR');return {head:knobs.changedHead?'f'.repeat(40):task.sha,pr:task.pr};},
  pages:async p=>{
   knobs.reads++;
   if(p.startsWith('actions/runs?')){const sha=new URLSearchParams(p.split('?')[1]).get('head_sha');return runs.filter(r=>r.head_sha===sha).map(r=>({...r,status:knobs.ci==='pending'?'in_progress':'completed',conclusion:knobs.ci==='pending'?null:knobs.ci}));}
   if(p.startsWith('actions/runs/')){const id=Number(p.split('/')[2]),r=runs.find(x=>x.id===id);return [{id:id+1000,run_id:id,head_sha:r.head_sha,name:policy.find(x=>x.workflowId===r.workflow_id).name,status:'completed',conclusion:knobs.ci,steps:[{number:1,status:'completed',conclusion:knobs.ci}]}];}
   if(p.endsWith('/statuses'))return [{id:5,context:'CodeRabbit',creator:{id:136622811},state:'success',description:knobs.review==='skipped'?'Review skipped':'Review completed',created_at:'2026-10-20T18:00:00Z'}];
   if(p.endsWith('/reviews'))return [{id:4,user:{id:136622811},commit_id:jobs.find(j=>j.pr===Number(p.split('/')[1])).head,state:'COMMENTED',body:knobs.review==='outside'?'**Actionable comments posted: 0**\n⚠️ Outside diff range comments (3)':'**Actionable comments posted: 0**'}];
   if(p.endsWith('/comments'))return [];
   throw Error('UNEXPECTED_READ');
  },
  get:async p=>({...runs.find(r=>r.id===Number(p.split('/')[2])),conclusion:knobs.ci}),
  threads:async()=>knobs.review==='concern'?[{isResolved:false}]:[]
 };
 const options={root,legacyStateDir:legacy,isolated:true,github,ciPolicies:policy,
  fetchSnapshot:async()=>structuredClone(snapshot),
  preparePlans:{[source.id]:{branch:'asi/isolated-proposal',changes:[{path:file,beforeSha256:digest(initial),content:next}]}},
  authorizePreparation:async task=>{knobs.admissions++;if(knobs.denyAdmission)throw Error('DENIED');return {taskId:task.id,head,stage:'S4-G1',mode:'ISOLATED_PREPARE_ONLY',paths:source.paths};}};
 return {base,root,legacy,store,cwd,git,head,snapshot,github,knobs,options,loop:await createIsolatedAcceptanceLoop(options)};
}
const advanceReviews=async f=>{for(let n=0;n<3;n++)assert.equal((await f.loop.poll()).mode,'REPORT_READY');};

test('automatic tick sequence: CI -> review -> prepare -> receipts -> next; restart never reexecutes',async t=>{
 const f=await fixture(t),old=await fs.readFile(path.join(f.legacy,'receipts.json'));
 const observed=[];
 for(let n=0;n<5;n++)observed.push(await f.loop.poll({execute:false}));
 assert.deepEqual(observed.map(r=>r.mode),['REPORT_READY','REPORT_READY','REPORT_READY','REPORT_READY','WAITING']);
 const receipts=(await read(f.store.file('receipts.json'))).completed;
 assert.deepEqual(receipts.map(r=>r.id),jobs.map(j=>j.id));assert.ok(receipts.every(r=>r.status==='PASS'));
 assert.equal(f.knobs.admissions,1);assert.equal(observed[3].prepared.preparedOnly,true);assert.equal(observed[3].physicalAcceptance,false);
 assert.equal(await fs.readFile(path.join(f.cwd,file),'utf8'),next);assert.equal(f.git(['rev-parse','HEAD']),f.head);assert.equal(f.git(['diff','--cached','--name-only']),'');
 assert.deepEqual(await fs.readFile(path.join(f.legacy,'receipts.json')),old);
 for(const r of receipts)assert.equal(digest(await fs.readFile(path.join(f.root,'reports',r.report))),r.reportSha256);
 const before=f.knobs.verifyCalls;f.loop=await createIsolatedAcceptanceLoop(f.options);
 assert.equal((await f.loop.poll()).reason,'NO_NEXT_ISOLATED_JOB');assert.equal(f.knobs.verifyCalls,before);
 assert.equal((await read(f.store.file('autopilot-ledger.json'))).jobs[source.id].publishedPr,undefined);
});
test('concurrent loop instances share a single select/action/receipt lock',async t=>{
 const f=await fixture(t);let release,started;
 const gate=new Promise(r=>release=r),ready=new Promise(r=>started=r);
 f.knobs.hold=async()=>{started();await gate;};
 const a=f.loop.poll();await ready;const second=await createIsolatedAcceptanceLoop(f.options);
 assert.equal((await second.poll()).mode,'BLOCKED');release();assert.equal((await a).mode,'REPORT_READY');
 assert.equal((await read(f.store.file('receipts.json'))).completed.length,1);
});
test('SIGKILL during an operation leaves a durable brake; restart cannot select a next task',async t=>{
 const f=await fixture(t),task={id:jobs[0].id,stage:'S4-G1',sha:jobs[0].head,pr:509,branch:'asi/test',repo:'ASI-integration/asi-landing'};
 const script=`import {existingState} from ${JSON.stringify(new URL('./state.mjs',import.meta.url).href)};const s=await existingState(${JSON.stringify(f.root)});await s.execute('isolated-pipeline',${JSON.stringify(task)},{verifyTask:async()=>({head:'fixture'})},async()=>{console.log('ARMED');setInterval(()=>{},1000);await new Promise(()=>{});});`;
 const child=spawn(process.execPath,['--input-type=module','-e',script],{stdio:['ignore','pipe','pipe']});
 t.after(()=>child.kill('SIGKILL'));
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('child timeout')),5000);child.stdout.once('data',()=>{clearTimeout(timer);resolve();});child.once('error',reject);});
 const closed=new Promise(r=>child.once('close',r));child.kill('SIGKILL');await closed;
 assert.equal((await read(f.store.file('autopilot-ledger.json'))).mode,'FAILED_LOCKED');
 assert.equal((await f.loop.poll()).mode,'BLOCKED');assert.equal(f.knobs.verifyCalls,0);
});
test('unexpected API failure freezes queue and does not leak raw errors',async t=>{
 const f=await fixture(t);f.knobs.throwVerify=true;assert.equal((await f.loop.poll()).mode,'FAILED_LOCKED');
 assert.equal((await f.loop.poll()).reason,'PHYSICAL_REVIEW_REQUIRED');
 assert.ok(!(await fs.readFile(f.store.file('autopilot-ledger.json'),'utf8')).includes('PRIVATE_ERROR'));
 assert.equal(f.knobs.admissions,0);
});
test('SHA changed during action records STALE and never advances',async t=>{
 const f=await fixture(t),original=f.github.verifyTask;let count=0;
 f.github.verifyTask=async task=>{const r=await original(task);return ++count>=4?{...r,head:'f'.repeat(40)}:r;};
 assert.equal((await f.loop.poll()).mode,'FAILED_LOCKED');
 assert.equal((await read(f.store.file('receipts.json'))).completed.at(-1).status,'STALE');
 assert.equal((await f.loop.poll()).mode,'FAILED_LOCKED');
});
test('corrupt receipt is preserved and holds stop lock',async t=>{
 const f=await fixture(t);await fs.writeFile(f.store.file('receipts.json'),'broken');
 assert.equal((await f.loop.poll()).mode,'FAILED_LOCKED');assert.equal(await fs.readFile(f.store.file('receipts.json'),'utf8'),'broken');
 assert.equal((await f.loop.poll()).mode,'BLOCKED');
});
test('old PUBLISHED/FAILED ledgers and old operation journals are not migrated or replayed',async t=>{
 for(const [name,data] of [['autopilot-ledger.json',{mode:'PUBLISHED'}],['autopilot-ledger.json',{mode:'FAILED_LOCKED'}],['orchestrator-state.json',{version:1,operation:{status:'STARTED'}}]]){
  const f=await fixture(t),bytes=JSON.stringify(data);await fs.writeFile(path.join(f.legacy,name),bytes);
  assert.equal((await f.loop.poll()).mode,'FAILED_LOCKED');assert.equal(f.knobs.verifyCalls,0);assert.equal(await fs.readFile(path.join(f.legacy,name),'utf8'),bytes);
 }
});
test('failed CI, unresolved concern, skipped review and outside-diff finding each lock queue',async t=>{
 for(const [key,value] of [['ci','failure'],['review','concern'],['review','skipped'],['review','outside']]){
  const f=await fixture(t);f.knobs[key]=value;assert.equal((await f.loop.poll()).mode,'FAILED_LOCKED');assert.equal(f.knobs.admissions,0);
 }
});
test('known pending check waits then resumes the same job without a failure receipt',async t=>{
 const f=await fixture(t);f.knobs.ci='pending';assert.equal((await f.loop.poll()).mode,'WAITING');
 assert.equal((await read(f.store.file('receipts.json'))).completed.length,0);
 f.knobs.ci='success';assert.equal((await f.loop.poll()).mode,'REPORT_READY');
 assert.equal((await read(f.store.file('receipts.json'))).completed[0].id,jobs[0].id);
});
test('forbidden path, bad syntax and wrong before-hash fail before a candidate write',async t=>{
 for(const edit of [{path:'../escape.py'},{content:'def = bad'},{beforeSha256:'0'.repeat(64)}]){
  const f=await fixture(t);await advanceReviews(f);Object.assign(f.options.preparePlans[source.id].changes[0],edit);
  assert.equal((await f.loop.poll()).mode,'FAILED_LOCKED');assert.equal(await fs.readFile(path.join(f.cwd,file),'utf8'),initial);
 }
});
test('preparation admission failure freezes without mutation',async t=>{
 const f=await fixture(t);await advanceReviews(f);f.knobs.denyAdmission=true;
 assert.equal((await f.loop.poll()).mode,'FAILED_LOCKED');assert.equal(await fs.readFile(path.join(f.cwd,file),'utf8'),initial);
});
test('orphan ledger, standalone adapter receipt or altered report cannot skip a pipeline phase',async t=>{
 for(const mode of ['orphan','standalone','altered']){
  const f=await fixture(t);await f.loop.poll();const ledger=await read(f.store.file('autopilot-ledger.json'));
  if(mode==='orphan')await atomicJson(f.store.file('receipts.json'),{version:1,completed:[]});
  else if(mode==='standalone'){
   const receipts=await read(f.store.file('receipts.json'));receipts.completed[0].kind='ci-reader';ledger.jobs[jobs[0].id].kind='ci-reader';
   await atomicJson(f.store.file('receipts.json'),receipts);await atomicJson(f.store.file('autopilot-ledger.json'),ledger);
  }else await fs.writeFile(path.join(f.root,'reports',ledger.jobs[jobs[0].id].report),'altered');
  const before=f.knobs.verifyCalls;assert.equal((await f.loop.poll()).mode,'FAILED_LOCKED');assert.equal(f.knobs.verifyCalls,before);
 }
});
test('changed pinned PR or main SHA cannot reuse completed work',async t=>{
 for(const change of ['pr','main']){
  const f=await fixture(t);if(change==='main')for(let n=0;n<4;n++)await f.loop.poll();else await f.loop.poll();
  if(change==='pr')f.snapshot.prs[509].head='f'.repeat(40);else f.snapshot.mainSha='f'.repeat(40);
  assert.equal((await f.loop.poll()).mode,'FAILED_LOCKED');
 }
});
test('execute:true is rejected before any GitHub read or preparation',async t=>{
 const f=await fixture(t);assert.equal((await f.loop.poll({execute:true})).mode,'FAILED_LOCKED');assert.equal(f.knobs.verifyCalls,0);assert.equal(f.knobs.admissions,0);
});
test('throwing or non-finite final clock clears single-flight without bypassing cadence',async t=>{
 for(const value of ['throw',NaN,Infinity]){
  const f=await fixture(t);let calls=0,now=1000,reads=0;
  const bridge=createReadOnlyRunnerBridge({stateDir:f.legacy,fetchSnapshot:async()=>{reads++;return f.snapshot;},clock:()=>{if(++calls===2){if(value==='throw')throw Error('clock');return value;}return now;}});
  assert.equal((await bridge.poll()).reason,'CLOCK_INVALID');now=2000;await bridge.poll();assert.equal(reads,1);now=181000;await bridge.poll();assert.equal(reads,2);
 }
});
test('newest ambiguous or wrong-SHA bot comment overrides an old clean summary',()=>{
 const head='a'.repeat(40),old={user:{login:'coderabbitai[bot]'},body:head+' No actionable comments were generated in the recent review',updated_at:'2026-10-20T01:00:00Z'};
 for(const body of ['running','b'.repeat(40)+' No actionable comments were generated in the recent review']){
  assert.equal(independentCodeRabbit([old,{...old,body,updated_at:'2026-10-20T02:00:00Z'}],head).completed,false);
 }
});
test('directory durability error propagates and retains orchestrator operation lock',async t=>{
 const f=await fixture(t),original=fs.open;let writes=0;
 fs.open=async function(p,...args){if(p===f.legacy){const err=Error('directory fsync unavailable');err.code='EINVAL';throw err;}return original.call(this,p,...args);};
 try{
  await assert.rejects(()=>atomicWriteJson(path.join(f.legacy,'probe.json'),{value:1}),{code:'EINVAL'});
  const o=createOrchestrator({stateDir:f.legacy,fetchSnapshot:async()=>f.snapshot,authorize:async e=>({approved:true,...e}),dispatch:async()=>{writes++;},verifyPublication:async()=>false});
  await assert.rejects(()=>o.iteration({execute:true}),{code:'EINVAL'});assert.equal(writes,0);
  assert.ok((await fs.stat(path.join(f.legacy,'orchestrator-iteration.lock'))).isFile());
 }finally{fs.open=original;}
});
test('unknown result and concurrent atomic writes fail closed or retain complete JSON',async t=>{
 const f=await fixture(t),task={id:'unknown-result',stage:'S4-G1',repo:'ASI-integration/asi-landing',sha:f.head,pr:null,branch:'asi/isolated'};
 await Promise.all(Array.from({length:8},(_,i)=>atomicJson(f.store.file('probe.json'),{i,text:'x'.repeat(2000)})));
 assert.equal((await read(f.store.file('probe.json'))).text.length,2000);assert.equal((await fs.readdir(path.join(f.root,'state'))).some(n=>n.endsWith('.tmp')),false);
 assert.equal((await f.store.execute('unknown',task,f.github,async()=>({ok:true}))).mode,'FAILED_LOCKED');
 assert.equal((await f.loop.poll()).mode,'FAILED_LOCKED');
});
