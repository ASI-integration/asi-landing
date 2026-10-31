// Isolated local-adapter acceptance. PR/CI authority below is a labelled fixture,
// never a production grant, remote publication or physical stage acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync,spawn} from 'node:child_process';
import {once} from 'node:events';
import {createProductAdapter,decomposeProductGoal,hash} from './product-adapters.mjs';
import {createGlobalDispatcher,initializeRoutingState} from './dispatcher.mjs';
import {prepareDelta} from '../strigunov4/execution-adapters/change-preparer.mjs';
import {initializeState,digest} from '../strigunov4/execution-adapters/state.mjs';

async function fixture(t){
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'asi-goal-route-'));
 t.after(()=>fs.rm(base,{recursive:true,force:true}));
 const stateDir=path.join(base,'routing');await fs.mkdir(stateDir,{mode:0o700});await initializeRoutingState(stateDir);
 const contract={schema:'asi.product-route.v1',id:'source-product',repository:'ASI-integration/asi-landing',execution:'disabled',
  goal:{result:'Verify three isolated source changes',criteria:['verified-result']},
  evidence:['tests','review','pr','ci','report'],stages:[{id:'source',criteria:['verified-result'],dependsOn:[]}],
  functions:['prepare-source'],tools:['existing-runner-bridge'],paths:['scripts/result.py'],maxAttemptsPerTask:1,maxPlansPerStage:3};
 const work=(id,dependsOn,covers,priority)=>({id,stage:'source',operation:'prepare-source',tool:'existing-runner-bridge',
  paths:['scripts/result.py'],dependsOn,covers,priority,requiredAuthority:['isolated-source-fixture'],
  cost:{requests:0,mutations:0,computeMs:1000,paidMicrousd:0}});
 const catalog=[work('prepare-left',[],[],30),work('prepare-right',[],[],20),
  work('verify-combined',['prepare-left','prepare-right'],['verified-result'],10)];
 const goal={id:'structured-source-goal',product:contract.id,repository:contract.repository,head:'a'.repeat(40),
  criteria:['verified-result'],priority:50,notBefore:100,expiresAt:100000,
  budget:{maxTasks:3,maxRequests:0,maxMutations:0,maxComputeMs:3000,maxPaidMicrousd:0}};
 const proofs=new Set(),now={value:1000};
 const adapter=()=>createProductAdapter(contract,{workOrders:catalog,maxConcurrentPlans:2,
  clock:()=>now.value,verifyEvidence:e=>proofs.has(hash(e))});
 const snapshot=()=>({product:contract.id,contractHash:adapter().contractHash,head:goal.head,goal,
  stages:[{id:'source',status:'OPEN'}],tasks:decomposeProductGoal(contract,goal,catalog,{now:now.value}).nodes.map(n=>({...structuredClone(n),status:'READY'}))});
 const evidence=(subject,criteria)=>{const e={product:contract.id,contractHash:adapter().contractHash,repository:contract.repository,
  head:goal.head,subject,criteria,tests:'PASS',review:'PASS',ci:'PASS',pr:{number:1,head:goal.head},
  report:'ISOLATED_PROTOCOL_FIXTURE_NO_REAL_PR'};proofs.add(hash(e));return e;};
 const dispatcher=()=>createGlobalDispatcher({stateDir,adapters:[adapter()]});
 const read=async()=>JSON.parse(await fs.readFile(path.join(stateDir,'routing.json'),'utf8'));
 return {base,stateDir,contract,catalog,goal,proofs,now,adapter,snapshot,evidence,dispatcher,read};
}

