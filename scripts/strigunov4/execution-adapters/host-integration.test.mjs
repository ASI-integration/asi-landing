import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {generateKeyPairSync,sign} from 'node:crypto';
import {execFileSync,spawn} from 'node:child_process';
import {verifySignedArtifact,ENGINE_ROOT,LEGACY_STATE} from './host-authority.mjs';
import {verifyAppPermissions,APP_PERMISSIONS} from './host-github-app.mjs';
import {parseIndependentReview,sandboxArguments,REVIEW_DISABLED_TOOLS,DISABLED_CODE_MODE_NOTE} from './host-checks.mjs';
import {createHostSnapshot} from './host-runtime.mjs';
import {pilotTask} from './host-package.mjs';
import {initializeState,existingState,digest} from './state.mjs';
import {prepareDelta} from './change-preparer.mjs';
import {fixture,makeLoop} from './publisher-fixture.mjs';
const base='a'.repeat(40),delta='b'.repeat(64),e={taskId:'pilot',baseSha:base,deltaSha256:delta};
function signed(overrides={}){
 const keys=generateKeyPairSync('ed25519'),payload=JSON.stringify({schema:'asi.engine-activation.v1',repo:'ASI-integration/asi-landing',
 root:ENGINE_ROOT,legacyStateDir:LEGACY_STATE,stage:'S4-G1',host:'asi-agent-runner',service:'asi-strigunov-agent.service',ownerApprovalId:'OFFLINE_TEST_ONLY',
 githubApp:{appId:123,installationId:456},ciPolicies:[{name:'validate',workflowId:311380800},
 {name:'release_governance',workflowId:390653294,event:'pull_request_target'}],
 notBefore:1,expiresAt:2000,runnerSha256:delta,catalogSha256:delta,baseSha:base,automaticCiApproved:true,automaticReviewApproved:true,...overrides});
 return {key:keys.publicKey.export({type:'spki',format:'pem'}),envelope:{payload,signature:sign(null,Buffer.from(payload),keys.privateKey).toString('base64')}};
}
test('signed activation rejects changed bytes, foreign key and expiry',()=>{
 const s=signed();assert.equal(verifySignedArtifact(s.envelope,s.key,1000).baseSha,base);
 assert.throws(()=>verifySignedArtifact({...s.envelope,payload:s.envelope.payload+' '},s.key,1000),/SIGNATURE/);
 assert.throws(()=>verifySignedArtifact(s.envelope,signed().key,1000),/SIGNATURE/);
 assert.throws(()=>verifySignedArtifact(s.envelope,s.key,2000),/EXPIRY/);
 for(const override of [{githubApp:null},{githubApp:{appId:0,installationId:1}},{ciPolicies:[]},
   {ciPolicies:[{name:'validate',workflowId:1},{name:'release_governance',workflowId:390653294,event:'pull_request_target'}]},
   {host:'another-host'}]){
  const bad=signed(override);assert.throws(()=>verifySignedArtifact(bad.envelope,bad.key,1000),/SCOPE_OR_EXPIRY/);
 }
});
test('live state cannot be opened by a fabricated boolean admission',async()=>{
 await assert.rejects(existingState(ENGINE_ROOT,{liveAdmission:{approved:true,root:ENGINE_ROOT}}),/LIVE_ADMISSION/);
 await assert.rejects(existingState(ENGINE_ROOT),/LIVE_ROOT_FORBIDDEN/);
});
test('GitHub App rejects broad or missing permissions',()=>{
 verifyAppPermissions(APP_PERMISSIONS);
 for(const p of [{...APP_PERMISSIONS,administration:'write'},{...APP_PERMISSIONS,actions:'write'},{}])
  assert.throws(()=>verifyAppPermissions(p),/PERMISSION_SCOPE/);
});
function stream(answer,extra=[]){return [{type:'thread.started',thread_id:'offline-review'},
 {type:'turn.started'},...extra,{type:'item.completed',item:{type:'agent_message',text:JSON.stringify(answer)}},{type:'turn.completed'}].map(x=>JSON.stringify(x)).join('\n');}
