import test from 'node:test';
import assert from 'node:assert/strict';
import {runNativeFiveWorkerCycle} from './native-five-worker-cycle.mjs';

const BASE='a'.repeat(40),DIGEST='b'.repeat(64),HEAD='c'.repeat(40);
const repo='ASI-integration/asi-landing';
const planned=i=>({status:'READY',selected:{product:'product-'+i,repository:repo,
  head:BASE,task:{id:'task-'+i,stage:'S4-G2',operation:'prepare-source',
  tool:'existing-runner-bridge',paths:['scripts/example.mjs']},
  executable:false,authority:null}});
const fixture=()=>{
  let picked=0,preps=0,activePublish=0,maxPublished=0;
  const recorded=new Map();
  const hostPorts={
    admit:async x=>({verified:true,taskId:x.taskId,product:x.product,head:x.head,
      workspaceKey:'workspace-'+x.slot,claimId:'claim-'+x.slot}),
    verifyAdmission:async()=>true,
    prepare:async (x,a)=>{preps++;return {status:'PREPARED',taskId:x.taskId,
      product:x.product,head:x.head,workspaceKey:a.workspaceKey,artifactSha256:DIGEST}},
    authorizePublication:async x=>({approved:true,taskId:x.taskId,artifactSha256:x.artifactSha256,
      baseSha:x.baseSha,repository:x.repository}),
    publishDraft:async x=>{activePublish++;maxPublished=Math.max(maxPublished,activePublish);
      await Promise.resolve();activePublish--;
      return {draft:true,number:x.slot,taskId:x.taskId,repository:x.repository,
        baseSha:x.baseSha,headSha:HEAD,url:'https://github.com/'+repo+'/pull/'+x.slot}},
    verifyDraft:async()=>true,
    appendReceipt:async (x,r)=>{recorded.set(x.taskId,r);return true},
    readReceipt:async x=>recorded.get(x.taskId)??null
  };
  return {hostPorts,recorded,get stats(){return {picked,preps,maxPublished}},
    dispatcher:{async plan(){picked++;return picked<=5?planned(picked):{status:'WAITING',selected:null}}}};
};

test('one engine cycle connects five planned tasks to five durable Draft PR receipts',async()=>{
  const f=fixture();const r=await runNativeFiveWorkerCycle({dispatcher:f.dispatcher,
    snapshots:{},hostPorts:f.hostPorts});
  assert.equal(r.status,'WAVE_RECEIPTS_VERIFIED');
  assert.equal(r.verifiedReceipts,5);assert.equal(f.stats.preps,5);
  assert.equal(f.stats.maxPublished,1);assert.equal(f.recorded.size,5);
});
test('missing native host ports never start paid work or publication',async()=>{
  const f=fixture();const r=await runNativeFiveWorkerCycle({dispatcher:f.dispatcher,snapshots:{}});
  assert.equal(r.status,'BLOCKED');assert.equal(r.phase,'ADMISSION');
  assert.equal(f.stats.preps,0);assert.equal(f.recorded.size,0);
});
test('failed planning never reaches native host ports',async()=>{
  const f=fixture();f.dispatcher.plan=async()=>({status:'FAILED_LOCKED',selected:null});
  const r=await runNativeFiveWorkerCycle({dispatcher:f.dispatcher,
    snapshots:{},hostPorts:f.hostPorts});
  assert.equal(r.status,'WAITING');assert.equal(r.verifiedReceipts,0);
  assert.equal(f.stats.preps,0);
});
