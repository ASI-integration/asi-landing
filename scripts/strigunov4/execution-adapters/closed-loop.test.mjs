import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {closedFixture,makeClosedLoop,readState,tick} from './closed-loop-fixture.mjs';
import {makeLoop} from './publisher-fixture.mjs';
const advance=f=>{f.now.value+=180000;};

test('three full cycles: pending PR -> verified first order -> different order; receipt feedback and restart',async t=>{
 const f=await closedFixture(t,{ci:'pending'});let loop=await makeClosedLoop(f);
 const legacy=await fs.readFile(path.join(f.legacy,'receipts.json'));
 assert.equal((await tick(loop)).mode,'WAITING');assert.equal(f.pulls.size,1);
 assert.equal((await readState(f,'receipts.json')).completed.length,0);
 f.state.ci='success';advance(f);loop=await makeClosedLoop(f);
 assert.equal((await tick(loop)).mode,'REPORT_READY');assert.equal(f.pulls.size,1);
 advance(f);assert.equal((await tick(loop)).mode,'REPORT_READY');assert.equal(f.pulls.size,2);
 const receipts=await readState(f,'receipts.json');assert.equal(receipts.completed.length,2);
 assert.equal(new Set(f.catalog.map(t=>t.workOrderId)).size,2);
 advance(f);loop=await makeClosedLoop(f);assert.equal((await tick(loop)).reason,'NO_ELIGIBLE_APPROVED_TASK');
 const routing=JSON.parse(await fs.readFile(path.join(f.routing,'routing.json'))).state.products[0];
 assert.equal(routing.terminal.length,2);assert.equal(routing.planned.length,2);
 assert.deepEqual(f.writes,['git/trees','git/commits','git/refs','pulls','git/trees','git/commits','git/refs','pulls']);
 assert.equal(f.requests.some(r=>r.url.includes('/statuses')||r.url==='/graphql'),false,'no CodeRabbit dependency');
 assert.deepEqual(await fs.readFile(path.join(f.legacy,'receipts.json')),legacy);
});
test('fresh repeated polling is rate limited without network or duplicate source preparation',async t=>{
 const f=await closedFixture(t,{ci:'pending'});let loop=await makeClosedLoop(f);await tick(loop);
 const count=f.requests.length;loop=await makeClosedLoop(f);
 assert.equal((await tick(loop)).reason,'POLL_RATE_LIMITED');assert.equal(f.requests.length,count);assert.equal(f.pulls.size,1);
});
test('missing, expired, forged and over-14-day stage grants block before publication',async t=>{
 for(const change of [f=>{f.comments.length=0},f=>{f.now.value=f.policy.expiresAt},f=>{f.comments[0].user.id=1},
  f=>{f.policy.expiresAt=f.policy.notBefore+15*86400000}]){
  const f=await closedFixture(t);change(f);const loop=await makeClosedLoop(f);
  assert.equal((await tick(loop)).mode,'FAILED_LOCKED');assert.equal(f.writes.length,0);
 }
});
test('owner revocation after pending publication blocks completion and next order',async t=>{
 const f=await closedFixture(t,{ci:'pending'});await tick(await makeClosedLoop(f));
 f.comments.length=0;f.state.ci='success';advance(f);
 assert.equal((await tick(await makeClosedLoop(f))).mode,'FAILED_LOCKED');assert.equal(f.pulls.size,1);
 assert.equal((await readState(f,'receipts.json')).completed.some(r=>r.status==='PASS'),false);
});
test('foreign or stale GitHub HEAD never promotes a fixture PR',async t=>{
 for(const options of [{staleCi:true},{wrongAssociation:true},{moveAfter:'git/trees'}]){
  const f=await closedFixture(t,options);assert.equal((await tick(await makeClosedLoop(f))).mode,options.wrongAssociation?'WAITING':'FAILED_LOCKED');
  assert.equal((await readState(f,'receipts.json')).completed.some(r=>r.status==='PASS'),false);assert.ok(f.pulls.size<=1);
 }
});
test('missing or expired native Publisher capability still blocks despite valid stage approval',async t=>{
 for(const authorize of [async()=>({approved:false}),async request=>({approved:true,request,automaticCiApproved:true,automaticReviewApproved:true,operationId:'expired',expiresAt:0})]){
  const f=await closedFixture(t);assert.equal((await tick(await makeClosedLoop(f,{authorize}))).mode,'FAILED_LOCKED');assert.equal(f.writes.length,0);
 }
});
test('wrong review policy or head and local check failure never complete a task',async t=>{
 for(const mode of ['head','policy','check']){
  const f=await closedFixture(t),options=mode==='check'?{runChecks:async()=>({status:'FAILED'})}:
   {publishedReview:{...f.publishedReview,verify:async p=>{const r=await f.publishedReview.verify(p);r[mode==='head'?'head':'policySha256']='f'.repeat(mode==='head'?40:64);return r;}}};
  assert.equal((await tick(await makeClosedLoop(f,options))).mode,'FAILED_LOCKED');
  assert.equal((await readState(f,'receipts.json')).completed.some(r=>r.status==='PASS'),false);
 }
});
test('review policy is bound in native capability and raw reviewer data is not persisted',async t=>{
 const f=await closedFixture(t);let bound;
 const r=await tick(await makeClosedLoop(f,{authorize:async request=>{bound=request;return {approved:true,request,automaticCiApproved:true,automaticReviewApproved:true,operationId:'fixture-'+request.taskId,expiresAt:999999999};},
  publishedReview:{...f.publishedReview,verify:async p=>({...await f.publishedReview.verify(p),raw:'SECRET_SENTINEL'})}}));
 assert.equal(r.mode,'REPORT_READY');assert.equal(bound.reviewPolicySha256,f.publishedReview.policySha256);
 const report=await fs.readFile(path.join(f.root,'reports',r.report),'utf8');assert.equal(report.includes('SECRET_SENTINEL'),false);
});
test('unknown publication response preserves INTENT and never retries after restart',async t=>{
 const f=await closedFixture(t,{loseResponse:'pulls'});assert.equal((await tick(await makeClosedLoop(f,{timeoutMs:300}))).mode,'FAILED_LOCKED');
 assert.equal(f.pulls.size,1);assert.equal((await readState(f,'publication-fixture-a.json')).phase,'INTENT');
 const count=f.requests.length;advance(f);assert.equal((await tick(await makeClosedLoop(f))).mode,'FAILED_LOCKED');assert.equal(f.requests.length,count);
});
test('two workers share existing Engine lock, only one can prepare/publish',async t=>{
 const f=await closedFixture(t),a=await makeClosedLoop(f),b=await makeClosedLoop(f);
 const results=await Promise.all([tick(a),tick(b)]);
 assert.deepEqual(results.map(r=>r.mode).sort(),['BLOCKED','REPORT_READY']);assert.equal(f.pulls.size,1);
});
test('poll budget survives restart, stops spending and preserves pending PR',async t=>{
 const f=await closedFixture(t,{ci:'pending'});f.closedLoop.maxTicks=1;
 await tick(await makeClosedLoop(f));const count=f.requests.length;advance(f);
 assert.equal((await tick(await makeClosedLoop(f))).reason,'POLL_BUDGET_EXHAUSTED');assert.equal(f.requests.length,count);assert.equal(f.pulls.size,1);
});
test('FAILED legacy bytes are preserved, and corrupt Engine journal retains lock',async t=>{
 for(const mode of ['legacy','journal']){
  const f=await closedFixture(t),file=mode==='legacy'?path.join(f.legacy,'receipts.json'):path.join(f.root,'state/autopilot-ledger.json');
  const content=mode==='legacy'?JSON.stringify({version:1,completed:[{id:'historical-failed',sha:f.sha,status:'FAILED'}]}):'{';await fs.writeFile(file,content);
  assert.equal((await tick(await makeClosedLoop(f))).mode,'FAILED_LOCKED');assert.equal(await fs.readFile(file,'utf8'),content);assert.equal(f.writes.length,0);
 }
});
test('tampered completed report, catalog rebinding and uncertain routing state block subsequent work',async t=>{
 for(const mode of ['report','catalog','routing','conflict']){
  const f=await closedFixture(t),r=await tick(await makeClosedLoop(f));assert.equal(r.mode,'REPORT_READY');advance(f);
  if(mode==='report')await fs.writeFile(path.join(f.root,'reports',r.report),'{}');
  if(mode==='catalog')f.catalog[1].changes[0].content='VALUE = 4\n';
  if(mode==='routing')await fs.mkdir(path.join(f.routing,'routing.lock'));
  if(mode==='conflict')f.snapshot.ledger[f.catalog[0].workOrderId]={publishedPr:9999,head:'f'.repeat(40)};
  assert.equal((await tick(await makeClosedLoop(f))).mode,'FAILED_LOCKED');assert.equal(f.pulls.size,1);
 }
});
test('current G2 physical gate cannot be relabeled as an executable source task',async t=>{
 const f=await closedFixture(t);f.snapshot.contract.stages[0].status='ACCEPTED';f.snapshot.contract.stages[1].status='IN_PROGRESS';
 f.snapshot.issues[512]={number:512,state:'open',labels:['agent-source-ready']};
 assert.equal((await tick(await makeClosedLoop(f))).mode,'FAILED_LOCKED');assert.equal(f.writes.length,0);
});
test('SIGKILL after remote PR write preserves both reservation and Engine brake',async t=>{
 const f=await closedFixture(t,{loseResponse:'pulls'}),payload=path.join(f.base,'child.json');
 await fs.writeFile(payload,JSON.stringify({root:f.root,legacy:f.legacy,origin:f.origin,catalog:f.catalog,snapshot:f.snapshot,
  routing:f.routing,policy:f.policy,comments:f.comments}));
 const helper=new URL('./publisher-fixture.mjs',import.meta.url).href;
 const code=`import fs from 'node:fs/promises';import {makeLoop} from ${JSON.stringify(helper)};const f=JSON.parse(await fs.readFile(process.argv[1]));const l=await makeLoop(f,{enginePilot:true,timeoutMs:30000,publishedReview:{policySha256:'a'.repeat(64),verify:async()=>{throw Error('FIXTURE_REVIEW_NOT_REACHED')}},closedLoop:{stateDir:f.routing,policy:f.policy,readTrustedComments:async()=>f.comments,maxTicks:8}});await l.poll({execute:true});`;
 const child=spawn(process.execPath,['--input-type=module','-e',code,payload],{stdio:['ignore','pipe','pipe']});
 let errors='';child.stderr.on('data',x=>errors+=x);t.after(()=>child.kill('SIGKILL'));
 for(let i=0;i<200&&!f.state.lost&&child.exitCode===null;i++)await new Promise(r=>setTimeout(r,20));
 assert.equal(f.state.lost,true,errors);const done=once(child,'exit');child.kill('SIGKILL');await done;
 const count=f.requests.length;assert.equal((await tick(await makeClosedLoop(f))).mode,'BLOCKED');assert.equal(f.requests.length,count);
 assert.equal((await readState(f,'publication-fixture-a.json')).phase,'INTENT');assert.equal(f.pulls.size,1);
});
test('default original Publisher path remains compatible and still requires its review',async t=>{
 const f=await closedFixture(t,{review:'pending'});const loop=await makeLoop(f,{enginePilot:true});
 assert.equal((await tick(loop)).mode,'WAITING');assert.equal(f.pulls.size,1);
 assert.equal((await readState(f,'receipts.json')).completed.length,0);
});
test('stage revocation during independent review prevents the first remote mutation',async t=>{
 const f=await closedFixture(t),loop=await makeClosedLoop(f,{independentReview:async e=>{
  const result=await f.independentReview(e);f.comments.length=0;return result;}});
 assert.equal((await tick(loop)).mode,'FAILED_LOCKED');assert.equal(f.writes.length,0);
});
test('restart cannot enlarge persisted polling budget',async t=>{
 const f=await closedFixture(t,{ci:'pending'});f.closedLoop.maxTicks=1;
 await tick(await makeClosedLoop(f));const count=f.requests.length;advance(f);f.closedLoop.maxTicks=8;
 assert.equal((await tick(await makeClosedLoop(f))).mode,'FAILED_LOCKED');assert.equal(f.requests.length,count);
});