test('structured goal persists one graph; bounded reservations, dependencies and terminal checkpoints survive recreation',async t=>{
 const f=await fixture(t),s=f.snapshot(),first=await f.dispatcher().plan({[f.contract.id]:s});
 assert.equal(first.selected.task.id,'prepare-left');assert.equal(first.selected.executable,false);
 const graph=(await f.read()).state.products[0].goalGraph;
 assert.equal(first.selected.goalPlanHash,graph.planHash);assert.equal(graph.nodes.length,3);
 assert.equal((await f.dispatcher().plan({[f.contract.id]:s})).selected.task.id,'prepare-right');
 const full=await f.dispatcher().plan({[f.contract.id]:s});assert.equal(full.status,'BLOCKED');assert.equal(full.selected,null);
 for(const task of s.tasks.slice(0,2)){task.status='ACCEPTED';task.nextAction='Verified local result';task.evidence=f.evidence('task:'+task.id,[task.id]);}
 assert.equal((await f.dispatcher().plan({[f.contract.id]:s})).selected.task.id,'verify-combined');
 const last=s.tasks.at(-1);last.status='ACCEPTED';last.nextAction='Verified local result';last.evidence=f.evidence('task:'+last.id,[last.id]);
 s.stages[0]={id:'source',status:'ACCEPTED',evidence:f.evidence('stage:source',['verified-result'])};
 s.goalEvidence=f.evidence('goal',['verified-result']);
 assert.equal((await f.dispatcher().plan({[f.contract.id]:s})).status,'ACCEPTED');
 assert.equal((await f.dispatcher().plan({[f.contract.id]:s})).selected,null);
 const final=(await f.read()).state.products[0];assert.deepEqual(final.goalGraph,graph);
 assert.equal(final.planned.length,3);assert.equal(final.terminal.length,3);
});

test('changed or expired goal cannot replace the retained graph or reissue work',async t=>{
 const f=await fixture(t),s=f.snapshot();await f.dispatcher().plan({[f.contract.id]:s});
 const graph=(await f.read()).state.products[0].goalGraph;
 s.goal={...s.goal,expiresAt:99999};const changed=await f.dispatcher().plan({[f.contract.id]:s});
 assert.equal(changed.selected,null);assert.equal(changed.products[0].reason,'GOAL_CHANGE_REQUIRES_RECONCILIATION');
 assert.deepEqual((await f.read()).state.products[0].goalGraph,graph);
 f.now.value=100001;const expired=await f.dispatcher().plan({[f.contract.id]:s});
 assert.equal(expired.selected,null);assert.equal(expired.products[0].reason,'GOAL_WINDOW_INVALID');
 assert.equal((await f.read()).state.products[0].planned.length,1);
});

test('missing or revoked independent proof blocks downstream work without rewriting completed history',async t=>{
 const f=await fixture(t),s=f.snapshot();await f.dispatcher().plan({[f.contract.id]:s});
 const node=s.tasks[0];node.status='ACCEPTED';node.nextAction='Fixture result';node.evidence=f.evidence('task:'+node.id,[node.id]);
 await f.dispatcher().plan({[f.contract.id]:s});f.proofs.clear();
 const r=await f.dispatcher().plan({[f.contract.id]:s});assert.equal(r.selected,null);
 assert.equal(r.products[0].reason,'EXACT_RESULT_EVIDENCE_REQUIRED');
 assert.equal((await f.read()).state.products[0].terminal[0].status,'ACCEPTED');
});

test('SIGKILL inside real routing transaction preserves journal and stop marker on restart',async t=>{
 const f=await fixture(t),before=await fs.readFile(path.join(f.stateDir,'routing.json'),'utf8');
 const dispatcherUrl=new URL('./dispatcher.mjs',import.meta.url).href;
 const code=`import {createGlobalDispatcher} from ${JSON.stringify(dispatcherUrl)};
 const x=JSON.parse(process.argv[1]);const adapter={id:x.contract.id,contract:x.contract,contractHash:x.contractHash,
 evaluate(){process.kill(process.pid,'SIGKILL');}};
 await createGlobalDispatcher({stateDir:x.stateDir,adapters:[adapter]}).plan({[x.contract.id]:{}});`;
 const child=spawn(process.execPath,['--input-type=module','-e',code,JSON.stringify({stateDir:f.stateDir,
  contract:f.contract,contractHash:f.adapter().contractHash})],{stdio:'ignore'});
 assert.equal((await once(child,'exit'))[1],'SIGKILL');
 assert.equal(await fs.readFile(path.join(f.stateDir,'routing.json'),'utf8'),before);
 assert.equal((await f.dispatcher().plan({[f.contract.id]:f.snapshot()})).status,'FAILED_LOCKED');
 assert.ok((await fs.stat(path.join(f.stateDir,'routing.lock'))).isFile());
});

