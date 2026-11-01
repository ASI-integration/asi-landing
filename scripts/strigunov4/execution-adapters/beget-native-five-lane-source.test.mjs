import test from 'node:test';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import {initializeState,atomicJson} from './state.mjs';
import assert from 'node:assert/strict';
import {OWNER_LANES} from './owner-lanes.mjs';
import {prepareNativeFiveLaneSource as prepare} from './beget-native-five-lane-source.mjs';

const SHA='a'.repeat(40),H='b'.repeat(64);
function fixture(){
  const tasks=OWNER_LANES.map((lane,i)=>({
    id:'native-source-'+i,laneId:lane.id,repo:lane.repository,
    branch:lane.branch,baseSha:SHA,stage:'S4-G2',kind:'source-proposal',
    objective:'Prepare a narrowly scoped source improvement for review',
    files:[{path:[
      'scripts/strigunov4/ASI-STRIGUNOV4-GITHUB-SNAPSHOT-20261020.test.mjs',
      'tests/telegram-live-identity-acceptance.ru.json',
      'scripts/strigunov4/ASI-STRIGUNOV4-MULTIJOB-20261020.test.mjs',
      'scripts/strigunov4/ASI-STRIGUNOV4-RUNNER-BRIDGE-20261020.test.mjs',
      'scripts/strigunov4/ASI-STRIGUNOV4-ORCHESTRATOR-CANDIDATE-20261020.test.mjs'
    ][i],beforeSha256:H}]
  }));
  const lanes=Object.fromEntries(tasks.map(t=>[t.laneId,{
    mode:'READY',taskId:t.id,taskSha:SHA,
    lastServedAtMs:0,nextEligibleAtMs:0,retries:0
  }]));
  const journal={schema:'asi.beget-owner-lane-journal.v1',
    engineMode:'IDLE',lanes};
  const criteria=['Reviewed and tested source draft'];
  const graph={planHash:H,goal:{criteria},nodes:[{
    id:tasks[0].id,covers:criteria}]};
  const assessment={
    schema:'asi.task-value-assessment.v1',
    taskId:tasks[0].id,goalPlanHash:H,decision:'ACCEPTED',
    outcome:'Create source changes for native review',
    expectedBenefit:'Enable independently reviewed source work',
    acceptanceEvidence:criteria,reason:'This source work is necessary',
    alternative:'Do not publish without approval',possibleDuplicates:[]
  };
  const produce=async task=>({status:'PROPOSED',changes:task.paths.map(path=>({
    path,beforeSha256:H,content:'export const native = 1;\n'
  }))});
  return {signedCatalog:tasks,journal,nowMs:12345,goalGraph:graph,
    assessment,produce,revalidate:async()=>true};
}
async function inside(input){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'asi-p0-native-source-'));
  try{
    const store=await initializeState(root);
    const state=JSON.parse(await fs.readFile(store.file('autopilot-ledger.json'),'utf8'));
    state.ownerLaneJournal=input.journal;
    await atomicJson(store.file('autopilot-ledger.json'),state);
    let response;
    const outcome=await store.execute('github-publisher',async ({ledger,transaction})=>{
      response=await prepare({...input,store,ledger,transaction});
      return null;
    },{async verifyTask(){throw Error('NO_REMOTE_EFFECT')}},async()=>{throw Error('NO_REMOTE_EFFECT')});
    assert.equal(outcome.mode,'WAITING');
    return response;
  }finally{await fs.rm(root,{recursive:true,force:true});}
}
test('five fixed signed task candidates yield one non-authorizing publisher handoff',async()=>{
  const x=await inside(fixture());
  assert.equal(x.status,'SOURCE_PREPARER_CANDIDATE',x.reason);
  assert.equal(x.authorized,false);
  assert.equal(x.laneId,'engine');
  assert.equal(x.task.kind,'github-publisher');
  assert.equal(x.task.branch,'asi/engine-task/native-source-0');
  assert.equal(x.task.changes[0].path,'scripts/strigunov4/ASI-STRIGUNOV4-GITHUB-SNAPSHOT-20261020.test.mjs');
});
test('unsigned/missing source catalog never calls a producer',async()=>{
  const x=fixture();let called=false;
  x.signedCatalog=x.signedCatalog.slice(0,4);
  x.produce=async()=>{called=true;throw Error('should not reach model');};
  assert.equal((await inside(x)).status,'BLOCKED');
  assert.equal(called,false);
});
test('no signed revalidation prevents source production',async()=>{
  const x=fixture();let called=false;
  x.revalidate=async()=>false;
  x.produce=async()=>{called=true;throw Error('should not reach model');};
  assert.equal((await inside(x)).status,'BLOCKED');
  assert.equal(called,false);
});
test('model changes cannot promote a modified catalog',async()=>{
  const x=fixture();let requested=false;
  x.produce=async task=>{
    requested=true;
    x.signedCatalog[0].objective='Changed by unsignable actor';
    return {status:'PROPOSED',changes:task.paths.map(path=>({
      path,beforeSha256:H,content:'export const native = 1;\n'
    }))};
  };
  assert.equal((await inside(x)).status,'BLOCKED');
  assert.equal(requested,true);
});
test('duplicated lane, foreign branch, unknown journal and duplicate intent block',async()=>{
  const tests=[
    x=>{x.signedCatalog[1].branch=x.signedCatalog[0].branch;},
    x=>{x.signedCatalog[1].branch='feat/foreign';},
    x=>{x.journal.engineMode='UNKNOWN';},
    x=>{x.assessment.possibleDuplicates=['duplicate-draft'];}
  ];
  for(const mutate of tests){
    const x=fixture();mutate(x);
    assert.equal((await inside(x)).status,'BLOCKED');
  }
});