test('independent reviewer requires complete exact-delta evidence without tool use',()=>{
 const answer={status:'PASS',baseSha:base,deltaSha256:delta,findings:[]};
 assert.equal(parseIndependentReview(stream(answer),e).independent,true);
 for(const a of [{...answer,deltaSha256:'c'.repeat(64)},{...answer,findings:['bug']},{...answer,status:'FAIL'}])
  assert.throws(()=>parseIndependentReview(stream(a),e),/REVIEW_FINDINGS/);
 assert.throws(()=>parseIndependentReview(stream(answer,[{type:'item.started',item:{type:'command_execution'}}]),e),/REVIEW_TOOL_USE/);
 assert.throws(()=>parseIndependentReview(stream(answer).split('\n').slice(0,-1).join('\n'),e),/INCOMPLETE/);
 const note={type:'item.completed',item:{type:'error',message:DISABLED_CODE_MODE_NOTE}};
 const pre=stream(answer).split('\n');pre.splice(1,0,JSON.stringify(note));
 assert.equal(parseIndependentReview(pre.join('\n'),e).status,'PASS');
 assert.throws(()=>parseIndependentReview(stream(answer,[note]),e),/REVIEW_TOOL_USE/);
 pre.splice(1,0,JSON.stringify(note));assert.throws(()=>parseIndependentReview(pre.join('\n'),e),/REVIEW_TOOL_USE/);
});
test('fixed sandbox exposes neither host home nor network or caller command',()=>{
 const args=sandboxArguments('/isolated/scratch');assert.ok(args.includes('--unshare-all'));
 assert.ok(args.includes('--clearenv'));assert.ok(!args.includes('/home'));
 assert.equal(args.filter(x=>x==='--ro-bind').length,3);
 assert.ok(args.at(-1).includes('test_receipt_replay_flag_requires_literal_false'));
 for(const feature of ['shell_tool','unified_exec','apps','plugins','browser_use','computer_use','multi_agent','hooks'])
  assert.ok(REVIEW_DISABLED_TOOLS.includes(feature));
});
test('pilot sandbox needs no procfs mount under ProtectKernelTunables',()=>{
 const args=sandboxArguments('/isolated/scratch');
 // A masked parent /proc rejects a new proc mount in bwrap's user namespace.
 // The fixed Python unittest needs no procfs; neither mount nor expose it.
 assert.ok(!args.includes('--proc'));
 assert.ok(!args.includes('/proc'));
 assert.ok(args.includes('--unshare-all'));
 assert.ok(args.includes('--clearenv'));
 assert.deepEqual(args.slice(args.indexOf('/usr/bin/python3'),-1),['/usr/bin/python3','-I','-S','-B','-c']);
});
test('host snapshot ignores fresh checkedAt drift but retains all admission changes',async t=>{
 const f=await fixture(t),repo='ASI-integration/asi-landing';
 let now=1792751800000,age=0,gate='PREPARATION_ONLY',main=f.sha,issueState='open';
 t.mock.method(Date,'now',()=>now);
 const reader={get:async r=>r==='branches/main'?{protected:true,commit:{sha:main}}:
 r==='issues/511'?{number:511,state:issueState,title:'[S4-G1] test',labels:[]}:
 {...f.snapshot.prs[Number(r.split('/')[1])],head:{sha:f.snapshot.prs[Number(r.split('/')[1])].head,repo:{full_name:repo}},base:{ref:'main',repo:{full_name:repo}}}};
 const fetch=createHostSnapshot({reader,contract:f.snapshot.contract,baseSha:f.sha,
  readProjectGates:async()=>({source:'github-projects-v2',checkedAt:new Date(now-age).toISOString(),items:[{issue:511,stage:'S4-G1',gate}]})});
 const original=JSON.stringify(await fetch());now+=1000;
 assert.equal(JSON.stringify(await fetch()),original);
 gate='BLOCKED';assert.notEqual(JSON.stringify(await fetch()),original);gate='PREPARATION_ONLY';
 f.snapshot.prs[509].head='c'.repeat(40);assert.notEqual(JSON.stringify(await fetch()),original);
 age=30000;await assert.rejects(fetch(),/PROJECT_SNAPSHOT_STALE/);
 age=-1;await assert.rejects(fetch(),/PROJECT_SNAPSHOT_STALE/);age=0;
 main='d'.repeat(40);await assert.rejects(fetch(),/MAIN_CHANGED/);main=f.sha;
 issueState='closed';await assert.rejects(fetch(),/ISSUE_UNVERIFIED/);issueState='open';
 f.snapshot.contract.stages[0].status='ACCEPTED';f.snapshot.contract.stages[1].status='IN_PROGRESS';
 await assert.rejects(fetch(),/ACTIVE_ISSUE_NOT_VERIFIED/);
});
test('subprocess failure after prepare remains locked without another check or publication',async t=>{
 const f=await fixture(t),now={value:1000000};let checks=0,reviews=0;
 const options={now,runChecks:async()=>{checks++;throw Error('HOST_PROCESS_FAILED');},
  independentReview:async()=>{reviews++;throw Error('MUST_NOT_REVIEW');}};
 const result=await (await makeLoop(f,options)).poll({execute:true});
 assert.equal(result.mode,'FAILED_LOCKED');assert.equal(result.reason,'UNHANDLED_OR_UNKNOWN_RESULT');
 const stateDir=path.join(f.root,'state'),names=await fs.readdir(stateDir);
 assert.ok(!names.some(n=>n.startsWith('publication-')));
 const before=await Promise.all(names.map(n=>fs.readFile(path.join(stateDir,n))));
 now.value+=180001;
 assert.equal((await (await makeLoop(f,options)).poll({execute:true})).reason,'PHYSICAL_REVIEW_REQUIRED');
 assert.deepEqual(await Promise.all(names.map(n=>fs.readFile(path.join(stateDir,n)))),before);
 assert.equal(checks,1);assert.equal(reviews,0);assert.equal(f.writes.length,0);
});
test('publication still denies changed authority, main and product gate',async t=>{
 for(const changed of ['authority','main','gate'])await t.test(changed,async t=>{
  const f=await fixture(t);
  const options=changed==='authority'?{authorize:async()=>({approved:false})}:{
   runChecks:async e=>{
    if(changed==='main')f.state.main='e'.repeat(40);
    else f.snapshot.project[511]='BLOCKED';
    return {...e,status:'PASS'};
   }};
  assert.equal((await (await makeLoop(f,options)).poll({execute:true})).mode,'FAILED_LOCKED');
  assert.equal(f.writes.length,0);
 });
});
test('isolated recovery rehearsal preserves failed generation and publishes only once',async t=>{
 // Model of a separately owner-approved recovery, NOT an automatic reset API.
 const f=await fixture(t);f.catalog=f.catalog.slice(0,1);const now={value:1000000};
 assert.equal((await (await makeLoop(f,{now,runChecks:async()=>{throw Error('HOST_PROCESS_FAILED');}})).poll({execute:true})).mode,'FAILED_LOCKED');
 assert.equal(f.writes.length,0);assert.equal(f.refs.size,0);assert.equal(f.pulls.size,0);
 async function hashes(dir){
  const result={};for(const name of (await fs.readdir(dir)).sort()){
   const p=path.join(dir,name),st=await fs.lstat(p);
   result[name]=st.isDirectory()?await hashes(p):{sha256:digest(await fs.readFile(p)),mode:st.mode};
  }return result;
 }
 const before=await hashes(f.root),archive=f.root+'.failed';await fs.rename(f.root,archive);
 await fs.mkdir(f.root,{mode:0o700});await initializeState(f.root);
 const task=f.catalog[0],cwd=path.join(f.root,'scratchpads',task.id);
 execFileSync('/usr/bin/git',['clone','-q','--no-hardlinks',path.join(f.base,'seed'),cwd]);
 execFileSync('/usr/bin/git',['-c','core.hooksPath=/dev/null','checkout','-q','--detach',task.sha],{cwd});await fs.chmod(cwd,0o700);
 const options={now,authorize:async request=>({approved:true,request,automaticCiApproved:true,
  automaticReviewApproved:true,operationId:'separately-approved-recovery-model',expiresAt:999999999})};
 assert.equal((await (await makeLoop(f,options)).poll({execute:true})).mode,'REPORT_READY');
 const writes=f.writes.length;assert.equal(f.writes.filter(p=>p==='pulls').length,1);
 now.value+=180001;
 assert.equal((await (await makeLoop(f,options)).poll({execute:true})).reason,'NO_APPROVED_PUBLICATION_TASK');
 assert.equal(f.writes.length,writes);assert.deepEqual(await hashes(archive),before);
});
test('live snapshot rejects stale projects and an advanced stage',async()=>{
 const f={schemaVersion:'asi.demo-release.v1',releaseId:'STRIGUNOV4-READY-FOR-DEMO',state:'FROZEN_ON_OWNER_MERGE',
 stages:[1,2,3,4,5,6].map(i=>({id:'S4-G'+i,status:i===1?'IN_PROGRESS':'NOT_STARTED'}))};
 const reader={get:async r=>r==='branches/main'?{protected:true,commit:{sha:base}}:
 r==='issues/511'?{number:511,state:'open',title:'[S4-G1] test',labels:[]}:{}};
 const fetch=createHostSnapshot({reader,contract:f,baseSha:base,readProjectGates:async()=>({source:'github-projects-v2',checkedAt:'2000-01-01',items:[]})});
 await assert.rejects(fetch(),/PROJECT_SNAPSHOT_STALE/);
 f.stages[0].status='ACCEPTED';f.stages[1].status='IN_PROGRESS';await assert.rejects(fetch(),/ISSUE_NOT_VERIFIED/);
});
test('actual complete ASI clone prepares existing-file pilot without skipping the large asset',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'asi-host-full-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const store=await initializeState(dir),repo=fileURLToPath(new URL('../../..',import.meta.url));
 const sha='b27b07bfffb317ec9a93caf6361d54956a7f12ae';
 // CI fetches history explicitly. Missing evidence fails; never call a skip PASS.
 execFileSync('git',['cat-file','-e',sha+'^{commit}'],{cwd:repo});
 const source=execFileSync('git',['show',sha+':scripts/strigunov4/test_c4_unit_readonly.py'],{cwd:repo,encoding:'utf8'});
 const task=pilotTask(source,sha),cwd=path.join(dir,'scratchpads',task.id);
 execFileSync('git',['clone','-q','--no-hardlinks',repo,cwd]);execFileSync('git',['checkout','-q','--detach',sha],{cwd});await fs.chmod(cwd,0o700);
 const prepared=await prepareDelta(store,task,{admission:{taskId:task.id,head:sha,stage:'S4-G1',mode:'ISOLATED_PREPARE_ONLY',paths:task.changes.map(c=>c.path)},changes:task.changes});
 assert.equal(prepared.files.length,1);assert.equal(prepared.status,'PASS');
 // Trusted, exact small unittest in this isolated disposable copy. This is NOT
 // acceptance of the production bwrap sandbox, which must be rehearsed on host.
 execFileSync('/usr/bin/python3',['-I','-S','-B','-c',"import sys,unittest;sys.path.insert(0,'.');s=unittest.defaultTestLoader.loadTestsFromName('test_c4_unit_readonly.UnitReadonlyTests.test_receipt_replay_flag_requires_literal_false');r=unittest.TextTestRunner().run(s);sys.exit(not r.wasSuccessful())"],{cwd:path.join(cwd,'scripts/strigunov4')});
 assert.equal(digest(await fs.readFile(path.join(cwd,'design-reference/asi-global-osaka-reference.png'))),'9148e7aff7cffc9535e1cba15ee8099adaec42005936d2aae83c2f9d1ddb2916');
});
test('new files and YAML remain denied by the actual preparer',async t=>{
 const f=await fixture(t),store=await existingState(f.root),cwd=path.join(f.root,'scratchpads',f.catalog[0].id);
 const workflow='.github/workflows/fixture.yml',source='name: fixture\n';
 await fs.mkdir(path.join(cwd,'.github/workflows'),{recursive:true});await fs.writeFile(path.join(cwd,workflow),source);
 execFileSync('git',['add',workflow],{cwd});
 execFileSync('git',['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','seed existing YAML'],{cwd});
 const task={...f.catalog[0],sha:execFileSync('git',['rev-parse','HEAD'],{cwd,encoding:'utf8'}).trim()};
 const options=(file,before)=>({admission:{taskId:task.id,head:task.sha,stage:'S4-G1',mode:'ISOLATED_PREPARE_ONLY',paths:[file]},
  changes:[{path:file,content:'x: true',beforeSha256:before}]});
 await assert.rejects(prepareDelta(store,task,options('scripts/strigunov4/new.py',delta)),{code:'ENOENT'});
 await assert.rejects(prepareDelta(store,task,options(workflow,digest(source))),/NO_APPROVED_SYNTAX_CHECKER/);
 assert.equal(await fs.readFile(path.join(cwd,workflow),'utf8'),source);
});
test('existing publisher resumes a confirmed publication once and then becomes idle',async t=>{
 const f=await fixture(t,{ci:'pending'});f.catalog=f.catalog.slice(0,1);const now={value:1000000};
 assert.equal((await (await makeLoop(f,{now})).poll({execute:true})).mode,'WAITING');
 const writes=f.writes.length;f.state.ci='success';now.value+=180001;
 assert.equal((await (await makeLoop(f,{now})).poll({execute:true})).mode,'REPORT_READY');
 now.value+=180001;assert.equal((await (await makeLoop(f,{now})).poll({execute:true})).reason,'NO_APPROVED_PUBLICATION_TASK');
 assert.equal(f.writes.length,writes);
});
test('lost network response freezes publication and restart cannot repeat it',async t=>{
 const f=await fixture(t,{loseResponse:'git/refs'}),now={value:1000000};
 assert.equal((await (await makeLoop(f,{now,timeoutMs:100})).poll({execute:true})).mode,'FAILED_LOCKED');
 const writes=f.writes.length;now.value+=180001;
 assert.equal((await (await makeLoop(f,{now})).poll({execute:true})).mode,'FAILED_LOCKED');assert.equal(f.writes.length,writes);
});
test('orphaned legacy lock blocks publication without deleting evidence',async t=>{
 const f=await fixture(t);const lock=path.join(f.legacy,'orchestrator-iteration.lock');
 await fs.writeFile(lock,'uncertain old operation');
 assert.equal((await (await makeLoop(f)).poll({execute:true})).mode,'FAILED_LOCKED');
 assert.equal(f.writes.length,0);assert.equal(await fs.readFile(lock,'utf8'),'uncertain old operation');
});
test('SIGKILL leaves durable stop marker across a real process restart',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'asi-host-kill-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));await initializeState(dir);
 const stateModule=new URL('./state.mjs',import.meta.url).href;
 const child=spawn(process.execPath,['--input-type=module','-e',`import {existingState} from ${JSON.stringify(stateModule)}; const s=await existingState(${JSON.stringify(dir)});await s.execute('pilot',async()=>{setInterval(()=>{},1000);console.log('ARMED');await new Promise(()=>{});},{},()=>{});`],{stdio:['ignore','pipe','pipe']});
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('CHILD_TIMEOUT'));},3000);
 child.stdout.once('data',()=>{clearTimeout(timer);resolve();});child.once('error',reject);});
 const closed=new Promise(r=>child.once('close',r));child.kill('SIGKILL');await closed;
 const r=await (await existingState(dir)).execute('pilot',()=>{throw Error('MUST_NOT_REPLAY');},{},()=>{});
 assert.equal(r.reason,'LOCK_HELD_OR_CRASHED_REQUIRES_REVIEW');
});
