import test from 'node:test';
import assert from 'node:assert/strict';
import {serializeNativeModelReservations} from './serial-native-model-reservations.mjs';

const SHA='a'.repeat(40),PATH='b'.repeat(64);
const request=i=>({taskId:'task-'+i,baseSha:SHA,model:'gpt-4.1-mini',
  maxOutputTokens:1024,pathDigest:PATH});
const receipt=r=>({authorized:true,...r,operationId:'model-'+r.taskId});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

test('five native claims serialize but independent model transports may overlap',async()=>{
 let active=0,peakClaims=0,peakModel=0,modelActive=0,claims=0;
 const reservation=serializeNativeModelReservations(async r=>{
   active++;peakClaims=Math.max(active,peakClaims);claims++;
   await sleep(8);active--;return receipt(r);
 });
 const jobs=Array.from({length:5},(_,i)=>request(i+1));
 const responses=await Promise.all(jobs.map(async job=>{
   const allowed=await reservation(job);
   assert.equal(allowed.authorized,true);
   modelActive++;peakModel=Math.max(peakModel,modelActive);
   await sleep(55);modelActive--;
   return allowed.operationId;
 }));
 assert.equal(claims,5);assert.equal(peakClaims,1);
 assert.equal(peakModel,5);
 assert.deepEqual(responses,jobs.map(r=>'model-'+r.taskId));
});

test('duplicate model input cannot consume a second native reservation',async()=>{
 let calls=0;
 const reserve=serializeNativeModelReservations(async r=>{calls++;return receipt(r)});
 await reserve(request(1));
 await assert.rejects(reserve({...request(1)}),/NATIVE_MODEL_CLAIM_DUPLICATE_NO_REPLAY/);
 assert.equal(calls,1);
 await reserve(request(2));
 assert.equal(calls,2);
});

test('unknown first reservation poisons only this in-process shared claim port',async()=>{
 let calls=0;
 const reserve=serializeNativeModelReservations(async r=>{
   calls++;if(r.taskId==='task-1')throw Error('secret private token');
   return receipt(r);
 });
 const out=await Promise.allSettled([reserve(request(1)),reserve(request(2)),reserve(request(3))]);
 assert.equal(calls,1);
 assert.equal(out[0].status,'rejected');
 assert.match(out[0].reason.message,/NATIVE_MODEL_RESERVATION_OUTCOME_UNKNOWN_NO_REPLAY/);
 assert.equal(out[1].reason.message,'NATIVE_MODEL_LEDGER_UNCERTAIN_FAILED_LOCKED');
 assert(!out.map(x=>String(x.reason)).join().includes('secret'));
});

test('unverified native budget receipt poisons port before any model egress',async()=>{
 let calls=0;
 const reserve=serializeNativeModelReservations(async r=>{
   calls++;return {...receipt(r),baseSha:'f'.repeat(40)};
 });
 await assert.rejects(reserve(request(1)),/NATIVE_MODEL_RESERVATION_READBACK_UNVERIFIED/);
 await assert.rejects(reserve(request(2)),/NATIVE_MODEL_LEDGER_UNCERTAIN_FAILED_LOCKED/);
 assert.equal(calls,1);
});

test('invalid model request cannot reach native reserve',async()=>{
 let calls=0;
 const reserve=serializeNativeModelReservations(async r=>{calls++;return receipt(r)});
 for(const malformed of [
   {...request(1),taskId:['task-1']},
   {...request(2),pathDigest:['b'.repeat(64)]},
   {...request(3),maxOutputTokens:0},
   {...request(4),baseSha:'not-a-sha'},
 ]){
   await assert.rejects(reserve(malformed),/NATIVE_MODEL_RESERVATION_INPUT_INVALID/);
 }
 assert.equal(calls,0);
 await reserve(request(1));
 assert.equal(calls,1);
});

test('request identity is frozen before waiting in admission queue',async()=>{
 let allow;const gate=new Promise(resolve=>{allow=resolve});
 const seen=[];
 const reserve=serializeNativeModelReservations(async r=>{
   seen.push(r.taskId);if(r.taskId==='task-1')await gate;
   return receipt(r);
 });
 const one=reserve(request(1)),next=request(2),two=reserve(next);
 next.taskId='another';
 allow();
 assert.equal((await two).taskId,'task-2');
 await one;assert.deepEqual(seen,['task-1','task-2']);
});
