import test from 'node:test';
import assert from 'node:assert/strict';
import {planFiveWorkerWave} from './five-worker-wave.mjs';

const H='a'.repeat(40);
const task=(product,id)=>({status:'READY',selected:{product,repository:'ASI-integration/asi-landing',head:H,
  task:{id,stage:'source',operation:'prepare-source',tool:'existing-runner-bridge',paths:['scripts/example.mjs']},
  executable:false,authority:null}});
const planner=(results)=>{let calls=0;return {get calls(){return calls},
  async plan(){const r=results[calls++];return r??{status:'WAITING',selected:null};}}};

test('five cross-product assignments, one planner/journal, no implicit authority',async()=>{
  const dispatcher=planner([task('asi-cabins','cabin-a'),task('strigunov','auth-a'),
    task('guest-comms','guest-a'),task('dynamic-pricing','price-a'),task('marketing','media-a')]);
  const result=await planFiveWorkerWave({dispatcher,snapshots:{}});
  assert.equal(result.status,'PLANNED');assert.equal(result.slots.length,5);
  assert.equal(dispatcher.calls,5);
  assert.deepEqual(result.slots.map(x=>x.slot),[1,2,3,4,5]);
  assert.deepEqual(result.slots.map(x=>x.product),
    ['asi-cabins','strigunov','guest-comms','dynamic-pricing','marketing']);
  assert(result.slots.every(x=>x.executable===false&&x.authority===null));
  assert.equal(result.publisherConcurrency,1);
  assert(Object.isFrozen(result.slots[0].task));
  assert(Object.isFrozen(result.slots[0].task.paths));
});
test('shortage of independent work does not invent extra jobs',async()=>{
  const dispatcher=planner([task('asi-cabins','cabin-a'),{status:'WAITING',selected:null}]);
  const result=await planFiveWorkerWave({dispatcher,snapshots:{}});
  assert.equal(result.status,'PARTIAL');assert.equal(result.slots.length,1);
  assert.equal(dispatcher.calls,2);
});
test('a FAILED_LOCKED journal stops further reservations, retaining prior slots',async()=>{
  const dispatcher=planner([task('strigunov','job-a'),{status:'FAILED_LOCKED',selected:null}]);
  const result=await planFiveWorkerWave({dispatcher,snapshots:{}});
  assert.equal(result.status,'FAILED_LOCKED');assert.equal(result.slots.length,1);
  assert.equal(dispatcher.calls,2);
});
test('duplicate reservation is never exposed as another worker',async()=>{
  const dispatcher=planner([task('strigunov','job-a'),task('strigunov','job-a')]);
  const result=await planFiveWorkerWave({dispatcher,snapshots:{}});
  assert.equal(result.status,'FAILED_LOCKED');assert.equal(result.slots.length,1);
  assert.equal(result.reason,'DUPLICATE_DURABLE_RESERVATION');
});
test('injected write authority or executable task is not forwarded',async()=>{
  const mutation=task('strigunov','job-a');mutation.selected.executable=true;
  const dispatcher=planner([mutation]);
  const result=await planFiveWorkerWave({dispatcher,snapshots:{}});
  assert.equal(result.status,'FAILED_LOCKED');assert.equal(result.slots.length,0);
});
test('invalid capacity fails without planning or paid call',async()=>{
  const dispatcher=planner([]);
  await assert.rejects(planFiveWorkerWave({dispatcher,snapshots:{},maxWorkers:6}),/FIVE_WORKER/);
  assert.equal(dispatcher.calls,0);
});


test('invalid source path inventory stops wave before exposing preparation slots',async()=>{
  const invalid=[
    [],['src/a.mjs','src/b.mjs','src/c.mjs','src/d.mjs'],
    ['../secret.mjs'],['/etc/private'],['src\\\\escape.mjs'],
    ['src/a.mjs','src/a.mjs'],['.GIT/config'],['src/./file.mjs'],
    [null],['']
  ];
  for(const paths of invalid){
    const broken=task('asi-cabins','cabin-a');
    broken.selected.task.paths=paths;
    const dispatcher=planner([broken,task('strigunov','auth-a')]);
    const result=await planFiveWorkerWave({dispatcher,snapshots:{},maxWorkers:2});
    assert.equal(result.status,'FAILED_LOCKED',JSON.stringify(paths));
    assert.equal(result.reason,'ROUTING_SELECTION_UNVERIFIED',JSON.stringify(paths));
    assert.equal(result.slots.length,0,JSON.stringify(paths));
    assert.equal(dispatcher.calls,1,JSON.stringify(paths));
  }
});
