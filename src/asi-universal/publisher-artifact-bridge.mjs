/** Source-only product-neutral bridge from five prepared workspaces to ONE
 * existing Publisher. Does not call GitHub, mint admission, charge a model,
 * mutate a ledger or instantiate a worker/service.
 * The native host must authenticate the catalog and artifact/claim readback.
 * A candidate is never permission to publish.
 */
import {createHash} from 'node:crypto';
const H40=/^[0-9a-f]{40}$/;
const H64=/^[0-9a-f]{64}$/;
const ID=/^[a-z][a-z0-9-]{0,79}$/;
const pathSafe=p=>typeof p==='string'&&p.length<=256&&
  /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*\.(?:mjs|js|json|py)$/.test(p)&&
  p.split('/').every(x=>x!=='.'&&x!=='..'&&x!=='.git');
const hash=s=>createHash('sha256').update(s).digest('hex');
const denied=reason=>Object.freeze({status:'BLOCKED',reason,authorized:false,
  candidates:Object.freeze([]),publisherConcurrency:1});
const frozenCandidate=c=>Object.freeze({...c,changes:Object.freeze(c.changes.map(x=>Object.freeze(x)))});

export async function compileUniversalPublisherCandidates({wave,preparation,
  signedCatalog,readArtifact,verifyClaim}={}){
  if(!wave||!['PLANNED','PARTIAL'].includes(wave.status)||
     wave.authority!==null||wave.executable!==false||wave.publisherConcurrency!==1||
     !Array.isArray(wave.slots)||wave.slots.length<1||wave.slots.length>5||
     !preparation||!['PREPARED','PARTIAL'].includes(preparation.status)||
     preparation.publisherReady!==false||!Array.isArray(preparation.results)||
     !Array.isArray(signedCatalog)||signedCatalog.length<1||signedCatalog.length>100||
     typeof readArtifact!=='function'||typeof verifyClaim!=='function')
    return denied('NATIVE_PUBLISHER_HANDOFF_PORTS_REQUIRED');
  // Native host MUST verify the signature and exact catalog version separately.
  // The candidate scope here is a second independent byte/path check.
  const catalog=new Map(),items=[];
  for(const t of signedCatalog){
    if(!t||!ID.test(t.id)||!ID.test(t.product)||!H40.test(t.baseSha)||
       typeof t.repository!=='string'||typeof t.stage!=='string'||
       !Array.isArray(t.files)||t.files.length<1||t.files.length>3||
       t.files.some(f=>!f||!pathSafe(f.path)||
         !(f.beforeSha256===null||H64.test(f.beforeSha256)))||
       new Set(t.files.map(f=>f.path)).size!==t.files.length||catalog.has(t.id))
      return denied('SIGNED_CATALOG_SHAPE_UNVERIFIED');
    catalog.set(t.id,t);
  }
  const resultBySlot=new Map();
  for(const r of preparation.results){
    if(!r||!Number.isInteger(r.slot)||r.slot<1||r.slot>5||
       resultBySlot.has(r.slot))return denied('PREPARATION_RESULT_IDENTITY');
    resultBySlot.set(r.slot,r);
  }
  const used=new Set();
  for(const slot of wave.slots){
    if(!slot||!Number.isInteger(slot.slot)||slot.slot<1||slot.slot>5||
       slot.authority!==null||slot.executable!==false||
       !ID.test(slot.product)||!ID.test(slot.task?.id)||!H40.test(slot.head)||
       used.has(slot.task.id))return denied('WORK_SLOT_SCOPE_UNVERIFIED');
    used.add(slot.task.id);
    const prep=resultBySlot.get(slot.slot);
    if(!prep||prep.status!=='PREPARED')continue;
    const t=catalog.get(slot.task.id);
    if(!t||t.product!==slot.product||t.repository!==slot.repository||
       t.baseSha!==slot.head||t.stage!==slot.task.stage||
       JSON.stringify(t.files.map(f=>f.path))!==JSON.stringify(slot.task.paths)||
       prep.taskId!==t.id||prep.product!==t.product||!H64.test(prep.artifactSha256))
      return denied('WORKSPACE_AND_SIGNED_CATALOG_CHANGED');
    let verified=false;
    try{verified=await verifyClaim(Object.freeze({
      taskId:t.id,product:t.product,repository:t.repository,
      baseSha:t.baseSha,artifactSha256:prep.artifactSha256
    }))===true;}catch{}
    if(!verified)return denied('NATIVE_PREPARATION_CLAIM_UNVERIFIED');
    let artifact;
    try{artifact=await readArtifact(Object.freeze({
      taskId:t.id,product:t.product,artifactSha256:prep.artifactSha256
    }));}catch{return denied('WORKSPACE_ARTIFACT_UNKNOWN_NO_REPLAY');}
    if(!artifact||artifact.taskId!==t.id||artifact.product!==t.product||
       !Array.isArray(artifact.changes)||artifact.changes.length!==t.files.length)
      return denied('ARTIFACT_IDENTITY_UNVERIFIED');
    const changes=[];
    for(let i=0;i<t.files.length;i++){
      const expected=t.files[i],change=artifact.changes[i];
      if(!change||change.path!==expected.path||
         change.beforeSha256!==expected.beforeSha256||
         typeof change.content!=='string'||change.content.length<1||
         Buffer.byteLength(change.content)>128000||change.content.includes('\0'))
        return denied('ARTIFACT_SCOPE_CHANGED');
      changes.push({path:change.path,beforeSha256:change.beforeSha256,
        afterSha256:hash(change.content),content:change.content});
    }
    const digest=hash(JSON.stringify({taskId:t.id,product:t.product,
      repository:t.repository,baseSha:t.baseSha,changes:changes.map(c=>({
        path:c.path,beforeSha256:c.beforeSha256,content:c.content,afterSha256:c.afterSha256
      }))}));
    if(digest!==prep.artifactSha256)return denied('ARTIFACT_HASH_NOT_BOUND');
    items.push(frozenCandidate({schema:'asi.universal-publisher-candidate.v1',
      status:'SOURCE_CANDIDATE',authorized:false,id:t.id,product:t.product,
      repo:t.repository,sha:t.baseSha,stage:t.stage,kind:'github-publisher',
      pr:null,changes,artifactSha256:digest}));
  }
  return Object.freeze({status:items.length?'SOURCE_CANDIDATES_READY':'WAITING',
    reason:'REQUIRES_EXISTING_SIGNED_NATIVE_PUBLISHER_ADMISSION',
    authorized:false,publisherConcurrency:1,candidates:Object.freeze(items)});
}
