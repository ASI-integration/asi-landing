import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createGlobalDispatcher,initializeRoutingState} from '../../scripts/global-dispatcher/dispatcher.mjs';
import {planFiveWorkerWave} from './five-worker-wave.mjs';
import {createUniversalProductRoute} from './product-route-adapter.mjs';

const HEAD='a'.repeat(40);
const PRODUCTS=['asi-cabins','strigunov','guest-comms','dynamic-pricing','asi-learning'];
const adapter=product=>createUniversalProductRoute({
  id:product,repository:'ASI-integration/asi-landing',head:HEAD,
  contractHash:'b'.repeat(64),stage:'S4-G2',maxPlansPerStage:1,
  workOrders:[{id:product+'-task',operation:'prepare-source',
    tool:'existing-runner-bridge',priority:10,
    paths:['src/asi-universal/five-worker-wave.mjs']}]
});
const snapshots=()=>Object.fromEntries(PRODUCTS.map(x=>[x,{
  repository:'ASI-integration/asi-landing',head:HEAD,status:'READY'
}]));
test('existing durable dispatcher reserves five product tasks once, even after restart',
  {skip:process.platform!=='linux'},async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'asi-five-worker-routing-'));
  await fs.chmod(dir,0o700);
  try{
    await initializeRoutingState(dir);
    const dispatcher=createGlobalDispatcher({
      stateDir:dir,adapters:PRODUCTS.map(adapter)});
    const first=await planFiveWorkerWave({dispatcher,snapshots:snapshots()});
    assert.equal(first.status,'PLANNED');assert.equal(first.slots.length,5);
    assert.equal(new Set(first.slots.map(s=>s.product)).size,5);
    assert(first.slots.every(s=>s.executable===false&&s.authority===null));
    assert.equal(first.publisherConcurrency,1);
    const stored=JSON.parse(await fs.readFile(path.join(dir,'routing.json'),'utf8'));
    assert.equal(stored.state.tick,5);
    assert.equal(stored.state.products.length,5);
    assert(stored.state.products.every(p=>p.planned.length===1));
    // New dispatcher in same process simulates a restart: exact same journal.
    const afterRestart=createGlobalDispatcher({
      stateDir:dir,adapters:PRODUCTS.map(adapter)});
    const second=await planFiveWorkerWave({dispatcher:afterRestart,snapshots:snapshots()});
    assert.equal(second.slots.length,0);
    const storedAgain=JSON.parse(await fs.readFile(path.join(dir,'routing.json'),'utf8'));
    assert.equal(storedAgain.state.tick,5);
    assert(storedAgain.state.products.every(p=>p.planned.length===1));
  }finally{await fs.rm(dir,{recursive:true,force:true})}
});
test('existing lock halts all worker planning without stale-lock theft',
  {skip:process.platform!=='linux'},async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'asi-five-worker-lock-'));
  await fs.chmod(dir,0o700);
  try{
    await initializeRoutingState(dir);
    await fs.writeFile(path.join(dir,'routing.lock'),'owner-held-lock',{flag:'wx',mode:0o600});
    const dispatcher=createGlobalDispatcher({
      stateDir:dir,adapters:PRODUCTS.map(adapter)});
    const r=await planFiveWorkerWave({dispatcher,snapshots:snapshots()});
    assert.equal(r.status,'FAILED_LOCKED');
    assert.equal(r.slots.length,0);
    assert.equal((await fs.readFile(path.join(dir,'routing.lock'),'utf8')),'owner-held-lock');
  }finally{await fs.rm(dir,{recursive:true,force:true})}
});
