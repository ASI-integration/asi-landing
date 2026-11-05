import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {compileFiveWorkerPublisherHandoff} from './five-worker-publisher-handoff.mjs';
const SHA='a'.repeat(40);
const sha=s=>createHash('sha256').update(s).digest('hex');
const slots=Array.from({length:5},(_,i)=>({slot:i+1,product:'product-'+(i+1),
  repository:'ASI-integration/asi-landing',head:SHA,executable:false,authority:null,
  task:{id:'task-'+(i+1),paths:['src/example.mjs']}}));
const wave={status:'PLANNED',executable:false,authority:null,publisherConcurrency:1,slots};
const preparation={status:'PREPARED',publisherReady:false,results:slots.map(s=>({
  slot:s.slot,taskId:s.task.id,status:'PREPARED',artifactSha256:'b'.repeat(64)}))};
const readPrepared=async p=>{
  const content='export const x='+p.slot+';\n';
  return {...p,changes:[{path:'src/example.mjs',content,beforeSha256:null,afterSha256:sha(content)}]};
};

test('five independent candidates, one Publisher, zero execution authority',async()=>{
 const out=await compileFiveWorkerPublisherHandoff({wave,preparation,readPrepared});
 assert.equal(out.status,'CANDIDATES_READY');assert.equal(out.ready.length,5);
 assert.equal(out.publisherConcurrency,1);assert.equal(out.authorized,false);
 assert.equal(out.publishAllowed,false);
 assert(out.ready.every(c=>c.authorized===false&&c.publishAllowed===false));
 assert(Object.isFrozen(out.ready[0].changes));
});
test('forged bytes or path cannot reach handoff',async()=>{
 const out=await compileFiveWorkerPublisherHandoff({wave,preparation,
   readPrepared:async p=>{
     const proof=await readPrepared(p);proof.changes[0].content='tampered';return proof;
   }});
 assert.equal(out.ready.length,0);assert.equal(out.blocked.length,5);
 assert(out.blocked.every(v=>v.reason==='SOURCE_BYTES_OR_SCOPE_UNVERIFIED'));
});
test('failed worker does not stop four independent candidates',async()=>{
 const state={...preparation,status:'PARTIAL',results:preparation.results.map((r,i)=>
   i===2?{...r,status:'UNKNOWN'}:r)};
 const out=await compileFiveWorkerPublisherHandoff({wave,preparation:state,readPrepared});
 assert.equal(out.ready.length,4);assert.equal(out.blocked[0].slot,3);
});
test('unknown readback never retried, remaining lanes progress',async()=>{
 let count=0;
 const out=await compileFiveWorkerPublisherHandoff({wave,preparation,
   readPrepared:async p=>{count++;if(p.slot===3)throw Error('secret');return readPrepared(p);}});
 assert.equal(count,5);assert.equal(out.ready.length,4);
 assert.equal(out.blocked[0].status,'UNKNOWN');
 assert(!JSON.stringify(out).includes('secret'));
});
test('forged task reference cannot borrow another task',async()=>{
 const altered={...preparation,results:preparation.results.map((r,i)=>
   i===0?{...r,taskId:'task-2'}:r)};
 const out=await compileFiveWorkerPublisherHandoff({wave,preparation:altered,readPrepared});
 assert.equal(out.status,'BLOCKED');assert.equal(out.ready.length,0);
});
test('missing host reader fails closed',async()=>{
 const out=await compileFiveWorkerPublisherHandoff({wave,preparation});
 assert.equal(out.status,'BLOCKED');assert.equal(out.ready.length,0);
});
