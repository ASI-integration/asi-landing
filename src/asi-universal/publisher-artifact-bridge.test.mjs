import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {compileUniversalPublisherCandidates} from './publisher-artifact-bridge.mjs';
const H='a'.repeat(40),h=s=>createHash('sha256').update(s).digest('hex');
const file=n=>({path:'src/asi-universal/example-'+n+'.mjs',beforeSha256:null});
const task=n=>({id:'task-'+n,product:'product-'+n,repository:'ASI-integration/asi-landing',
  stage:'S4-G2',baseSha:H,files:[file(n)]});
const slot=n=>({slot:n,product:'product-'+n,repository:'ASI-integration/asi-landing',
  head:H,executable:false,authority:null,
  task:{id:'task-'+n,stage:'S4-G2',paths:[file(n).path]}});
const make=(count=5)=>{
 const signedCatalog=Array.from({length:count},(_,i)=>task(i+1));
 const slots=Array.from({length:count},(_,i)=>slot(i+1));
 const artifacts=signedCatalog.map(t=>{
   const changes=[{...t.files[0],content:'export const answer='+t.id.length+';\n'}];
   const digest=h(JSON.stringify({taskId:t.id,product:t.product,
     repository:t.repository,baseSha:t.baseSha,
     changes:changes.map(c=>({path:c.path,beforeSha256:c.beforeSha256,
       content:c.content,afterSha256:h(c.content)}))}));
   return {taskId:t.id,product:t.product,changes,artifactSha256:digest};
 });
 const wave={status:'PLANNED',authority:null,executable:false,publisherConcurrency:1,slots};
 const preparation={status:'PREPARED',publisherReady:false,
   results:artifacts.map((a,i)=>({slot:i+1,taskId:a.taskId,product:a.product,
     status:'PREPARED',artifactSha256:a.artifactSha256}))};
 return {wave,preparation,signedCatalog,artifacts};
};
const reader=f=>async({taskId})=>f.artifacts.find(x=>x.taskId===taskId);
const verifyClaim=async()=>true; // Native-reader fixture only, not a live proof.
test('five source artifacts yield five candidates for ONE Publisher with no writes',async()=>{
 const f=make(5),r=await compileUniversalPublisherCandidates({
   ...f,readArtifact:reader(f),verifyClaim});
 assert.equal(r.status,'SOURCE_CANDIDATES_READY');assert.equal(r.candidates.length,5);
 assert.equal(r.publisherConcurrency,1);assert.equal(r.authorized,false);
 assert(r.candidates.every(x=>x.kind==='github-publisher'&&x.pr===null&&x.authorized===false));
});
test('missing native claim reader blocks before any Publisher candidate',async()=>{
 const f=make(1),r=await compileUniversalPublisherCandidates({...f,readArtifact:reader(f)});
 assert.equal(r.status,'BLOCKED');assert.equal(r.candidates.length,0);
});
test('wrong product repository cannot be promoted from workspace to publisher',async()=>{
 const f=make(1);f.signedCatalog[0].repository='other/repo';
 const r=await compileUniversalPublisherCandidates({...f,readArtifact:reader(f),verifyClaim});
 assert.equal(r.reason,'WORKSPACE_AND_SIGNED_CATALOG_CHANGED');
});
test('altered source bytes are rejected against pinned artifact digest',async()=>{
 const f=make(1);f.artifacts[0].changes[0].content='malicious mutation';
 const r=await compileUniversalPublisherCandidates({...f,readArtifact:reader(f),verifyClaim});
 assert.equal(r.reason,'ARTIFACT_HASH_NOT_BOUND');
});
test('AI output cannot insert an extra source file after admission',async()=>{
 const f=make(1);f.artifacts[0].changes.push({...f.artifacts[0].changes[0],
   path:'src/other.mjs'});
 const r=await compileUniversalPublisherCandidates({...f,readArtifact:reader(f),verifyClaim});
 assert.equal(r.reason,'ARTIFACT_IDENTITY_UNVERIFIED');
});
test('UNKNOWN worker is not treated as a publishable result',async()=>{
 const f=make(2);f.preparation.status='PARTIAL';f.preparation.results[0].status='UNKNOWN';
 const r=await compileUniversalPublisherCandidates({...f,readArtifact:reader(f),verifyClaim});
 assert.equal(r.candidates.length,1);assert.equal(r.candidates[0].id,'task-2');
});
test('rejected native claim never reaches Publisher',async()=>{
 const f=make(1),r=await compileUniversalPublisherCandidates({...f,
   readArtifact:reader(f),verifyClaim:async()=>false});
 assert.equal(r.reason,'NATIVE_PREPARATION_CLAIM_UNVERIFIED');
});
