import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {initializeState} from './state.mjs';
import {reserveNativeModelRequest as reserve} from './host-runtime.mjs';
const SHA='a'.repeat(40),H64='b'.repeat(64);
const model={name:'generation-model',reviewName:'review-model',maxOutputTokens:1024,
  maxCalls:2,reserveMicrousdPerCall:100,maxPaidMicrousd:200};
const payload={schema:'asi.engine-beget-five-lane-activation.v1',
  repo:'ASI-integration/asi-landing',baseSha:SHA,
  runtimeManifestSha256:'c'.repeat(64),model};
async function withRoot(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'asi-native-model-budget-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  return initializeState(root);
}
const req=(modelName,taskId='source-a',pathDigest=H64)=>({
  model:modelName,taskId,baseSha:SHA,maxOutputTokens:1024,pathDigest});
test('model admission consumes original ledger budget while native admission lock is held',
  async t=>{
  const store=await withRoot(t);let receipt;
  const first=await store.execute('github-publisher',async({ledger,transaction})=>{
    receipt=await reserve({store,ledger,transaction,payload,revalidate:async()=>true,
      request:req(model.name)});
    return null;
  },{async verifyTask(){throw Error('NO_WRITES')}},async()=>{throw Error('NO_WRITES')});
  assert.equal(first.mode,'WAITING');
  assert.equal(receipt.authorized,true);
  const f=store.file('autopilot-ledger.json');
  const after=JSON.parse(await fs.readFile(f,'utf8'));
  assert.equal(after.mode,'IDLE');
  assert.equal(after.modelReservationBudget.spentMicrousd,100);
  assert.equal(after.modelReservationBudget.claims.length,1);
  let denied;
  const replay=await store.execute('github-publisher',async({ledger,transaction})=>{
    try{await reserve({store,ledger,transaction,payload,revalidate:async()=>true,
      request:req(model.name)})}catch(e){denied=e.message;}
    return null;
  },{async verifyTask(){throw Error('NO_WRITES')}},async()=>{throw Error('NO_WRITES')});
  assert.equal(replay.mode,'WAITING');
  assert.match(denied,/EXHAUSTED_OR_REPLAY/);
  const replayState=JSON.parse(await fs.readFile(f,'utf8'));
  assert.equal(replayState.modelReservationBudget.spentMicrousd,100);
});
test('independent model review is reserved in STARTED phase under the SAME ledger',
  async t=>{
    const store=await withRoot(t);
    const task={id:'source-b',sha:SHA,repo:payload.repo,kind:'github-publisher',
      stage:'S4-G2',pr:null,branch:'asi/engine-task/source-b'};
    let receipt,sharedLedger;
    const r=await store.execute('github-publisher',async({ledger})=>{
      sharedLedger=ledger;return task;
    },{async verifyTask(){return {baseSha:SHA};}},async({transaction})=>{
        receipt=await reserve({store,ledger:sharedLedger,transaction,payload,
          revalidate:async()=>true,request:req(model.reviewName,'source-b')});
        return {status:'WAITING'};
      });
    assert.equal(r.mode,'WAITING');
    assert.equal(receipt.authorized,true);
    const disk=JSON.parse(await fs.readFile(store.file('autopilot-ledger.json'),'utf8'));
    assert.equal(disk.modelReservationBudget.spentMicrousd,100);
    assert.equal(disk.modelReservationBudget.claims[0].model,model.reviewName);
  });
test('caller-supplied plain object cannot reserve a model request',async()=>{
  await assert.rejects(reserve({store:{root:'/tmp/not-live'},
    ledger:{mode:'FAILED_LOCKED',reason:'IN_FLIGHT_OR_CRASHED'},
    transaction:Object.freeze({}),payload,revalidate:async()=>true,
    request:req(model.name)}),/STANDING_TRANSACTION_INVALID/);
});

