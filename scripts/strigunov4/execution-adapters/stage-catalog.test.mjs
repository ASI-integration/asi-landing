import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {verifyBoundedStageCatalog} from './host-authority.mjs';
const h=s=>createHash('sha256').update(s).digest('hex');
const task=(id,path)=>({id,workOrderId:id+'-source',kind:'github-publisher',
 stage:'S4-G1',repo:'ASI-integration/asi-landing',sha:'a'.repeat(40),pr:null,
 branch:'asi/engine-task/'+id,changes:[{path,beforeSha256:'b'.repeat(64),content:'offline test'}]});
const a=task('g1-stage-alpha','scripts/strigunov4/c4_unit_contract.py');
const b=task('g1-stage-beta','scripts/strigunov4/c4_unit_readonly.py');
const payload=(catalog)=>({baseSha:'a'.repeat(40),repo:'ASI-integration/asi-landing',
 catalogSha256:h(JSON.stringify(catalog)),stageDelegation:{schema:'asi.engine-stage-catalog.v1',
 stage:'S4-G1',maximumTasks:catalog.length,workOrderIds:catalog.map(t=>t.workOrderId),
 noWorkflowWrite:true,noMerge:true}});
test('new multi-task authority must bind all tasks to same exact signed catalog',()=>{
 const cat=[a,b],p=payload(cat);
 assert.equal(verifyBoundedStageCatalog(JSON.stringify(cat),p).length,2);
 assert.throws(()=>verifyBoundedStageCatalog(JSON.stringify(cat),{...p,stageDelegation:undefined}),/DELEGATION/);
 assert.throws(()=>verifyBoundedStageCatalog(JSON.stringify(cat),{...p,catalogSha256:'c'.repeat(64)}),/NOT_SIGNED/);
});
test('historical single-task catalog remains supported',()=>{
 const cat=[a],p=payload(cat);delete p.stageDelegation;
 assert.equal(verifyBoundedStageCatalog(JSON.stringify(cat),p).length,1);
});
test('single signed scope cannot authorize YAML, changed SHA or duplicate jobs',()=>{
 for(const cat of [
  [a,{...b,changes:[{...b.changes[0],path:'.github/workflows/run.yml'}]}],
  [a,{...b,sha:'f'.repeat(40)}],
  [a,{...b,id:a.id}],
  [a,{...b,workOrderId:a.workOrderId}],
  [a,{...b,branch:a.branch}],
  [a,{...b,pr:531}],
 ])assert.throws(()=>verifyBoundedStageCatalog(JSON.stringify(cat),payload(cat)),/SCOPE|DUPLICATE/);
});
test('extra catalog tasks or incorrect claimed stage rights are denied',()=>{
 const cat=[a,b],p=payload(cat);
 for(const d of [{...p.stageDelegation,noWorkflowWrite:false},
  {...p.stageDelegation,maximumTasks:1},
  {...p.stageDelegation,workOrderIds:[b.workOrderId,a.workOrderId]}]){
  assert.throws(()=>verifyBoundedStageCatalog(JSON.stringify(cat),{...p,stageDelegation:d}),/DELEGATION/);
 }
});
