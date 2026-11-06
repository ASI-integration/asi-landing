import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareAdmittedFiveWorkerWave} from './five-worker-preparation.mjs';
const H='a'.repeat(40),D='b'.repeat(64);
const slot=i=>({slot:i,product:'product-'+i,repository:'ASI-integration/asi-landing',
  head:H,executable:false,authority:null,
  task:{id:'task-'+i,stage:'s4-g2',operation:'prepare-source',
    tool:'existing-runner-bridge',paths:['scripts/test.mjs']}});
const wave=n=>({status:'PLANNED',executable:false,authority:null,
  publisherConcurrency:1,slots:Array.from({length:n},(_,i)=>slot(i+1))});
const admit=async id=>({verified:true,taskId:id.taskId,product:id.product,
  head:id.head,workspaceKey:'workspace-'+id.slot,claimId:'claim-'+id.slot,token:'test-only-'+id.slot});
const verifyAdmission=async()=>true; // Offline fixture only, not native proof.
const prepared=(id,a)=>({status:'PREPARED',taskId:id.taskId,product:id.product,
  head:id.head,workspaceKey:a.workspaceKey,artifactSha256:D});

test('no signed host ports means no work and no execution',async()=>{
 const r=await prepareAdmittedFiveWorkerWave({wave:wave(5)});
 assert.equal(r.status,'BLOCKED');assert.equal(r.publisherReady,false);
 assert.equal(r.results.length,0);
});
test('serial admissions, then five actual overlapping preparation promises', {timeout:3000},async()=>{
 let admissions=0,started=0,release;
 let notify;
 const allStarted=new Promise(resolve=>{notify=resolve});
 const barrier=new Promise(resolve=>{release=resolve});
 const p=prepareAdmittedFiveWorkerWave({wave:wave(5),
   verifyAdmission,admit:async id=>{admissions++;assert.equal(started,0);return admit(id);},
   prepare:async(id,a)=>{started++;if(started===5)notify();
     await barrier;return prepared(id,a);}
 });
 try {
   await allStarted;
   assert.equal(admissions,5);assert.equal(started,5);
 }finally{release();}
 const result=await p;
 assert.equal(result.status,'PREPARED');
 assert.equal(result.publisherReady,false);
 assert.deepEqual(result.results.map(x=>x.status),Array(5).fill('PREPARED'));
 assert(result.results.every(x=>x.artifactSha256===D));
});
test('one failed task does not cancel four independent preparations or replay',async()=>{
 let calls=0;
 const r=await prepareAdmittedFiveWorkerWave({wave:wave(5),admit,verifyAdmission,
   prepare:async(id,a)=>{calls++;if(id.slot===3)throw Error('untrusted secret failure');
     return prepared(id,a);}
 });
 assert.equal(calls,5);assert.equal(r.status,'PARTIAL');
 assert.equal(r.results[2].status,'UNKNOWN');
 assert.equal(r.results[2].reason,'PREPARATION_OUTCOME_UNKNOWN_NO_REPLAY');
 assert(!JSON.stringify(r).includes('untrusted secret'));
});
test('forged native admission cannot start preparation',async()=>{
 let calls=0;
 const r=await prepareAdmittedFiveWorkerWave({wave:wave(1),
   verifyAdmission,admit:async id=>({...await admit(id),head:'f'.repeat(40)}),
   prepare:async()=>{calls++;return null;}
 });
 assert.equal(calls,0);assert.equal(r.results[0].status,'BLOCKED');
});
test('failed or ambiguous admission never launches unadmitted task',async()=>{
 let calls=0;
 const r=await prepareAdmittedFiveWorkerWave({wave:wave(2),
   verifyAdmission,admit:async id=>id.slot===1?Promise.reject(Error('secret')):admit(id),
   prepare:async(id,a)=>{calls++;return prepared(id,a);}
 });
 assert.equal(calls,1);assert.equal(r.results[0].status,'UNKNOWN');
 assert.equal(r.results[1].status,'PREPARED');
});
test('duplicate workspace keys never run two task callbacks',async()=>{
 let calls=0;
 const r=await prepareAdmittedFiveWorkerWave({wave:wave(2),
   verifyAdmission,admit:async id=>({...await admit(id),workspaceKey:'shared-workspace'}),
   prepare:async(id,a)=>{calls++;return prepared(id,a);}
 });
 assert.equal(calls,1);assert.equal(r.results[1].status,'BLOCKED');
});
test('no unverified or duplicate source slots',async()=>{
 const w=wave(2);w.slots[1].task.id=w.slots[0].task.id;
 w.slots[1].product=w.slots[0].product;
 await assert.rejects(prepareAdmittedFiveWorkerWave({wave:w,admit,verifyAdmission,prepare:prepared}),
   /FIVE_WORKER_SLOT_COLLISION/);
 const mutated=wave(1);mutated.slots[0].authority=true;
 await assert.rejects(prepareAdmittedFiveWorkerWave({
   wave:mutated,admit,verifyAdmission,prepare:prepared}),/FIVE_WORKER_SLOT_INVALID/);
});
test('false model proof is never marked PREPARED',async()=>{
 const r=await prepareAdmittedFiveWorkerWave({wave:wave(1),admit,verifyAdmission,
   prepare:async(id,a)=>({...prepared(id,a),artifactSha256:'fake'})});
 assert.equal(r.status,'PARTIAL');
 assert.equal(r.results[0].reason,'PREPARATION_PROOF_UNVERIFIED_NO_REPLAY');
});

