import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {inspectProtectedGatePrerequisites as inspect,readAuthenticatedGatePrerequisites as read,
  inspectAuthenticatedProviderSnapshot as finalProvider,checkPr} from '../check-demo-release.mjs';

const repo='ASI-integration/asi-landing',baseSha='a'.repeat(40),headSha='b'.repeat(40);
const now=Date.parse('2026-10-29T19:00:00Z'),recent=new Date(now-1000).toISOString();
const object=bytes=>createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
function fixture(){
  const expected={repository:repo,number:552,baseSha,headSha,independentReviewerId:1234};
  const binding={number:552,base:{sha:baseSha},head:{sha:headSha}};
  const run=(id,workflow_id,event,sha,path)=>({id,workflow_id,event,head_sha:sha,path,
    run_attempt:1,status:'in_progress',conclusion:null,repository:{full_name:repo},
    pull_requests:[binding],updated_at:recent});
  const source=run(41,311380800,'pull_request',headSha,'.github/workflows/pr-validation.yml');
  const evaluator=run(42,390653294,'pull_request_target',baseSha,'.github/workflows/asi-release-governance.yml');
  // Inert proposed definition bytes; no YAML is executed. Production pins must
  // originate in independently reviewed protected configuration, not this fixture.
  const contents=[Buffer.from('jobs:\n  source_validation: {}\n  channel-manager-recovery-postgres: {}\n  validate: {}\n'),
    Buffer.from('jobs:\n  release_governance: {}\n')];
  const workflowDefinitions=contents.map((bytes,i)=>({path:i?evaluator.path:source.path,baseSha,sha:object(bytes),
    headSha,headBlobSha:object(bytes)}));
  const context={schema:'asi.protected-gate-split.proposal.v1',repository:repo,number:552,baseSha,headSha,
    evaluatorRunId:42,evaluatorRunAttempt:1,sourceWorkflowBlobSha:workflowDefinitions[0].sha,
    evaluatorWorkflowBlobSha:workflowDefinitions[1].sha};
  const jobs=['source_validation','channel-manager-recovery-postgres','validate'].map((name,i)=>({
    id:101+i,name,run_id:41,head_sha:headSha,status:i===2?'in_progress':'completed',
    conclusion:i===2?null:'success',completed_at:i===2?null:recent}));
  const snapshot={expected,now,pr:{number:552,state:'open',user:{id:207600140},
    base:{ref:'main',sha:baseSha,repo:{full_name:repo}},head:{sha:headSha,repo:{full_name:repo}}},
    runs:[source,evaluator],sourceJobs:{runId:41,runAttempt:1,totalCount:3,jobs},
    evaluatorRun:structuredClone(evaluator),workflowDefinitions,
    reviews:[{id:9,user:{id:1234},state:'APPROVED',commit_id:headSha,submitted_at:recent}]};
  return {snapshot,context,contents};
}
const result=f=>inspect(f.snapshot,f.context);
const blocked=f=>assert.equal(result(f).status,'BLOCKED');
function network(change=()=>{}){
  const f=fixture(),calls=[],metered=[];
  const fetchImpl=async(url,options)=>{
    calls.push({url,method:options.method,redirect:options.redirect});
    const u=new URL(url),p=u.pathname;let value;
    if(p.includes('/contents/')){
      const i=p.endsWith('pr-validation.yml')?0:1,d=f.snapshot.workflowDefinitions[i];
      value={type:'file',path:d.path,sha:d.sha,encoding:'base64',content:f.contents[i].toString('base64')};
    }else if(p.includes('/workflows/')){
      const id=Number(p.split('/').at(-2));
      const runs=f.snapshot.runs.filter(r=>r.workflow_id===id);
      value={total_count:runs.length,workflow_runs:runs};
    }else if(p.endsWith('/jobs'))value={total_count:f.snapshot.sourceJobs.totalCount,jobs:f.snapshot.sourceJobs.jobs};
    else if(p.endsWith('/runs/42'))value=f.snapshot.evaluatorRun;
    else if(p.endsWith('/reviews'))value=f.snapshot.reviews;
    else value=f.snapshot.pr;
    change({url:u,value,f,calls});
    return new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
  };
  return {...f,calls,metered,input:{token:'inert-test-token',expected:f.snapshot.expected,
    trustedGateContext:f.context,clock:()=>now,fetchImpl,beforeRequest:async d=>{metered.push(d);return true;}}};
}
test('pre-gate accepts independent source jobs while its evaluator is in progress, never final evidence',()=>{
  const f=fixture();assert.deepEqual(result(f),{status:'GATE_PREREQUISITES_VERIFIED',authorized:false});
  assert.equal(finalProvider(f.snapshot).status,'BLOCKED');
  assert.throws(()=>checkPr({contract:{transition:{legacyPrMax:509}},changed:['scripts/agent-os/check-demo-release.mjs'],
    prNumber:552,headSha,baseHasContract:true,ownerApproval:false}),/GOVERNANCE_CHANGE_NEEDS_VERIFIED_OWNER_ATTESTATION/);
});
test('admission failure is not source failure but cannot become final green',()=>{
  const f=fixture();Object.assign(f.snapshot.runs[0],{status:'completed',conclusion:'failure'});
  Object.assign(f.snapshot.sourceJobs.jobs[2],{status:'completed',conclusion:'failure'});
  assert.equal(result(f).status,'GATE_PREREQUISITES_VERIFIED');
  assert.equal(finalProvider(f.snapshot).status,'BLOCKED');
});
test('missing duplicate renamed and extra jobs including current unsplit workflow block',()=>{
  for(const mutate of [s=>s.sourceJobs.jobs.pop(),s=>s.sourceJobs.jobs[1].name='source_validation',
    s=>s.sourceJobs.jobs[1].id=101,s=>s.sourceJobs.jobs[0].name='renamed',
    s=>s.sourceJobs.jobs.push({...s.sourceJobs.jobs[0],id:999,name:'unknown'}),s=>s.sourceJobs.totalCount=2]){
    const f=fixture();mutate(f.snapshot);blocked(f);
  }
});
test('failed pending cancelled stale source jobs and inconsistent whole-run status block',()=>{
  for(const delta of [{conclusion:'failure'},{status:'in_progress'},{conclusion:'cancelled'},
    {completed_at:new Date(now-3600001).toISOString()}]){
    const f=fixture();Object.assign(f.snapshot.sourceJobs.jobs[0],delta);blocked(f);
  }
  const f=fixture();Object.assign(f.snapshot.runs[0],{status:'completed',conclusion:'failure'});blocked(f);
});
test('newer run or rerun cannot reuse prior jobs, cancelled admission blocks',()=>{
  for(const delta of [{id:43},{run_attempt:2}]){
    const f=fixture();f.snapshot.runs.push({...f.snapshot.runs[0],...delta});blocked(f);
  }
  const f=fixture();Object.assign(f.snapshot.sourceJobs.jobs[2],{status:'completed',conclusion:'cancelled'});blocked(f);
});
test('wrong evaluator run attempt workflow path HEAD PR or completed status block',()=>{
  for(const delta of [{id:43},{run_attempt:2},{workflow_id:123},{event:'pull_request'},
    {path:'other.yml'},{head_sha:headSha},{pull_requests:[]},{status:'completed',conclusion:'success'}]){
    const f=fixture();Object.assign(f.snapshot.evaluatorRun,delta);blocked(f);
  }
  const f=fixture();f.snapshot.runs.push({...f.snapshot.runs[1],id:99});blocked(f);
});
test('stale or dismissed review and author identity block',()=>{
  for(const delta of [{submitted_at:new Date(now-3600001).toISOString()},{state:'DISMISSED'},
    {commit_id:baseSha},{user:{id:207600140}}]){
    const f=fixture();Object.assign(f.snapshot.reviews[0],delta);blocked(f);
  }
});
test('context excludes caller bypass flags and rejects accessors without executing them',()=>{
  const f=fixture();f.context.excludeRunIds=[42];blocked(f);
  let called=0;const g=fixture();Object.defineProperty(g.context,'schema',{get(){called++;return 'bad';}});
  blocked(g);assert.equal(called,0);
});
test('reader fetches fixed exact-attempt jobs protected-base blobs and current evaluator with metering',async()=>{
  const f=network(),r=await read(f.input);
  assert.equal(r.status,'GATE_PREREQUISITES_VERIFIED');assert.equal(r.authorized,false);
  assert.equal(f.calls.length,13);assert.equal(f.metered.length,13);assert.equal(r.receipt.requests,13);
  assert(f.calls.every(c=>c.method==='GET'&&c.redirect==='error'));
  assert(f.calls.some(c=>c.url.includes('/actions/runs/41/attempts/1/jobs?')));
  assert.equal(f.calls.filter(c=>c.url.includes('/contents/')&&c.url.endsWith('?ref='+baseSha)).length,2);
  assert.equal(f.calls.filter(c=>c.url.includes('/contents/')&&c.url.endsWith('?ref='+headSha)).length,2);
});
test('reader rejects missing altered or wrong protected definition bytes',async()=>{
  for(const mutation of [v=>v.sha='c'.repeat(40),v=>v.content=Buffer.from('tampered').toString('base64'),v=>delete v.content]){
    const f=network(({url,value})=>{if(url.pathname.includes('/contents/'))mutation(value);});
    assert.equal((await read(f.input)).reason,'PROVIDER_READER_GATE_DEFINITION');
  }
});
test('reader rejects truncated job inventory and current PR drift',async()=>{
  const f=network(({url,value})=>{if(url.pathname.endsWith('/jobs'))value.total_count=4;});
  assert.equal((await read(f.input)).reason,'PROVIDER_READER_INCOMPLETE');
  const g=network(({url,value,calls})=>{if(url.pathname.endsWith('/pulls/552')&&calls.length>1)value.head.sha='d'.repeat(40);});
  assert.equal((await read(g.input)).reason,'PROVIDER_PR_IDENTITY');
});
test('reader guard rejects nonboolean permission and missing trusted profile without requests',async()=>{
  const f=network();f.input.beforeRequest=async()=>({status:'PASS'});
  assert.equal((await read(f.input)).reason,'PROVIDER_READER_GUARD_DENIED');assert.equal(f.calls.length,0);
  const g=network();delete g.input.trustedGateContext;
  assert.equal((await read(g.input)).reason,'GATE_CONTEXT');assert.equal(g.calls.length,0);
});
test('pre-gate reader requires explicit metering before any request',async()=>{
  const f=network();delete f.input.beforeRequest;
  assert.equal((await read(f.input)).status,'BLOCKED');assert.equal(f.calls.length,0);
});
test('source and evaluator advancement during review collection invalidates initial snapshots',async()=>{
  for(const mutate of [
    s=>{s.runs[0].run_attempt=2;s.sourceJobs.jobs[0].status='in_progress';},
    s=>s.runs.push({...s.runs[0],id:99}),
    s=>{s.runs[0].status='completed';s.runs[0].conclusion='failure';},
    s=>{s.runs[1].status='completed';s.runs[1].conclusion='failure';},
    s=>s.runs.push({...s.runs[1],id:99}),
  ]){
    const f=network(({url,f})=>{if(url.pathname.endsWith('/reviews'))mutate(f.snapshot);});
    assert.equal((await read(f.input)).reason,'PROVIDER_READER_GATE_RACE');
  }
});
test('reader rejects PR HEAD workflow tampering despite an intact protected base',async()=>{
  const f=network(({url,value})=>{
    if(url.pathname.includes('/contents/')&&url.searchParams.get('ref')===headSha)
      value.content=Buffer.from('untrusted head workflow').toString('base64');
  });
  assert.equal((await read(f.input)).reason,'PROVIDER_READER_GATE_DEFINITION');
  const g=fixture();delete g.snapshot.workflowDefinitions[0].headBlobSha;blocked(g);
});
test('complete current pending source inventory waits only after all other trust checks',()=>{
 const waiting=f=>Object.assign(f.snapshot.sourceJobs.jobs[0],{status:'queued',conclusion:null,completed_at:null});
 const f=fixture();waiting(f);assert.equal(result(f).status,'GATE_PREREQUISITES_PENDING');
 assert.equal(finalProvider(f.snapshot).status,'BLOCKED');
 for(const mutate of [s=>s.reviews=[],s=>s.reviews[0].state='DISMISSED',
  s=>s.sourceJobs.jobs[1].conclusion='failure',s=>s.evaluatorRun.run_attempt=2,
  s=>s.runs[0].updated_at=new Date(now-3600001).toISOString(),s=>s.sourceJobs.jobs.pop()]){
  const x=fixture();waiting(x);mutate(x.snapshot);blocked(x);
 }
});
