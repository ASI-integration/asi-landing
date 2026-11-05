import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {prepareAdmittedFiveWorkerWave} from './five-worker-preparation.mjs';
import {prepareFiveWorkerModelArtifact} from './five-worker-model-binding.mjs';
import {serializeNativeModelReservations} from './serial-native-model-reservations.mjs';
import {compileUniversalPublisherCandidates} from './publisher-artifact-bridge.mjs';
import {handoffToSingleNativePublisher} from './five-worker-publisher-bridge.mjs';

const BASE='a'.repeat(40),PR_HEAD='c'.repeat(40);
const digest=s=>createHash('sha256').update(s).digest('hex');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const repo='ASI-integration/asi-landing';
const products=['cabins','strigunov','guest-comms','pricing','marketing'];
const roles=['planner','builder','tester','reviewer','integrator'];
const slots=products.map((product,index)=>({
 slot:index+1,product,repository:repo,head:BASE,
 executable:false,authority:null,task:{
   id:'job-'+(index+1),stage:'S4-G2',operation:'prepare-source',
   tool:'existing-runner-bridge',
   paths:['src/asi-universal/fixture-'+(index+1)+'.mjs']
 }
}));
const catalog=slots.map((s,i)=>({
 id:s.task.id,product:s.product,repository:repo,baseSha:BASE,
 stage:'S4-G2',branch:'asi/source-'+(i+1),laneId:roles[i],
 objective:'Prepare one small approved source file.',files:[
   {path:s.task.paths[0],beforeSha256:null}
 ]
}));
const wave=Object.freeze({status:'PLANNED',authority:null,
 executable:false,publisherConcurrency:1,slots});

test('five model-source proposals overlap after serial native budget claims; one Publisher',async()=>{
 const artifacts=new Map();let activeReservations=0,maxReservations=0;
 let activeModels=0,maxModels=0,paidClaims=0;
 const reserve=serializeNativeModelReservations(async req=>{
   activeReservations++;maxReservations=Math.max(maxReservations,activeReservations);
   paidClaims++;await sleep(5);activeReservations--;
   return {authorized:true,...req,operationId:'model-'+req.taskId};
 });
 const admit=async id=>({
   verified:true,taskId:id.taskId,product:id.product,head:id.head,
   workspaceKey:'workspace-'+id.slot,claimId:'claim-'+id.slot,
   token:'offline-fixture-only'
 });
 const preparation=await prepareAdmittedFiveWorkerWave({
   wave,admit,verifyAdmission:async()=>true,preparationTimeoutMs:5000,
   prepare:async(id,{workspaceKey})=>{
     const slot=slots[id.slot-1];
     return prepareFiveWorkerModelArtifact({
       slot,workspaceKey,signedCatalog:catalog,supportedRepositories:[repo],
       verifySignedCatalog:async()=>true,
       produce:async task=>{
         await reserve({taskId:task.id,baseSha:task.baseSha,model:'gpt-4.1-mini',
           maxOutputTokens:1024,pathDigest:digest(JSON.stringify(task))});
         activeModels++;maxModels=Math.max(maxModels,activeModels);
         await sleep(80);activeModels--;
         return {status:'PROPOSED',changes:[{
           path:task.paths[0],beforeSha256:null,
           content:'export const value='+task.id.length+';\n'
         }]};
       },
       saveArtifact:async a=>{artifacts.set(a.taskId,a);return true},
       verifyArtifact:async a=>artifacts.get(a.taskId)===a
     });
   }
 });
 assert.equal(preparation.status,'PREPARED');
 assert.equal(preparation.results.length,5);
 assert.equal(paidClaims,5);assert.equal(maxReservations,1);
 assert.equal(maxModels,5);

 const candidates=await compileUniversalPublisherCandidates({
   wave,preparation,signedCatalog:catalog,
   verifyClaim:async()=>true,
   readArtifact:async({taskId})=>artifacts.get(taskId)
 });
 assert.equal(candidates.status,'SOURCE_CANDIDATES_READY');
 assert.equal(candidates.candidates.length,5);
 assert(candidates.candidates.every(x=>x.authorized===false));
 assert.equal(candidates.publisherConcurrency,1);
 const candidateById=new Map(candidates.candidates.map(x=>[x.id,x]));
 let activePublisher=0,maxPublisher=0,published=0;
 const outcome=await handoffToSingleNativePublisher({
   preparation,
   verifyPrepared:async item=>candidateById.get(item.taskId)?.artifactSha256===
     item.artifactSha256,
   publishOne:async item=>{
     assert(candidateById.has(item.taskId));
     activePublisher++;maxPublisher=Math.max(maxPublisher,activePublisher);
     await sleep(4);activePublisher--;published++;
     return {status:'PUBLISHED',taskId:item.taskId,product:item.product,
       repository:item.repository,baseSha:item.baseSha,
       pr:100+published,head:PR_HEAD};
   },
   verifyReceipt:async(item,{pr,head})=>({
     status:'VERIFIED',taskId:item.taskId,product:item.product,
     repository:item.repository,baseSha:item.baseSha,pr,head
   })
 });
 assert.equal(published,5);assert.equal(maxPublisher,1);
 assert.equal(outcome.receiptCount,5);
 assert.equal(outcome.status,'VERIFIED');
});

test('one UNKNOWN paid model result cannot be retried or published, other four continue',async()=>{
 const artifacts=new Map();let claims=0;
 const reserve=serializeNativeModelReservations(async req=>{
   claims++;return {authorized:true,...req,operationId:'model-'+req.taskId};
 });
 const preparation=await prepareAdmittedFiveWorkerWave({
   wave,admit:async id=>({verified:true,taskId:id.taskId,product:id.product,
     head:id.head,workspaceKey:'workspace-'+id.slot,
     claimId:'claim-'+id.slot}),verifyAdmission:async()=>true,
   prepare:async(id,{workspaceKey})=>prepareFiveWorkerModelArtifact({
     slot:slots[id.slot-1],workspaceKey,signedCatalog:catalog,
     supportedRepositories:[repo],verifySignedCatalog:async()=>true,
     produce:async task=>{
       await reserve({taskId:task.id,baseSha:task.baseSha,model:'gpt-4.1-mini',
         maxOutputTokens:1024,pathDigest:digest(JSON.stringify(task))});
       if(task.id==='job-3')throw Error('unknown provider response secret');
       return {status:'PROPOSED',changes:[{path:task.paths[0],
         beforeSha256:null,content:'export const ok=true;\n'}]};
     },
     saveArtifact:async a=>{artifacts.set(a.taskId,a);return true},
     verifyArtifact:async a=>artifacts.get(a.taskId)===a
   })
 });
 assert.equal(claims,5);
 assert.equal(preparation.status,'PARTIAL');
 assert.equal(preparation.results[2].status,'UNKNOWN');
 const candidates=await compileUniversalPublisherCandidates({
   wave,preparation,signedCatalog:catalog,
   readArtifact:async({taskId})=>artifacts.get(taskId),verifyClaim:async()=>true
 });
 assert.equal(candidates.candidates.length,4);
 assert(!candidates.candidates.some(x=>x.id==='job-3'));
 assert(!JSON.stringify(preparation).includes('secret'));
});
