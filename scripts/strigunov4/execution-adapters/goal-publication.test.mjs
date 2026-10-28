// Real local preparation; all publication/CI/review/authority ports are fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {generateKeyPairSync,sign} from 'node:crypto';
import {BEGET,verifyBegetActivation} from './host-authority.mjs';
import {closedFixture,makeClosedLoop,tick,readState} from './closed-loop-fixture.mjs';

async function setup(t,options={}) {
  const f=await closedFixture(t,{beget:true,distinctWorkOrders:true,...options});
  const criteria=['identity-proof','race-proof'];
  const contract={schema:'asi.product-route.v1',id:'strigunov4',repository:f.policy.repository,
    execution:'disabled',goal:{result:'Two approved witness source checks',criteria},
    evidence:['tests','review','pr','ci','report'],stages:[{id:'s4-g2',criteria,dependsOn:[]}],
    functions:['prepare-source'],tools:['existing-runner-bridge'],
    paths:f.catalog.flatMap(t=>t.changes.map(c=>c.path)),maxAttemptsPerTask:1,maxPlansPerStage:2};
  const goal={id:'beget-witness-source',product:'strigunov4',repository:f.policy.repository,head:f.sha,
    criteria,priority:10,notBefore:f.policy.notBefore,expiresAt:f.policy.expiresAt,
    budget:{maxTasks:2,maxRequests:200,maxMutations:8,maxComputeMs:10000,maxPaidMicrousd:0}};
  const workOrders=f.catalog.map((task,i)=>({id:task.workOrderId,stage:'s4-g2',operation:'prepare-source',
    tool:'existing-runner-bridge',paths:task.changes.map(c=>c.path),covers:[criteria[i]],
    dependsOn:i?[f.catalog[0].workOrderId]:[],priority:i?90:10,requiredAuthority:['signed-stage-authority'],
    cost:{requests:100,mutations:4,computeMs:5000,paidMicrousd:0}}));
  f.closedLoop.planning={contract,goal,workOrders};
  f.runChecks=async e=>{
    const cwd=path.join(f.root,'scratchpads',e.taskId,'scripts/strigunov4');
    const testModule='test_'+e.taskId.replaceAll('-','_');
    execFileSync('/usr/bin/python3',['-I','-S','-B','-c',
      `import sys,unittest;sys.path.insert(0,'.');s=unittest.defaultTestLoader.loadTestsFromName('${testModule}');r=unittest.TextTestRunner().run(s);assert r.wasSuccessful() and r.testsRun>0`],
    {cwd,timeout:5000,stdio:'pipe'});
    return {...e,status:'PASS'};
  };
  f.independentReview=async e=>{
    const task=f.catalog.find(t=>t.id===e.taskId),filename=path.join(f.root,'scratchpads',e.taskId,task.changes[0].path);
    execFileSync('/usr/bin/python3',['-I','-S','-c',
      'import pathlib,sys;assert pathlib.Path(sys.argv[1]).read_bytes()==sys.argv[2].encode()',
      filename,task.changes[0].content],{timeout:1000,stdio:'pipe'});
    return {...e,status:'PASS',independent:true,evidenceId:'LOCAL_FIXTURE_SEPARATE_PROCESS'};
  };
  return f;
}
const loop=f=>makeClosedLoop(f,{enginePilot:false,runChecks:f.runChecks,
  fencingWitness:async()=>({fixtureFence:true})});
const journal=async f=>JSON.parse(await fs.readFile(path.join(f.routing,'routing.json'),'utf8')).state.products[0];
const advance=f=>{f.now.value+=180000;};