test('goal routing drives real isolated parallel preparation and existing Engine receipt; no remote publication',async t=>{
 const f=await fixture(t),root=path.join(f.base,'engine');await fs.mkdir(root,{mode:0o700});
 const store=await initializeState(root),origin=path.join(f.base,'origin');await fs.mkdir(origin,{mode:0o700});
 const git=(cwd,args)=>execFileSync('/usr/bin/git',['-c','core.hooksPath=/dev/null',...args],{cwd,stdio:'pipe'}).toString().trim();
 git(origin,['init']);await fs.mkdir(path.join(origin,'scripts'));await fs.writeFile(path.join(origin,'scripts/result.py'),'VALUE = 0\n');
 git(origin,['add','.']);git(origin,['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','isolated baseline']);
 f.goal.head=git(origin,['rev-parse','HEAD']);const s=f.snapshot(),outputs=[];
 for(const task of s.tasks){const dir=path.join(root,'scratchpads',task.id);git(f.base,['clone','--no-local',origin,dir]);git(dir,['checkout','--detach',f.goal.head]);await fs.chmod(dir,0o700);}
 let active=0,maximum=0;
 const prepare=async selected=>{
  active++;maximum=Math.max(maximum,active);
  const task={id:selected.task.id,repo:f.contract.repository,stage:'S4-G1',sha:f.goal.head,pr:null,branch:'asi/engine-task/'+selected.task.id};
  // Explicit fixture admission is separate from the advisory selected object.
  assert.equal(selected.authority,null);assert.equal(selected.executable,false);
  const content='VALUE = '+JSON.stringify(task.id)+'\n';
  const result=await prepareDelta(store,task,{admission:{taskId:task.id,head:task.sha,stage:task.stage,
   mode:'ISOLATED_PREPARE_ONLY',paths:['scripts/result.py']},changes:[{path:'scripts/result.py',beforeSha256:digest('VALUE = 0\n'),content}]});
  const filename=path.join(root,'scratchpads',task.id,'scripts/result.py');
  execFileSync('/usr/bin/python3',['-I','-S','-c','import pathlib,sys;assert pathlib.Path(sys.argv[1]).read_text()==sys.argv[2]',filename,content],{stdio:'pipe'});
  outputs.push({id:task.id,deltaSha256:result.deltaSha256});const node=s.tasks.find(n=>n.id===task.id);
  node.status='ACCEPTED';node.nextAction='Independent local byte verification';node.evidence=f.evidence('task:'+node.id,[node.id]);
  active--;
 };
 const a=(await f.dispatcher().plan({[f.contract.id]:s})).selected;
 const b=(await f.dispatcher().plan({[f.contract.id]:s})).selected;
 await Promise.all([prepare(a),prepare(b)]);
 assert.equal(maximum,2);assert.equal(active,0);
 await prepare((await f.dispatcher().plan({[f.contract.id]:s})).selected);
 const job={id:'isolated-goal-receipt',repo:f.contract.repository,stage:'S4-G1',sha:f.goal.head,pr:null,branch:'asi/engine-task/isolated-goal-receipt'};
 const github={verifyTask:async()=>({fixture:true,head:job.sha})};
 const result=await store.execute('goal-prepare',job,github,async()=>({status:'PASS',
  artifactType:'LOCAL_REPORT_ONLY',goalPlanHash:a.goalPlanHash,outputs,remotePublication:false,physicalAcceptance:false}));
 assert.equal(result.mode,'REPORT_READY');assert.equal(outputs.length,3);
 assert.equal((await store.execute('goal-prepare',job,github,()=>{throw Error('MUST_NOT_REPEAT');})).mode,'WAITING');
 const receipt=JSON.parse(await fs.readFile(store.file('receipts.json'))).completed[0];
 assert.equal(receipt.reportSha256,digest(await fs.readFile(path.join(root,'reports',receipt.report))));
});

