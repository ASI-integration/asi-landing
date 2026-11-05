import test from 'node:test';
import assert from 'node:assert/strict';
import {createUniversalProductRoute} from './product-route-adapter.mjs';
const SHA='a'.repeat(40),H64='b'.repeat(64);
const config=(id='asi-cabins')=>({id,repository:'ASI-integration/asi-landing',head:SHA,
  contractHash:H64,stage:'S4-G2',workOrders:[{id:id+'-job',operation:'prepare-source',
    tool:'existing-runner-bridge',priority:7,paths:['src/cabins/fix.mjs']}]});
const snapshot={repository:'ASI-integration/asi-landing',head:SHA,status:'READY'};
test('same adapter covers independent products, returning immutable source-only work',()=>{
  for(const id of ['asi-cabins','guest-comms','dynamic-pricing','marketing','strigunov']){
    const a=createUniversalProductRoute(config(id));
    const r=a.evaluate(snapshot);
    assert.equal(a.id,id);assert.equal(a.contract.execution,'disabled');
    assert.equal(r.status,'READY');assert.equal(r.candidates[0].id,id+'-job');
    assert(Object.isFrozen(r.candidates[0].paths));
  }
});
test('wrong repository, main sha and missing READY cannot prepare work',()=>{
  const a=createUniversalProductRoute(config());
  for(const bad of [null,{}, {...snapshot,repository:'other/repo'},
    {...snapshot,head:'c'.repeat(40)}, {...snapshot,status:'BLOCKED'}]){
    const r=a.evaluate(bad);
    assert.equal(r.status,'BLOCKED');assert.equal(r.candidates.length,0);
  }
});
test('source workspace path escapes and invented tools are rejected at registration',()=>{
  for(const paths of [['../secret'],['/etc/keys'],['foo\\bar'],['src/a','src/a']]){
    assert.throws(()=>createUniversalProductRoute({...config(),workOrders:[{
      ...config().workOrders[0],paths}]}),/PRODUCT_ROUTE_WORK_ORDER_INVALID/);
  }
  assert.throws(()=>createUniversalProductRoute({...config(),workOrders:[{
    ...config().workOrders[0],tool:'shell'}]}),/PRODUCT_ROUTE_WORK_ORDER_INVALID/);
});
test('mutation of caller work order cannot change registered work or scope',()=>{
  const c=config(),a=createUniversalProductRoute(c);
  c.workOrders[0].paths[0]='src/other.mjs';c.workOrders[0].priority=99;
  assert.deepEqual(a.evaluate(snapshot).candidates[0].paths,['src/cabins/fix.mjs']);
  assert.equal(a.evaluate(snapshot).candidates[0].priority,7);
});
test('duplicate ID and over-budget registration fail, no execution port',()=>{
  const c=config();
  assert.throws(()=>createUniversalProductRoute({...c,workOrders:[c.workOrders[0],c.workOrders[0]]}),
    /PRODUCT_ROUTE_WORK_ORDER_INVALID/);
  assert.throws(()=>createUniversalProductRoute({...c,maxPlansPerStage:11}),
    /PRODUCT_ROUTE_CONTRACT_INVALID/);
  const a=createUniversalProductRoute(c);assert.equal(a.execute,undefined);
});


test('non-string route and work-order IDs are never persisted',()=>{
 const baseline={id:'cabins',repository:'ASI-integration/asi-landing',
   head:'a'.repeat(40),contractHash:'b'.repeat(64),stage:'s4-g2',
   workOrders:[{id:'task-a',operation:'prepare-source',
     tool:'existing-runner-bridge',priority:1,paths:['src/example.mjs']}]};
 for(const invalid of [['cabins'],true,undefined]){
   assert.throws(()=>createUniversalProductRoute({...baseline,id:invalid}),
     /PRODUCT_ROUTE_CONTRACT_INVALID/);
   assert.throws(()=>createUniversalProductRoute({...baseline,
     workOrders:[{...baseline.workOrders[0],id:invalid}]}),
     /PRODUCT_ROUTE_WORK_ORDER_INVALID/);
 }
});