test('structured goal drives existing Publisher through dependent real preparations, pending resume and two durable receipts',async t=>{
  const f=await setup(t,{ci:'pending'});
  assert.equal((await tick(await loop(f))).mode,'WAITING');
  assert.equal(f.pulls.size,1);
  const first=await journal(f),graph=first.goalGraph;
  assert.deepEqual(first.planned.map(p=>p.id),[f.catalog[0].workOrderId]);
  assert.equal(graph.executable,false);assert.equal(graph.authority,null);
  assert.deepEqual(graph.nodes[1].dependsOn,[f.catalog[0].workOrderId]);
  f.state.ci='success';advance(f);
  assert.equal((await tick(await loop(f))).mode,'REPORT_READY');
  assert.deepEqual((await journal(f)).goalGraph,graph);
  advance(f);assert.equal((await tick(await loop(f))).mode,'REPORT_READY');
  const receipts=(await readState(f,'receipts.json')).completed;
  assert.equal(receipts.length,2);assert.ok(receipts.every(r=>r.status==='PASS'));
  assert.equal(new Set(receipts.map(r=>r.id)).size,2);assert.equal(f.pulls.size,2);
  advance(f);assert.equal((await tick(await loop(f))).reason,'NO_ELIGIBLE_APPROVED_TASK');
  const final=await journal(f);
  assert.deepEqual(final.goalGraph,graph);assert.equal(final.planned.length,2);assert.equal(final.terminal.length,2);
  assert.deepEqual(f.writes,['git/trees','git/commits','git/refs','pulls','git/trees','git/commits','git/refs','pulls']);
});

test('optional planning cannot widen native catalog, policy window, paths or accepted routing identity',async t=>{
  const f=await setup(t);
  for(const change of [p=>{p.goal.head='f'.repeat(40)},p=>{p.goal.expiresAt--},
    p=>{p.workOrders[0].paths=[p.workOrders[1].paths[0]]},p=>{p.goal.budget.maxTasks=3}]) {
    const original=structuredClone(f.closedLoop.planning);change(f.closedLoop.planning);
    await assert.rejects(()=>loop(f),/PLANNING_CATALOG_BINDING/);
    f.closedLoop.planning=original;
  }
  assert.equal(f.writes.length,0);
  assert.equal((await tick(await loop(f))).mode,'REPORT_READY');advance(f);
  f.closedLoop.planning.goal.priority++;
  assert.equal((await tick(await loop(f))).mode,'FAILED_LOCKED');
  assert.equal(f.pulls.size,1);
});


test('signed optional graph cannot claim budgets or scope different from native Beget authority',async t=>{
  const f=await setup(t),{privateKey,publicKey}=generateKeyPairSync('ed25519');
  const payload={schema:'asi.engine-beget-activation.v1',...BEGET,repo:f.policy.repository,stage:'S4-G2',
    baseSha:f.sha,notBefore:f.policy.notBefore,expiresAt:f.policy.expiresAt,
    automaticCiApproved:true,automaticReviewApproved:true,
    budget:{paidUsd:0,maxTasks:2,maxMutations:8,maxRequests:200},githubApp:{appId:1,installationId:2},
    closedLoop:{continuous:true,reviewMode:'signed-offline-delta',intervalMs:600000,maxTicks:100,
      policy:f.policy,planning:f.closedLoop.planning},
    ciPolicies:[{name:'validate',workflowId:311380800,event:'pull_request'},
      {name:'release_governance',workflowId:390653294,event:'pull_request_target'}]};
  for(const field of ['catalogSha256','runtimeManifestSha256','fenceSha256','reviewsSha256','releaseSha256'])payload[field]='a'.repeat(64);
  const pem=publicKey.export({type:'spki',format:'pem'});
  const envelope=value=>{const raw=JSON.stringify(value);return {payload:raw,
    signature:sign(null,Buffer.from(raw),privateKey).toString('base64')};};
  assert.equal(verifyBegetActivation(envelope(payload),pem,f.now.value).closedLoop.planning.goal.budget.maxRequests,200);
  for(const mutate of [p=>{p.closedLoop.planning.goal.budget.maxRequests=201},
    p=>{p.budget.maxRequests=201},p=>{p.closedLoop.planning.goal.budget.maxMutations=9},
    p=>{p.closedLoop.planning.goal.budget.maxPaidMicrousd=1},p=>{p.closedLoop.planning.goal.head='f'.repeat(40)},
    p=>{p.closedLoop.planning.goal.expiresAt--},p=>{p.closedLoop.planning.workOrders[0].paths=[p.closedLoop.planning.workOrders[1].paths[0]]}]) {
    const changed=structuredClone(payload);mutate(changed);
    assert.throws(()=>verifyBegetActivation(envelope(changed),pem,f.now.value),/BEGET_PLANNING_BINDING/);
  }
  const forged=envelope(payload);forged.payload+=' ';
  assert.throws(()=>verifyBegetActivation(forged,pem,f.now.value),/OWNER_SIGNATURE_INVALID/);
  assert.equal(f.writes.length,0);
});
