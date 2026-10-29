import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture,makeLoop,target} from './publisher-fixture.mjs';
import {createPublisherTransport} from './publisher-transport.mjs';
import {createGitHubReader} from './github-readonly.mjs';
import {inspectPublisherLifecycleEvidence} from './github-publisher.mjs';

async function setup(t,options={},observer=()=>true,loopOptions={}){
 const native=globalThis.fetch;t.after(()=>{globalThis.fetch=native;});
 const f=await fixture(t,options);let transaction;
 const loop=await makeLoop(f,{...loopOptions,transactionPorts:async context=>{
  transaction=context.transaction;
  return {remote:createPublisherTransport({token:'INERT_FIXTURE_ONLY'}),
   reader:createGitHubReader({token:'INERT_FIXTURE_ONLY'}),fetchSnapshot:async()=>structuredClone(f.snapshot),
   observeLifecycle:(event,context)=>observer(event,transaction,f,context)};
 }});return {f,loop,get transaction(){return transaction;}};
}
test('native local delta evidence precedes first write; exact head evidence follows completed provider checks',async t=>{
 const events=[];
 const x=await setup(t,{},(event,transaction,f)=>{
  assert.equal(inspectPublisherLifecycleEvidence(event,transaction),event);
  assert.throws(()=>inspectPublisherLifecycleEvidence({...event},transaction),/UNTRUSTED/);
  assert(Object.isFrozen(event));assert(Object.isFrozen(event.paths));assert.equal(event.authorized,false);
  assert.equal(event.taskSha,f.sha);assert.equal(event.taskId,'fixture-a');
  if(event.phase==='LOCAL_DELTA_VERIFIED'){assert.equal(f.writes.length,0);assert.equal(event.headSha,undefined);assert.equal(event.ci,undefined);}
  else{assert.equal(f.writes.length,4);assert.equal(event.pr,600);assert.equal(event.headSha,f.pulls.get(600).head.sha);}
  events.push(event);return true;
 });
 assert.equal((await x.loop.poll({execute:true})).mode,'REPORT_READY');
 assert.deepEqual(events.map(e=>e.phase),['LOCAL_DELTA_VERIFIED','EXACT_HEAD_VERIFIED']);
 assert.throws(()=>inspectPublisherLifecycleEvidence(events[0],x.transaction),/STANDING_TRANSACTION/);
});
test('rejected, missing or throwing local observer cannot reach first write',async t=>{
 for(const observer of [()=>false,()=>undefined,()=>({authorized:true}),()=>{throw Error('fixture');}]){
  const x=await setup(t,{},observer);assert.equal((await x.loop.poll({execute:true})).mode,'FAILED_LOCKED');assert.equal(x.f.writes.length,0);
 }
});
test('pending exact-head CI emits no final verification evidence',async t=>{
 const seen=[];const x=await setup(t,{ci:'pending'},e=>{seen.push(e.phase);return true;});
 assert.equal((await x.loop.poll({execute:true})).mode,'WAITING');
 assert.deepEqual(seen,['LOCAL_DELTA_VERIFIED']);
});
test('failed local checker emits no prepared evidence or Git write',async t=>{
 const seen=[];const x=await setup(t,{},e=>{seen.push(e);return true;},{runChecks:async()=>({status:'FAIL'})});
 assert.equal((await x.loop.poll({execute:true})).mode,'FAILED_LOCKED');assert.deepEqual(seen,[]);assert.equal(x.f.writes.length,0);
});
test('observer cannot attest mutated local bytes or stale final CI',async t=>{
 for(const mode of ['local','ci']){
  const x=await setup(t,{},async(e,transaction,f)=>{
   if(mode==='local'&&e.phase==='LOCAL_DELTA_VERIFIED')await fs.writeFile(path.join(f.root,'scratchpads','fixture-a',target),'VALUE = 999\n');
   if(mode==='ci'&&e.phase==='EXACT_HEAD_VERIFIED')f.state.ci='failure';return true;
  });
  assert.equal((await x.loop.poll({execute:true})).mode,'FAILED_LOCKED');
  if(mode==='local')assert.equal(x.f.writes.length,0);
  const receipts=JSON.parse(await fs.readFile(path.join(x.f.root,'state','receipts.json'),'utf8'));
  assert.equal(receipts.completed.some(r=>r.status==='PASS'),false);
 }
});