test('hung admission becomes UNKNOWN and does not hold four independent admissions',async()=>{
 let admissions=0,preparedCount=0,signaled=false;
 const r=await prepareAdmittedFiveWorkerWave({wave:wave(5),admissionTimeoutMs:25,
   verifyAdmission,admit:async (id,{signal})=>{
     admissions++;if(id.slot===2)return new Promise(()=>{signal.addEventListener('abort',()=>{signaled=true;},{once:true});});
     return admit(id);
   },
   prepare:async(id,a)=>{preparedCount++;return prepared(id,a);}
 });
 assert.equal(admissions,5);assert.equal(preparedCount,4);assert.equal(signaled,true);
 assert.equal(r.status,'PARTIAL');
 assert.equal(r.results[1].reason,'ADMISSION_DEADLINE_UNKNOWN_NO_REPLAY');
});
test('hung source preparation becomes UNKNOWN without blocking other four outputs',async()=>{
 let started=0,signaled=false;
 const r=await prepareAdmittedFiveWorkerWave({wave:wave(5),admit,verifyAdmission,preparationTimeoutMs:25,
   prepare:async(id,a)=>{
     started++;if(id.slot===4)return new Promise(()=>{a.signal.addEventListener('abort',()=>{signaled=true;},{once:true});});
     return prepared(id,a);
   }
 });
 assert.equal(started,5);assert.equal(signaled,true);
 assert.equal(r.status,'PARTIAL');assert.equal(r.results[3].status,'UNKNOWN');
 assert.equal(r.results[3].reason,'PREPARATION_DEADLINE_UNKNOWN_NO_REPLAY');
 assert.equal(r.results.filter(x=>x.status==='PREPARED').length,4);
});
test('invalid external deadlines reject before any host port call',async()=>{
 let calls=0;
 await assert.rejects(prepareAdmittedFiveWorkerWave({wave:wave(1),
   admissionTimeoutMs:0,verifyAdmission,admit:async()=>{calls++;},prepare:prepared}),
   /FIVE_WORKER_DEADLINE_INVALID/);
 assert.equal(calls,0);
});

test('a self-attested verified response is not enough without native readback',async()=>{
 let called=0;
 const r=await prepareAdmittedFiveWorkerWave({wave:wave(1),admit,
   prepare:async()=>{called++;}});
 assert.equal(r.status,'BLOCKED');assert.equal(called,0);
 assert.equal(r.reason,'SIGNED_HOST_PORTS_REQUIRED');
});
test('native readback rejects unsupported claim, without preparing code',async()=>{
 let called=0;
 const r=await prepareAdmittedFiveWorkerWave({wave:wave(1),admit,
   verifyAdmission:async()=>false,
   prepare:async()=>{called++;}});
 assert.equal(called,0);assert.equal(r.status,'PARTIAL');
 assert.equal(r.results[0].reason,'NATIVE_CLAIM_READBACK_UNVERIFIED');
});
test('an unavailable readback leaves its lane UNKNOWN but other lanes advance',async()=>{
 let called=0;
 const r=await prepareAdmittedFiveWorkerWave({wave:wave(2),admit,
   verifyAdmission:async id=>{if(id.slot===1)throw Error('sensitive private path');return true;},
   prepare:async(id,a)=>{called++;return prepared(id,a);}});
 assert.equal(called,1);
 assert.equal(r.results[0].status,'UNKNOWN');
 assert.equal(r.results[1].status,'PREPARED');
 assert(!JSON.stringify(r).includes('sensitive private path'));
});
test('two different tasks cannot reuse the same durable claim ID',async()=>{
 let called=0;
 const r=await prepareAdmittedFiveWorkerWave({wave:wave(2),
   admit:async id=>({...await admit(id),claimId:'same-claim'}),
   verifyAdmission,
   prepare:async(id,a)=>{called++;return prepared(id,a);}});
 assert.equal(called,1);
 assert.equal(r.results[1].reason,'NATIVE_CLAIM_ID_UNVERIFIED');
});


test('object workspace IDs cannot bypass uniqueness in signed admission',async()=>{
 let calls=0;
 const r=await prepareAdmittedFiveWorkerWave({wave:wave(2),
   admit:async id=>({...await admit(id),workspaceKey:['shared-workspace']}),
   verifyAdmission,prepare:async()=>{calls++;return null;}});
 assert.equal(calls,0);
 assert.equal(r.results[0].reason,'TASK_EXACT_NATIVE_ADMISSION_MISSING');
});
test('array-valued artifact hash cannot be treated as verified proof',async()=>{
 const r=await prepareAdmittedFiveWorkerWave({wave:wave(1),admit,verifyAdmission,
   prepare:async(id,a)=>({...prepared(id,a),artifactSha256:[D]})});
 assert.equal(r.results[0].status,'UNKNOWN');
 assert.equal(r.results[0].reason,'PREPARATION_PROOF_UNVERIFIED_NO_REPLAY');
});
