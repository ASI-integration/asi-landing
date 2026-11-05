import test from 'node:test';
import assert from 'node:assert/strict';
import {handoffToSingleNativePublisher} from './five-worker-publisher-bridge.mjs';

const SHA='a'.repeat(40),HEAD='c'.repeat(40),ART='b'.repeat(64);
const item=n=>({status:'PREPARED',taskId:'job-'+n,product:'product-'+n,
  repository:'ASI-integration/asi-landing',baseSha:SHA,artifactSha256:ART});
const wave=(n=5)=>({status:'PREPARED',publisherReady:false,
  results:Array.from({length:n},(_,i)=>item(i+1))});
const publish=async task=>({status:'PUBLISHED',
  taskId:task.taskId,product:task.product,repository:task.repository,
  baseSha:task.baseSha,pr:Number(task.taskId.split('-')[1])+500,head:HEAD});
const receipt=async(task,{pr,head})=>({status:'VERIFIED',taskId:task.taskId,
  product:task.product,repository:task.repository,baseSha:task.baseSha,pr,head});

test('five prepared candidates use ONE serial Publisher port, five native receipts',async()=>{
 let active=0,maximum=0,calls=0;
 const r=await handoffToSingleNativePublisher({preparation:wave(),
   verifyPrepared:async()=>true,
   publishOne:async task=>{
     active++;maximum=Math.max(maximum,active);calls++;
     await Promise.resolve();
     const result=await publish(task);
     active--;return result;
   },verifyReceipt:receipt});
 assert.equal(calls,5);assert.equal(maximum,1);
 assert.equal(r.status,'VERIFIED');assert.equal(r.receiptCount,5);
 assert(r.results.every(x=>x.status==='VERIFIED'&&x.pr>0&&x.head===HEAD));
 assert.equal(r.authorized,false);
});
test('missing native ports cannot publish or invent a receipt',async()=>{
 const r=await handoffToSingleNativePublisher({preparation:wave(5)});
 assert.equal(r.status,'BLOCKED');assert.equal(r.receiptCount,0);
});
test('a failed publisher does not replay and independent work continues',async()=>{
 let calls=0;
 const r=await handoffToSingleNativePublisher({preparation:wave(5),
   verifyPrepared:async()=>true,
   publishOne:async task=>{calls++;if(task.taskId==='job-3')throw Error('secret body');return publish(task);},
   verifyReceipt:receipt});
 assert.equal(calls,5);
 assert.equal(r.status,'PARTIAL');assert.equal(r.receiptCount,4);
 assert.equal(r.results[2].status,'UNKNOWN');
 assert.equal(r.results[2].reason,'NATIVE_PUBLICATION_UNKNOWN_NO_REPLAY');
 assert(!JSON.stringify(r).includes('secret body'));
});
test('unverified prepared artifact blocks before native publisher mutation',async()=>{
 let calls=0;
 const r=await handoffToSingleNativePublisher({preparation:wave(2),
   verifyPrepared:async task=>task.taskId!=='job-1',
   publishOne:async task=>{calls++;return publish(task);},verifyReceipt:receipt});
 assert.equal(calls,1);assert.equal(r.receiptCount,1);
 assert.equal(r.results[0].status,'BLOCKED');
});
test('publisher reports are NOT receipts without real readback',async()=>{
 const r=await handoffToSingleNativePublisher({preparation:wave(1),
   verifyPrepared:async()=>true,publishOne:publish,verifyReceipt:async()=>false});
 assert.equal(r.receiptCount,0);assert.equal(r.status,'PARTIAL');
 assert.equal(r.results[0].reason,'NATIVE_RECEIPT_UNVERIFIED_NO_REPLAY');
});
test('a pending CI result is never misreported as verified receipt',async()=>{
 let reads=0;
 const r=await handoffToSingleNativePublisher({preparation:wave(1),
   verifyPrepared:async()=>true,publishOne:async()=>({status:'PENDING_CI'}),
   verifyReceipt:async()=>{reads++;return receipt();}});
 assert.equal(reads,0);assert.equal(r.receiptCount,0);
 assert.equal(r.results[0].status,'PENDING');
});
test('no prepared tasks is idle, not an invented success',async()=>{
 const r=await handoffToSingleNativePublisher({preparation:{
   status:'PARTIAL',publisherReady:false,results:[
     {status:'UNKNOWN',taskId:'job-1',product:'product-1'}
   ]},verifyPrepared:async()=>true,publishOne:publish,verifyReceipt:receipt});
 assert.equal(r.status,'IDLE');assert.equal(r.receiptCount,0);
});
test('duplicate prepared identities rejected before native effects',async()=>{
 let calls=0;
 await assert.rejects(handoffToSingleNativePublisher({preparation:{
   status:'PREPARED',publisherReady:false,results:[item(1),item(1)]},
   verifyPrepared:async()=>true,publishOne:async()=>{calls++;},verifyReceipt:receipt}),
   /PUBLISH_HANDOFF_TASK_INVALID/);
 assert.equal(calls,0);
});
test('timeout after entering a publisher call remains UNKNOWN, not retryable',async()=>{
 let calls=0;
 const r=await handoffToSingleNativePublisher({preparation:wave(1),timeoutMs:25,
   verifyPrepared:async()=>true,
   publishOne:async()=>{calls++;return new Promise(()=>{});},verifyReceipt:receipt});
 assert.equal(calls,1);
 assert.equal(r.status,'PARTIAL');assert.equal(r.receiptCount,0);
 assert.equal(r.results[0].reason,'NATIVE_PUBLICATION_TIMEOUT_NO_REPLAY');
});
