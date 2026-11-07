import test from 'node:test';
import assert from 'node:assert/strict';
import {publishPreparedFiveWorkerWave,verifyFiveWorkerAfterRestart} from './native-five-worker-publisher.mjs';

const SHA='a'.repeat(40),DIGEST='b'.repeat(64),HEAD='c'.repeat(40);
const REPO='ASI-integration/asi-landing';
const item=i=>({slot:i,taskId:'worker-'+i,product:'product-'+i,
  repository:REPO,baseSha:SHA,status:'PREPARED',artifactSha256:DIGEST});
const wave=(n=5)=>({status:'PREPARED',publisherReady:false,
  results:Array.from({length:n},(_,i)=>item(i+1))});
const draft=item=>({draft:true,number:item.slot,repository:item.repository,
  baseSha:item.baseSha,taskId:item.taskId,headSha:HEAD,
  url:'https://github.com/'+REPO+'/pull/'+item.slot});
const ports=()=>{
  const durable=new Map();let active=0,peak=0,publications=0;
  return {
    get stats(){return {active,peak,publications}},durable,
    authorizePublication:async item=>({approved:true,taskId:item.taskId,
      repository:item.repository,baseSha:item.baseSha,artifactSha256:item.artifactSha256}),
    publishDraft:async item=>{
      active++;peak=Math.max(peak,active);publications++;
      await new Promise(r=>setTimeout(r,2));active--;return draft(item);
    },
    verifyDraft:async()=>true,
    appendReceipt:async (item,receipt)=>{durable.set(item.taskId,structuredClone(receipt));return true},
    readReceipt:async item=>durable.get(item.taskId)??null
  };
};

test('five prepared tasks produce five distinct verified Draft PR receipts with one publisher',async()=>{
 const p=ports();const res=await publishPreparedFiveWorkerWave({wave:wave(5),...p});
 assert.equal(res.status,'RECEIPTS_VERIFIED');
 assert.equal(res.results.length,5);
 assert.deepEqual(res.results.map(x=>x.pr),[1,2,3,4,5]);
 assert.equal(res.results.filter(x=>x.status==='RECEIPT_VERIFIED').length,5);
 assert.equal(p.stats.peak,1);
 assert.equal(p.durable.size,5);
});

test('a second invocation never repeats published external effects',async()=>{
 const p=ports(),w=wave(3);
 await publishPreparedFiveWorkerWave({wave:w,...p});
 const repeat=await publishPreparedFiveWorkerWave({wave:w,...p});
 assert.equal(repeat.status,'RECEIPTS_VERIFIED');
 assert(repeat.results.every(x=>x.status==='ALREADY_RECORDED'));
 assert.equal(p.stats.publications,3);
});

test('one unknown PR result is quarantined while the other four proceed',async()=>{
 const p=ports(),orig=p.publishDraft;
 p.publishDraft=async item=>{if(item.slot===3)throw Error('sensitive API response');return orig(item)};
 const res=await publishPreparedFiveWorkerWave({wave:wave(5),...p});
 assert.equal(res.status,'PARTIAL');
 assert.equal(res.results[2].status,'UNKNOWN');
 assert.equal(res.results[2].reason,'PUBLISH_OUTCOME_UNKNOWN_NO_REPLAY');
 assert.equal(p.stats.publications,4);
 assert.equal(p.durable.size,4);
 assert(!JSON.stringify(res).includes('sensitive API response'));
});

test('no native host ports means no side effects',async()=>{
 const res=await publishPreparedFiveWorkerWave({wave:wave(5)});
 assert.equal(res.status,'BLOCKED');assert.equal(res.results.length,0);
});

test('fake grant, fake PR, and unverified GitHub do not become receipts',async()=>{
 let called=0;
 const p=ports();p.authorizePublication=async()=>({approved:true,baseSha:SHA});
 p.publishDraft=async()=>{called++;return draft(item(1))};
 const blocked=await publishPreparedFiveWorkerWave({wave:wave(1),...p});
 assert.equal(blocked.results[0].status,'BLOCKED');assert.equal(called,0);
 const q=ports();q.publishDraft=async item=>({...draft(item),draft:false});
 const notPr=await publishPreparedFiveWorkerWave({wave:wave(1),...q});
 assert.equal(notPr.results[0].status,'UNKNOWN');assert.equal(q.durable.size,0);
 const v=ports();v.verifyDraft=async()=>false;
 const noRead=await publishPreparedFiveWorkerWave({wave:wave(1),...v});
 assert.equal(noRead.results[0].reason,'GITHUB_DRAFT_NOT_VERIFIED_NO_REPLAY');
 assert.equal(v.durable.size,0);
});

test('receipt write uncertainty cannot be called verified',async()=>{
 const p=ports();p.appendReceipt=async()=>false;
 const res=await publishPreparedFiveWorkerWave({wave:wave(1),...p});
 assert.equal(res.results[0].status,'UNKNOWN');
 assert.equal(res.results[0].reason,'DURABLE_RECEIPT_WRITE_UNKNOWN_NO_REPLAY');
});

test('verified recovery uses independently read, original durable receipts after a new invocation',async()=>{
 const p=ports();const output=await publishPreparedFiveWorkerWave({wave:wave(5),...p});
 const readReceipt=async item=>p.durable.get(item.taskId)??null;
 const verifyRestartWitness=async()=>({verified:true,previousInvocationId:'previous-invocation-01',
   currentInvocationId:'new-invocation-02'});
 const recovered=await verifyFiveWorkerAfterRestart({published:output,readReceipt,
   verifyRestartWitness,verifyRecordedDraft:async()=>true});
 assert.equal(recovered.status,'RESTART_VERIFIED');
 assert.equal(recovered.results.length,5);
 p.durable.delete('worker-4');
 const broken=await verifyFiveWorkerAfterRestart({published:output,readReceipt,
   verifyRestartWitness,verifyRecordedDraft:async()=>true});
 assert.equal(broken.status,'PARTIAL');assert.equal(broken.results[3].status,'UNKNOWN');
});

test('bad identity and duplicate task never enter publish',async()=>{
 const p=ports(),w=wave(2);
 w.results[1].taskId=w.results[0].taskId;
 await assert.rejects(publishPreparedFiveWorkerWave({wave:w,...p}),/FIVE_WORKER_PUBLISH_TASK_SCOPE_INVALID/);
 assert.equal(p.stats.publications,0);
});

test('a blocked preparation does not enter Publisher',async()=>{
 const p=ports(),w=wave(5);
 w.status='PARTIAL';w.results[2].status='UNKNOWN';
 const res=await publishPreparedFiveWorkerWave({wave:w,...p});
 assert.equal(res.status,'PARTIAL');assert.equal(res.results[2].status,'BLOCKED');
 assert.equal(p.stats.publications,4);
});

test('same process invocation is NOT restart evidence',async()=>{
 const p=ports(),out=await publishPreparedFiveWorkerWave({wave:wave(1),...p});
 const result=await verifyFiveWorkerAfterRestart({published:out,readReceipt:p.readReceipt,
   verifyRecordedDraft:async()=>true,verifyRestartWitness:async()=>({verified:true,
      previousInvocationId:'unchanged-invocation-01',currentInvocationId:'unchanged-invocation-01'})});
 assert.equal(result.status,'BLOCKED');
 assert.equal(result.reason,'REAL_SERVICE_RESTART_WITNESS_REQUIRED');
});
