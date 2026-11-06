import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {prepareFiveWorkerModelArtifact} from './five-worker-model-binding.mjs';

const BASE='a'.repeat(40),digest=s=>createHash('sha256').update(s).digest('hex');
const product='asi-cabins',repo='ASI-integration/asi-landing';
const task={id:'work-a',product,repository:repo,baseSha:BASE,
  stage:'S4-G2',branch:'feat/cabin-test',laneId:'builder',
  objective:'Update one approved source file after signed model reservation.',
  files:[{path:'src/asi-universal/cabins.mjs',beforeSha256:null}]};
const slot=()=>({slot:1,product,repository:repo,head:BASE,
  executable:false,authority:null,
  task:{id:task.id,stage:task.stage,paths:[task.files[0].path]}});
const proposal=()=>({status:'PROPOSED',changes:[{path:task.files[0].path,
  beforeSha256:null,content:'export const ready=true;\n'}]});
const config=()=>({slot:slot(),workspaceKey:'workspace-one',
  signedCatalog:[structuredClone(task)],supportedRepositories:[repo],
  verifySignedCatalog:async()=>true,produce:async()=>proposal(),
  saveArtifact:async()=>true,verifyArtifact:async()=>true});

test('binds existing paid-model task exactly and saves proven artifact',async()=>{
 const c=config();let calls=0,checks=0,saved;
 c.verifySignedCatalog=async()=>{checks++;return true};
 c.produce=async job=>{
   calls++;assert.deepEqual(Object.keys(job).sort(),
     ['baseSha','branch','id','laneId','objective','paths','repository'].sort());
   assert.equal(job.branch,'feat/cabin-test');assert.equal(job.id,task.id);
   assert.equal(job.repository,repo);return proposal();
 };
 c.saveArtifact=async value=>{saved=value;return true};
 c.verifyArtifact=async value=>{
   assert.strictEqual(value,saved);return true;
 };
 const r=await prepareFiveWorkerModelArtifact(c);
 assert.equal(r.status,'PREPARED');assert.equal(r.authorized,false);
 assert.equal(r.publisherReady,false);assert.equal(calls,1);assert.equal(checks,2);
 assert.equal(r.artifactSha256,saved.artifactSha256);
 assert.equal(saved.changes[0].afterSha256,digest(saved.changes[0].content));
 assert(Object.isFrozen(saved));assert(Object.isFrozen(saved.changes));
});
test('missing signed native ports never calls the model',async()=>{
 const c=config();let called=0;
 c.verifySignedCatalog=undefined;c.produce=async()=>{called++;return proposal()};
 const r=await prepareFiveWorkerModelArtifact(c);
 assert.equal(r.reason,'SIGNED_NATIVE_MODEL_PORTS_REQUIRED');
 assert.equal(called,0);
});
test('unsupported product repository cannot enter the current pinned provider',async()=>{
 const c=config();let called=0;
 c.supportedRepositories=['another-org/another-repo'];
 c.produce=async()=>{called++;return proposal()};
 assert.equal((await prepareFiveWorkerModelArtifact(c)).reason,'SIGNED_MODEL_TASK_SCOPE_INVALID');
 assert.equal(called,0);
});
test('signed catalog mismatch never consumes a model call',async()=>{
 const c=config();let called=0;
 c.signedCatalog[0].baseSha='b'.repeat(40);
 c.produce=async()=>{called++;return proposal()};
 assert.equal((await prepareFiveWorkerModelArtifact(c)).reason,'SIGNED_MODEL_TASK_SCOPE_INVALID');
 assert.equal(called,0);
});
test('after a possible paid call, changed catalog cannot persist an artifact',async()=>{
 const c=config();let saved=0;
 c.produce=async()=>{c.signedCatalog[0].objective='changed while in flight';return proposal()};
 c.saveArtifact=async()=>{saved++;return true};
 assert.equal((await prepareFiveWorkerModelArtifact(c)).reason,
   'SIGNED_CATALOG_CHANGED_AFTER_MODEL_NO_REPLAY');
 assert.equal(saved,0);
});
test('unknown provider outcome is not replayed or written to storage',async()=>{
 const c=config();let calls=0,saved=0;
 c.produce=async()=>{calls++;throw Error('sk-secret')};
 c.saveArtifact=async()=>{saved++;return true};
 const r=await prepareFiveWorkerModelArtifact(c);
 assert.equal(calls,1);assert.equal(saved,0);
 assert.equal(r.reason,'MODEL_OUTCOME_UNKNOWN_NO_REPLAY');
 assert(!JSON.stringify(r).includes('sk-secret'));
});
test('modified path or before-hash from model is rejected without writing',async()=>{
 for(const modified of [
   {path:'src/asi-universal/other.mjs',beforeSha256:null,content:'bad'},
   {path:task.files[0].path,beforeSha256:'b'.repeat(64),content:'bad'},
 ]){
  const c=config();let saves=0;
  c.produce=async()=>({status:'PROPOSED',changes:[modified]});
  c.saveArtifact=async()=>{saves++;return true};
  assert.equal((await prepareFiveWorkerModelArtifact(c)).reason,
    'MODEL_PROPOSAL_SCOPE_CHANGED_NO_REPLAY');
  assert.equal(saves,0);
 }
});
test('uncertain artifact persistence and failed native readback never become prepared',async()=>{
 const c=config();c.saveArtifact=async()=>{throw Error('private disk path')};
 const r=await prepareFiveWorkerModelArtifact(c);
 assert.equal(r.reason,'MODEL_ARTIFACT_WRITE_UNKNOWN_NO_REPLAY');
 assert(!JSON.stringify(r).includes('private disk path'));
 const c2=config();c2.verifyArtifact=async()=>false;
 assert.equal((await prepareFiveWorkerModelArtifact(c2)).reason,
   'MODEL_ARTIFACT_READBACK_UNKNOWN_NO_REPLAY');
});
test('second post-model catalog readback cannot be replaced by an approval string',async()=>{
 const c=config();let visits=0,saves=0;
 c.verifySignedCatalog=async()=>++visits===1;
 c.saveArtifact=async()=>{saves++;return true};
 assert.equal((await prepareFiveWorkerModelArtifact(c)).reason,
   'SIGNED_CATALOG_CHANGED_AFTER_MODEL_NO_REPLAY');
 assert.equal(saves,0);
});
