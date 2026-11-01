import test from 'node:test';
import assert from 'node:assert/strict';
import {createBoundPublishedModelReview} from './beget-native-source-review.mjs';

const H='a'.repeat(64),BASE='b'.repeat(40),HEAD='c'.repeat(40),DELTA='d'.repeat(64);
const TASK={id:'asi-engine-groundzero-01',repo:'ASI-integration/asi-landing',
 sha:BASE,branch:'asi/engine-task/asi-engine-groundzero-01'};
const PIN={id:TASK.id,repo:TASK.repo,baseSha:TASK.sha,branch:TASK.branch,
 pr:777,sha:HEAD,deltaSha256:DELTA,policySha256:H};
const review=({status='PASS',independent=true,evidenceId='native-published-1',...other}={})=>({
 status,independent,evidenceId,taskId:PIN.id,baseSha:PIN.baseSha,
 deltaSha256:PIN.deltaSha256,...other
});
test('two exact-head Publisher reads consume ONE actual model verdict only',async()=>{
 let paid=0,checked=0;const port=createBoundPublishedModelReview({
  policySha256:H,model:'independent-model',getBoundTask:()=>TASK,
  revalidate:async()=>{checked++;return true;},
  reviewSource:async request=>{
   paid++;assert.deepEqual(request,{taskId:TASK.id,baseSha:BASE,
    deltaSha256:DELTA,reviewPurpose:'PUBLISHED_PR',pr:777,head:HEAD});
   return review();
  }
 });
 const first=await port.verify(PIN);
 const second=await port.verify({...PIN});
 assert.deepEqual(second,first);
 assert.equal(first.status,'PASS');assert.equal(first.independent,true);
 assert.match(first.evidenceSha256,/^[a-f0-9]{64}$/);
 assert.equal(paid,1,'second Publisher check cannot repeat paid reservation');
 assert.equal(checked,3,'authority checked before and after model and on reuse');
});
test('changed PR head, policy, diff or task binding can never reuse cached verdict',async()=>{
 let paid=0,task=TASK;const port=createBoundPublishedModelReview({
  policySha256:H,model:'reviewer',getBoundTask:()=>task,
  revalidate:async()=>true,reviewSource:async()=>{paid++;return review();}
 });
 await port.verify(PIN);
 for(const change of [
  {sha:'e'.repeat(40)},{deltaSha256:'f'.repeat(64)},
  {policySha256:'e'.repeat(64)},{pr:778},
  {branch:'asi/engine-task/foreign'},
  {baseSha:'e'.repeat(40)}
 ])await assert.rejects(port.verify({...PIN,...change}),
     /NATIVE_PUBLISHED_REVIEW_(PIN_MOVED|SCOPE)/);
 task={...TASK,id:'different'};
 await assert.rejects(port.verify(PIN),/NATIVE_PUBLISHED_REVIEW_SCOPE/);
 assert.equal(paid,1);
});
test('failed, non-independent or malformed model review cannot be reused',async()=>{
 for(const reply of [
  review({status:'FAILED'}),review({independent:false}),
  review({evidenceId:'bad evidence'}),review({taskId:'wrong'}),
  review({baseSha:'e'.repeat(40)}),
  review({deltaSha256:'f'.repeat(64)})
 ]){
  let count=0;
  const port=createBoundPublishedModelReview({
   policySha256:H,model:'reviewer',getBoundTask:()=>TASK,
   revalidate:async()=>true,reviewSource:async()=>{count++;return reply;}
  });
  await assert.rejects(port.verify(PIN),/NATIVE_PUBLISHED_REVIEW_FAILED/);
  await assert.rejects(port.verify(PIN),/NATIVE_PUBLISHED_REVIEW_FAILED/);
  assert.equal(count,2,'no stale positive cache after reject');
 }
});
test('revoked signed authority invalidates cached review before second check',async()=>{
 let allow=true,calls=0;
 const port=createBoundPublishedModelReview({
  policySha256:H,model:'reviewer',getBoundTask:()=>TASK,
  revalidate:async()=>allow,reviewSource:async()=>{calls++;return review();}
 });
 const result=await port.verify(PIN);
 allow=false;
 await assert.rejects(port.verify(PIN),/NATIVE_PUBLISHED_REVIEW_AUTHORITY_CHANGED/);
 assert.equal(calls,1);
 assert.equal(result.status,'PASS');
});
test('no model calls without source task binding or valid policy hash',async()=>{
 let calls=0;const port=createBoundPublishedModelReview({
  policySha256:H,model:'reviewer',getBoundTask:()=>null,
  revalidate:async()=>true,reviewSource:async()=>{calls++;return review();}
 });
 await assert.rejects(port.verify(PIN),/NATIVE_PUBLISHED_REVIEW_SCOPE/);
 assert.equal(calls,0);
 assert.throws(()=>createBoundPublishedModelReview({
  policySha256:'bogus',model:'reviewer',getBoundTask:()=>TASK,
  revalidate:async()=>true,reviewSource:async()=>review()
 }),/NATIVE_PUBLISHED_REVIEW_CONFIGURATION/);
});