test('a fabricated transaction cannot produce a candidate or call the model',async()=>{
  const x=fixture();let invoked=false;
  x.produce=async()=>{invoked=true;throw Error('MODEL_MUST_NOT_RUN');};
  const r=await prepare({...x,store:{root:'/tmp/untrusted'},
    ledger:{mode:'FAILED_LOCKED',reason:'IN_FLIGHT_OR_CRASHED',
      ownerLaneJournal:x.journal},transaction:Object.freeze({})});
  assert.equal(r.status,'BLOCKED');
  assert.equal(invoked,false);
});

test('unsupported TypeScript source is denied before a paid producer call',async()=>{
  const x=fixture();let called=false;
  x.signedCatalog[0].files[0].path='src/unknown.ts';
  x.produce=async()=>{called=true;throw Error('PAID_REQUEST_MUST_NOT_START')};
  assert.equal((await inside(x)).status,'BLOCKED');
  assert.equal(called,false);
});
test('missing objective in catalog denies the model before any network use',async()=>{
  const x=fixture();let called=false;
  delete x.signedCatalog[0].objective;
  x.produce=async()=>{called=true;throw Error('PAID_REQUEST_MUST_NOT_START')};
  assert.equal((await inside(x)).status,'BLOCKED');
  assert.equal(called,false);
});

test('source producer unknown result reports exact signed task only, never retries or authorizes',async()=>{
  const x=fixture();
  x.produce=async()=>({status:'BLOCKED',reason:'PROVIDER_REQUEST_UNKNOWN_NO_AUTOMATIC_RETRY',changes:[]});
  const r=await inside(x);
  assert.equal(r.status,'BLOCKED');
  assert.equal(r.failedTaskId,x.signedCatalog[0].id);
  assert.equal(r.failedLaneId,'engine');
  assert.equal(r.authorized,false);
});
test('missing signed revalidation never attributes uncertainty to any lane',async()=>{
  const x=fixture();
  x.revalidate=async()=>false;
  const r=await inside(x);
  assert.equal(r.status,'BLOCKED');
  assert.equal(r.failedTaskId,undefined);
  assert.equal(r.failedLaneId,undefined);
});
