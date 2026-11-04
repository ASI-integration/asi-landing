import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectFiveLaneCatalog} from './host-package.mjs';
const BASE='d'.repeat(40);
const lanes=[
 ['engine','asi/beget-one-engine-20261028'],
 ['ru-auth','feat/ru-unified-auth-20261029'],
 ['p0-integration','asi/standing-delegation-551'],
 ['p0-trust','asi/p0-trusted-evidence-worker-20261029'],
 ['p0-atomic-budget','asi/p0-atomic-budget-worker-20261029']
];
function fixture(){
 return lanes.map(([laneId,branch],i)=>({
   id:'native-five-'+i,laneId,repo:'ASI-integration/asi-landing',
   branch,baseSha:BASE,stage:'S4-G2',kind:'source-proposal',
   objective:'Produce one narrowly scoped source improvement for human review',
   files:[{path:'scripts/strigunov4/fixture-'+i+'.mjs',
     beforeSha256:(i+1).toString().repeat(64)}]
 }));
}
test('five distinct exact source lanes produce an immutable source-only fingerprint',()=>{
 const c=fixture(),r=inspectFiveLaneCatalog(c,BASE);
 assert.equal(r.status,'SOURCE_CATALOG_VALIDATED');
 assert.equal(r.authorized,false);
 assert.equal(r.taskCount,5);assert.equal(r.fileCount,5);
 assert.match(r.catalogSha256,/^[0-9a-f]{64}$/);
 assert.equal(Object.isFrozen(r),true);
});
test('missing, duplicated, reordered or wrong fixed branch rejects all five',()=>{
 for(const change of [
 c=>c.pop(),c=>{c[1].id=c[0].id;},
 c=>{c[1].branch=c[0].branch;},
 c=>{[c[0],c[1]]=[c[1],c[0]];},
 c=>{c[0].baseSha='a'.repeat(40);}
 ]){
   const c=fixture();change(c);
   assert.equal(inspectFiveLaneCatalog(c,BASE).status,'BLOCKED');
 }
});
test('out-of-scope paths, collisions and missing existing-source hashes are refused',()=>{
 for(const change of [
 c=>{c[0].files[0].path='.git/config';},
 c=>{c[1].files[0].path=c[0].files[0].path;},
 c=>{c[0].files[0].beforeSha256=null;},
 c=>{c[0].files[0].path='src/unsafe.ts';},
 c=>{c[0].files[0].path='../protected.mjs';}
 ]){
   const c=fixture();change(c);
   assert.equal(inspectFiveLaneCatalog(c,BASE).status,'BLOCKED');
 }
});
test('unknown task fields and missing objective fail closed',()=>{
 for(const change of [
 c=>{c[0].signed=true;},c=>{c[0].objective='';},
 c=>{delete c[0].files[0].beforeSha256;}
 ]){
   const c=fixture();change(c);
   assert.equal(inspectFiveLaneCatalog(c,BASE).status,'BLOCKED');
 }
});