test('task triage refuses no-value work BEFORE a durable routing reservation',async t=>{
 const f=await fixture(t),s=f.snapshot();
 const triage=()=>({schema:'asi.task-value-assessment.v1',
   taskId:'wrong-id',goalPlanHash:'b'.repeat(64),decision:'ACCEPTED',
   outcome:'Unhelpful task',expectedBenefit:'No measurable product value',
   acceptanceEvidence:['verified-result'],reason:'Unverified input',
   alternative:'Provide a legitimate scoped goal.',possibleDuplicates:[]});
 const dispatcher=()=>createGlobalDispatcher({stateDir:f.stateDir,
   adapters:[{...f.adapter(),triage}]});
 const first=await dispatcher().plan({[f.contract.id]:s});
 assert.equal(first.selected,null);
 assert.equal(first.status,'BLOCKED');
 assert.equal(first.products[0].intakeDecision.status,'NEEDS_OWNER_DECISION');
 const data=(await f.read()).state.products[0];
 assert.equal(data.planned.length,0);
 assert.equal(data.intake.length,2);
 assert.equal(data.intake[0].status,'NEEDS_OWNER_DECISION');
 const second=await dispatcher().plan({[f.contract.id]:s});
 assert.equal(second.selected,null);assert.equal((await f.read()).state.products[0].intake.length,2);
});
test('triage records one accepted job, rejects same deliverable with new ID',async t=>{
 const f=await fixture(t),s=f.snapshot();
 const triage=({candidate,goalGraph})=>({
   schema:'asi.task-value-assessment.v1',taskId:candidate.id,
   goalPlanHash:goalGraph.planHash,decision:'ACCEPTED',
   outcome:'Complete the same observable release upgrade',
   expectedBenefit:'A verified active Engine on Beget with real durable receipt',
   acceptanceEvidence:['verified-result'],reason:'Task has an observable product result',
   alternative:'Continue the already admitted task.',possibleDuplicates:[]});
 const dispatcher=()=>createGlobalDispatcher({stateDir:f.stateDir,
   adapters:[{...f.adapter(),triage}]});
 const first=await dispatcher().plan({[f.contract.id]:s});
 assert.equal(first.selected.task.id,'prepare-left');
 assert.equal(first.selected.executable,false);assert.equal(first.selected.authority,null);
 const second=await dispatcher().plan({[f.contract.id]:s});
 assert.equal(second.selected,null);
 const state=(await f.read()).state.products[0];
 assert.equal(state.planned.length,1);
 assert.equal(state.intake.find(x=>x.id==='prepare-right').status,'DUPLICATE');
});
test('same protected path with a different goal cannot run concurrently',async t=>{
 const f=await fixture(t),s=f.snapshot();
 const triage=({candidate,goalGraph})=>({
   schema:'asi.task-value-assessment.v1',taskId:candidate.id,
   goalPlanHash:goalGraph.planHash,decision:'ACCEPTED',
   outcome:'Deliver specifically '+candidate.id+' to real production',
   expectedBenefit:'One observable useful change with a physical receipt',
   acceptanceEvidence:['verified-result'],reason:'Within product goal',
   alternative:'Wait for first committed task.',possibleDuplicates:[]});
 const dispatcher=()=>createGlobalDispatcher({stateDir:f.stateDir,
   adapters:[{...f.adapter(),triage}]});
 assert.equal((await dispatcher().plan({[f.contract.id]:s})).selected.task.id,'prepare-left');
 const second=await dispatcher().plan({[f.contract.id]:s});
 assert.equal(second.selected,null);
 assert.equal((await f.read()).state.products[0].intake[1].status,'BLOCKED_DEPENDENCY');
});
