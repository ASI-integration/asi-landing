import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {runUniversalFiveWorkerHandoff} from './five-worker-end-to-end.mjs';
const hash=s=>createHash('sha256').update(s).digest('hex');
const BASE='a'.repeat(40),HEAD='c'.repeat(40);
const slots=Array.from({length:5},(_,i)=>({slot:i+1,product:'product-'+(i+1),
  repository:'ASI-integration/asi-landing',head:BASE,executable:false,authority:null,
  task:{id:'task-'+(i+1),paths:['src/example.mjs']}}));
const changes=x=>{const content='export const n='+x.slot+';\n';
  return [{path:'src/example.mjs',beforeSha256:null,afterSha256:hash(content),content}]};
const digest=x=>hash(JSON.stringify({taskId:x.task.id,product:x.product,
  repository:x.repository,baseSha:x.head,changes:changes(x)}));
const wave={status:'PLANNED',executable:false,authority:null,
  publisherConcurrency:1,slots};
const prepared=(status='PREPARED')=>({status,publisherReady:false,
  results:slots.map(s=>({slot:s.slot,taskId:s.task.id,
    product:s.product,repository:s.repository,baseSha:s.head,
    status:'PREPARED',artifactSha256:digest(s)}))});
const readPrepared=async q=>({...q,changes:changes(q)});
const publishOne=async t=>({status:'PUBLISHED',taskId:t.taskId,
  product:t.product,repository:t.repository,baseSha:t.baseSha,
  pr:Number(t.taskId.split('-')[1])+600,head:HEAD});
const verifyReceipt=async(t,{pr,head})=>({status:'VERIFIED',taskId:t.taskId,
  product:t.product,repository:t.repository,baseSha:t.baseSha,pr,head});
test('five verified artifacts reach one serial publisher and exact receipts through composition',async()=>{
 let inflight=0,peak=0,reads=0,writes=0;
 const result=await runUniversalFiveWorkerHandoff({wave,preparation:prepared(),
   readPrepared:async q=>{reads++;return readPrepared(q);},
   verifyPrepared:async()=>true,
   publishOne:async task=>{inflight++;peak=Math.max(inflight,peak);
     writes++;await Promise.resolve();const r=await publishOne(task);inflight--;return r;},
   verifyReceipt});
 assert.equal(result.status,'VERIFIED');assert.equal(result.receiptCount,5);
 assert.equal(reads,5);assert.equal(writes,5);assert.equal(peak,1);
 assert.equal(result.authorized,false);assert.equal(result.publisherConcurrency,1);
});
test('one unverified source is excluded and cannot be published while four continue',async()=>{
 let writes=0;
 const p=prepared('PARTIAL');
 p.results[2].artifactSha256='b'.repeat(64);
 const result=await runUniversalFiveWorkerHandoff({wave,preparation:p,readPrepared,
   verifyPrepared:async()=>true,
   publishOne:async t=>{writes++;return publishOne(t)},verifyReceipt});
 assert.equal(writes,4);assert.equal(result.receiptCount,4);
 assert.equal(result.status,'PARTIAL');
 assert.equal(result.blocked[0].reason,'SOURCE_ARTIFACT_DIGEST_MISMATCH');
});
test('a missing actual publisher port cannot invent success',async()=>{
 const result=await runUniversalFiveWorkerHandoff({wave,preparation:prepared(),readPrepared});
 assert.equal(result.status,'PARTIAL');assert.equal(result.receiptCount,0);
 assert.equal(result.authorized,false);
});
test('uncertain publisher call is not replayed and the other four advance',async()=>{
 let writes=0;
 const result=await runUniversalFiveWorkerHandoff({wave,preparation:prepared(),readPrepared,
  verifyPrepared:async()=>true,
  publishOne:async t=>{writes++;if(t.taskId==='task-3')throw Error('secret');return publishOne(t);},
  verifyReceipt});
 assert.equal(writes,5);assert.equal(result.receiptCount,4);
 assert.equal(result.status,'PARTIAL');
 assert.equal(result.results[2].status,'UNKNOWN');
 assert(!JSON.stringify(result).includes('secret'));
});
