import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import {initializeState,atomicJson} from './state.mjs';
import {OWNER_LANES} from './owner-lanes.mjs';
import {planNativeOwnerLane} from './owner-lane-native-bridge.mjs';

const NOW=1793340000000, REPO='ASI-integration/asi-landing';
// Part 1 provides the native WeakMap transaction. Until #552 is adopted,
// these physical integration tests are deferred rather than faking a grant.
const nativeAvailable=typeof (await import('./state.mjs')).inspectStandingTransaction==='function';
const nativeTest=nativeAvailable?test:test.skip;
const tasks=OWNER_LANES.map((lane,i)=>({
  id:'test-lane-'+i,sha:(i+1).toString().repeat(40),repo:REPO,
  branch:lane.branch,stage:'S4-G2',kind:'github-publisher',
  changes:[{path:'docs/owner-lane-'+i+'.txt'}]
}));
const journal=()=>({schema:'asi.beget-owner-lane-journal.v1',engineMode:'IDLE',
  lanes:Object.fromEntries(OWNER_LANES.map((lane,i)=>[lane.id,{
    mode:'READY',taskId:tasks[i].id,taskSha:tasks[i].sha,
    lastServedAtMs:0,nextEligibleAtMs:0,retries:0
  }]))});
async function inside({catalog=tasks,history=journal()}={}){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'asi-native-owner-lanes-'));
  try {
    const store=await initializeState(root);
    const onDisk=JSON.parse(await fs.readFile(store.file('autopilot-ledger.json'),'utf8'));
    onDisk.ownerLaneJournal=history;
    await atomicJson(store.file('autopilot-ledger.json'),onDisk);
    let observation;
    const result=await store.execute('github-publisher',
      async ({ledger,transaction})=>{
        observation=await planNativeOwnerLane({store,ledger,transaction,signedCatalog:catalog,nowMs:NOW});
        return null;
      },
      {async verifyTask(){throw Error('NO_PUBLISH_ALLOWED')}},
      async()=>{throw Error('NO_PUBLISH_ALLOWED')});
    assert.equal(result.mode,'WAITING');
    const final=JSON.parse(await fs.readFile(store.file('autopilot-ledger.json'),'utf8'));
    assert.equal(final.mode,'IDLE');
    assert.deepEqual(final.ownerLaneJournal,history,'native bridge does not invent or rewrite persistent lanes');
    return observation;
  } finally {await fs.rm(root,{recursive:true,force:true});}
}
nativeTest('five distinct admitted branches receive fair source candidate under real Engine lock',async()=>{
  const result=await inside();
  assert.equal(result.kind,'CANDIDATE');
  assert.equal(result.candidate.laneId,'engine');
  assert.equal(result.authority,'NONE_SOURCE_ONLY');
  assert.equal(result.lanes.length,5);
  assert.equal(result.candidate.taskId,tasks[0].id);
});
nativeTest('signed two-G2-witness catalog never activates an owner lane',async()=>{
  const result=await inside({catalog:[{...tasks[0],id:'g2-witness',branch:'asi/g2-existing-witness'}]});
  assert.equal(result.kind,'NONE');
  assert.equal(result.candidate,null);
  assert.equal(result.authority,'NONE_SOURCE_ONLY');
  assert(result.lanes.every(x=>x.reason==='NOT_IN_SIGNED_EXECUTION_CATALOG'));
});
nativeTest('blocked lane yields different eligible branch, but uncertain lane freezes all',async()=>{
  const h=journal();h.lanes.engine.mode='BLOCKED';
  const result=await inside({history:h});
  assert.equal(result.kind,'CANDIDATE');
  assert.equal(result.candidate.laneId,'ru-auth');
  h.lanes.engine.mode='FAILED_LOCKED';
  const stopped=await inside({history:h});
  assert.equal(stopped.kind,'STOPPED');
  assert.equal(stopped.candidate,null);
});
nativeTest('missing journal is not initialized and unauthorized fake transaction cannot select',async()=>{
  const missing=await inside({history:null});
  assert.equal(missing.kind,'BLOCKED');
  assert.equal(missing.reason,'OWNER_LANE_JOURNAL_NOT_INITIALIZED');
  const forgery=await planNativeOwnerLane({
    store:{root:'/tmp/fake'},ledger:{mode:'FAILED_LOCKED',reason:'IN_FLIGHT_OR_CRASHED',
      ownerLaneJournal:journal()},transaction:Object.freeze({}),signedCatalog:tasks,nowMs:NOW});
  assert.equal(forgery.kind,'BLOCKED');
  assert.equal(forgery.reason,'NATIVE_ENGINE_TRANSACTION_UNVERIFIED');
});
nativeTest('catalog collisions and branch substitutions remain blocked by source planner',async()=>{
  const collision=structuredClone(tasks);collision[1].changes[0].path=collision[0].changes[0].path;
  assert.equal((await inside({catalog:collision})).kind,'STOPPED');
  const substituted=structuredClone(tasks);substituted[0].branch='asi/unauthorized';
  const result=await inside({catalog:substituted});
  assert.equal(result.kind,'STOPPED');
  assert.equal(result.candidate,null);
});
test('fake credentials or caller-supplied ledger cannot manufacture an admitted lane',async()=>{
  const attempt=await planNativeOwnerLane({store:{root:'/tmp/untrusted'},
    ledger:{mode:'FAILED_LOCKED',reason:'IN_FLIGHT_OR_CRASHED',ownerLaneJournal:journal()},
    transaction:{transactionId:'fake'},signedCatalog:tasks,nowMs:NOW});
  assert.equal(attempt.kind,'BLOCKED');
  assert.equal(attempt.candidate,null);
  assert.equal(attempt.authority,'NONE_SOURCE_ONLY');
});
