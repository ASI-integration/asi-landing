import test from 'node:test';
import assert from 'node:assert/strict';
import {UNIVERSAL_LANES,planUniversalFiveLanes} from './five-lane-plan.mjs';
const SHA='a'.repeat(40);
const task=(id,lane,product='cabins',overrides={})=>({id,lane,product,baseSha:SHA,status:'READY',dependsOn:[],priority:50,...overrides});
const receipt=t=>({taskId:t.id,product:t.product,baseSha:t.baseSha,status:'VERIFIED'});
const claim=t=>({taskId:t.id,product:t.product,baseSha:t.baseSha,status:'UNKNOWN'});

test('five products are independently selected, without execution',()=>{
 const orders=UNIVERSAL_LANES.map((lane,i)=>task('job-'+i,lane,
   ['cabins','strigunov','booking','marketing','education'][i]));
 const result=planUniversalFiveLanes({workOrders:orders});
 assert.equal(result.selected.length,5);
 assert.equal(new Set(result.selected.map(x=>x.lane)).size,5);
 assert.equal(result.authorized,false);assert.equal(result.execute,false);
 assert.equal(result.modelCalls,0);assert.equal(result.externalWrites,0);
});
test('one work order per lane even if two independent tasks are ready',()=>{
 const result=planUniversalFiveLanes({workOrders:[
   task('job-a','builder'),task('job-b','builder','cabins',{priority:10})]});
 assert.equal(result.selected.length,1);
});
test('unknown paid claim cannot replay, independent product can continue',()=>{
 const a=task('job-a','planner'),b=task('job-b','builder','booking');
 const result=planUniversalFiveLanes({workOrders:[a,b],claims:[claim(a)],verifyNativeEvidence:()=>true});
 assert.deepEqual(result.selected.map(x=>x.taskId),['job-b']);
 assert.equal(result.blocked[0].reason,'PRESERVED_CLAIM_NO_REPLAY');
});
test('dependent work requires bound verified completion',()=>{
 const a=task('job-a','builder'),b=task('job-b','tester','cabins',{dependsOn:['job-a']});
 assert.deepEqual(planUniversalFiveLanes({workOrders:[a,b]}).selected.map(x=>x.taskId),['job-a']);
 assert.deepEqual(planUniversalFiveLanes({workOrders:[a,b],receipts:[receipt(a)],verifyNativeEvidence:()=>true})
   .selected.map(x=>x.taskId),['job-b']);
});
test('cross-product dependencies cannot grant authorization',()=>{
 const a=task('job-a','builder','cabins');
 const b=task('job-b','tester','booking',{dependsOn:['job-a']});
 assert.throws(()=>planUniversalFiveLanes({workOrders:[a,b]}),
   /UNIVERSAL_DEPENDENCY_OUTSIDE_PRODUCT/);
});
test('duplicate jobs and forged receipt or claim are rejected',()=>{
 const a=task('job-a','planner');
 assert.throws(()=>planUniversalFiveLanes({workOrders:[a,a]}),/UNIVERSAL_WORK_ORDER_INVALID/);
 assert.throws(()=>planUniversalFiveLanes({workOrders:[a],receipts:[
   {...receipt(a),baseSha:'b'.repeat(40)}],verifyNativeEvidence:()=>true}),/UNIVERSAL_RECEIPT_NOT_BOUND/);
 assert.throws(()=>planUniversalFiveLanes({workOrders:[a],claims:[
   {...claim(a),baseSha:'b'.repeat(40)}],verifyNativeEvidence:()=>true}),/UNIVERSAL_CLAIM_NOT_BOUND/);
});
test('not more than five lanes or changed input task state',()=>{
 assert.throws(()=>planUniversalFiveLanes({workOrders:[task('job-a','rogue')]}),
   /UNIVERSAL_WORK_ORDER_INVALID/);
 assert.throws(()=>planUniversalFiveLanes({workOrders:[],maxParallel:6}),
   /UNIVERSAL_PLAN_INPUT_INVALID/);
 const job=task('job-b','planner'),before=JSON.stringify(job);
 planUniversalFiveLanes({workOrders:[job]});assert.equal(JSON.stringify(job),before);
});

test('cyclic dependencies are rejected before assigning any worker',()=>{
 const a=task('job-a','planner','cabins',{dependsOn:['job-b']});
 const b=task('job-b','builder','cabins',{dependsOn:['job-a']});
 assert.throws(()=>planUniversalFiveLanes({workOrders:[a,b]}),
   /UNIVERSAL_DEPENDENCY_CYCLE/);
});

test('plain VERIFIED receipt and UNKNOWN claim cannot affect selection without native host',()=>{
 const a=task('job-a','planner');
 assert.throws(()=>planUniversalFiveLanes({workOrders:[a],receipts:[receipt(a)]}),
   /NATIVE_LEDGER_EVIDENCE_REQUIRED/);
 assert.throws(()=>planUniversalFiveLanes({workOrders:[a],claims:[claim(a)]}),
   /NATIVE_LEDGER_EVIDENCE_REQUIRED/);
});
test('native verifier must approve the exact task and evidence inventory',()=>{
 const a=task('job-a','planner');let observed;
 const result=planUniversalFiveLanes({workOrders:[a],receipts:[receipt(a)],
   verifyNativeEvidence:pin=>{observed=pin;return true;}});
 assert.equal(result.verifiedCount,1);
 assert.deepEqual(observed.workOrders,[{taskId:a.id,product:a.product,baseSha:a.baseSha}]);
 assert.equal(Object.isFrozen(observed.receipts),true);
 assert.equal(Object.isFrozen(observed.receipts[0]),true);
 assert.throws(()=>planUniversalFiveLanes({workOrders:[a],receipts:[receipt(a)],
   verifyNativeEvidence:()=>false}),/NATIVE_LEDGER_EVIDENCE_UNVERIFIED/);
 assert.throws(()=>planUniversalFiveLanes({workOrders:[a],claims:[claim(a)],
   verifyNativeEvidence:()=>{throw Error('private path');}}),/NATIVE_LEDGER_EVIDENCE_UNVERIFIED/);
});
