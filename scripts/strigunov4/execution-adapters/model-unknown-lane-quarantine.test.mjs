import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {OWNER_LANES} from './owner-lanes.mjs';
import {proposeUncertainModelLaneQuarantine as quarantine} from './owner-lane-native-bridge.mjs';
import {planCooperativeOwnerLane} from './owner-lane-planner.mjs';
import {initializeState,atomicJson} from './state.mjs';
const REPO='ASI-integration/asi-landing', SHA='a'.repeat(40), HEX='b'.repeat(64);
const model='gpt-4.1-mini';
const catalog=()=>OWNER_LANES.map((lane,i)=>({
  id:'signed-task-'+i,laneId:lane.id,repo:REPO,branch:lane.branch,
  baseSha:SHA,stage:'S4-G2',kind:'source-proposal',
  files:[{path:'tests/signed-test-'+i+'.mjs',beforeSha256:HEX}]
}));
function state(){
 const tasks=catalog();
 return {mode:'FAILED_LOCKED',reason:'IN_FLIGHT_OR_CRASHED',
   ownerLaneJournal:{schema:'asi.beget-owner-lane-journal.v1',engineMode:'IDLE',
     lanes:Object.fromEntries(tasks.map(t=>[t.laneId,{mode:'READY',
       taskId:t.id,taskSha:t.baseSha,lastServedAtMs:0,nextEligibleAtMs:0,retries:0}]))},
   modelReservationBudget:{version:1,policySha256:HEX,spentMicrousd:100000,
     claims:[{taskId:tasks[0].id,model,baseSha:SHA,pathDigest:HEX,
       operationId:'model-12345678-1234-1234-1234-123456789012',microusd:100000}]}
 };
}
const args=l=>({ledger:l,signedCatalog:catalog(),
  failedTaskId:catalog()[0].id,failedLaneId:'engine',model,baseSha:SHA});
test('authentic unknown prior model reservation quarantines only its lane and retains claim',()=>{
 const before=state(),copy=structuredClone(before);
 const r=quarantine(args(before));
 assert.equal(r.status,'MODEL_UNKNOWN_LANE_QUARANTINE_SOURCE_ONLY');
 assert.equal(r.authorized,false);
 assert.equal(r.nextJournal.lanes.engine.mode,'BLOCKED');
 assert.equal(r.nextJournal.lanes['ru-auth'].mode,'READY');
 assert.deepEqual(before,copy,'no source-only ledger mutation');
 assert.equal(before.modelReservationBudget.claims.length,1);
});
test('no reservation, foreign task or wrong model cannot quarantine any lane',()=>{
 for(const update of [
  l=>{delete l.modelReservationBudget;},
  l=>{l.modelReservationBudget.claims=[];},
  l=>{l.modelReservationBudget.claims[0].model='foreign';},
  l=>{l.modelReservationBudget.claims[0].baseSha='c'.repeat(40);},
  l=>{l.mode='IDLE';},
  l=>{l.ownerLaneJournal.lanes.engine.mode='UNKNOWN';},
  l=>{l.nativeFiveLaneTask={status:'PENDING'};}
 ]){
  const l=state();update(l);const r=quarantine(args(l));
  assert.equal(r.status,'DENIED');assert.equal(r.authorized,false);
 }
 const l=state();assert.equal(quarantine({...args(l),failedLaneId:'ru-auth'}).status,'DENIED');
});
test('same native state.execute fsync preserves model claim and lets next independent lane be considered',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'asi-unknown-model-'));
 try{
  const store=await initializeState(root);
  const old=JSON.parse(await fs.readFile(store.file('autopilot-ledger.json'),'utf8'));
  Object.assign(old,{ownerLaneJournal:state().ownerLaneJournal,
    modelReservationBudget:state().modelReservationBudget});
  await atomicJson(store.file('autopilot-ledger.json'),old);
  const observed=await store.execute('github-publisher',async({ledger,transaction})=>{
    // The original private transaction armed the FAILED_LOCKED crash brake.
    const q=quarantine(args(ledger));
    assert.equal(q.status,'MODEL_UNKNOWN_LANE_QUARANTINE_SOURCE_ONLY');
    await atomicJson(store.file('autopilot-ledger.json'),
      {...ledger,ownerLaneJournal:q.nextJournal});
    ledger.ownerLaneJournal=q.nextJournal;
    return null;
  },{async verifyTask(){throw Error('NO_WRITE')}},async()=>{throw Error('NO_WRITE')});
  assert.equal(observed.mode,'WAITING');
  const disk=JSON.parse(await fs.readFile(store.file('autopilot-ledger.json'),'utf8'));
  assert.equal(disk.mode,'IDLE');
  assert.equal(disk.ownerLaneJournal.lanes.engine.mode,'BLOCKED');
  assert.deepEqual(disk.modelReservationBudget,old.modelReservationBudget,'unknown paid claim is NOT refunded');
  const admitted=catalog().map(t=>({id:t.id,sha:t.baseSha,repo:t.repo,
    branch:t.branch,stage:t.stage,kind:'github-publisher',
    changes:t.files.map(f=>({path:f.path,beforeSha256:f.beforeSha256}))}));
  const planner=planCooperativeOwnerLane({laneDefinitions:OWNER_LANES.map(
      l=>({id:l.id,branch:l.branch,repository:l.repository})),
    admittedCatalog:admitted,journal:disk.ownerLaneJournal,nowMs:Date.now()});
  assert.equal(planner.kind,'CANDIDATE');
  assert.equal(planner.candidate.laneId,'ru-auth');
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('completed earlier lane remains DONE while another exact signed lane is quarantined',()=>{
  const l=state(),tasks=catalog();
  l.ownerLaneJournal.lanes.engine.mode='DONE';
  l.nativeFiveLaneTask={status:'DONE',task:{id:tasks[0].id}};
  l.modelReservationBudget.claims.push({
    taskId:tasks[1].id,model,baseSha:SHA,pathDigest:'c'.repeat(64),
    operationId:'model-22222222-2222-2222-2222-222222222222',microusd:100000});
  const r=quarantine({ledger:l,signedCatalog:tasks,
    failedTaskId:tasks[1].id,failedLaneId:'ru-auth',model,baseSha:SHA});
  assert.equal(r.status,'MODEL_UNKNOWN_LANE_QUARANTINE_SOURCE_ONLY');
  assert.equal(r.nextJournal.lanes.engine.mode,'DONE');
  assert.equal(r.nextJournal.lanes['ru-auth'].mode,'BLOCKED');
  assert.equal(r.nextJournal.lanes['p0-integration'].mode,'READY');
  assert.equal(l.modelReservationBudget.claims.length,2);
});
