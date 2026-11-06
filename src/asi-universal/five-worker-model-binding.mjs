/** Source-only binding to the EXISTING signed WD Responses producer.
 * Never creates a model, queue, publisher, credential, ledger or permission.
 * Native host ports must independently verify catalog, workspace and artifact
 * after each irreversible reservation; UNKNOWN work is never replayed here.
 */
import {createHash} from 'node:crypto';

const ID=/^[a-z][a-z0-9-]{0,79}$/;
const SHA40=/^[a-f0-9]{40}$/;
const SHA64=/^[a-f0-9]{64}$/;
const REPO=/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const FILE=/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*\.(?:mjs|js|json|py)$/;
const safeFile=p=>typeof p==='string'&&p.length<=256&&FILE.test(p)&&
  p.split('/').every(x=>x!=='.'&&x!=='..'&&x.toLowerCase()!=='.git');
const h=s=>createHash('sha256').update(s).digest('hex');
const deny=reason=>Object.freeze({status:'BLOCKED',reason,authorized:false});
const own=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const freeze=x=>Object.freeze(x);

function boundTask(slot,catalog,supportedRepositories){
  if(!own(slot)||!own(slot.task)||slot.executable!==false||slot.authority!==null||
     typeof slot.product!=='string'||!ID.test(slot.product)||
     typeof slot.task.id!=='string'||!ID.test(slot.task.id)||
     typeof slot.head!=='string'||!SHA40.test(slot.head)||
     typeof slot.repository!=='string'||!REPO.test(slot.repository)||
     !Array.isArray(slot.task.paths)||slot.task.paths.length<1||
     slot.task.paths.length>3||!slot.task.paths.every(safeFile)||
     !Array.isArray(catalog)||catalog.length<1||catalog.length>100||
     !Array.isArray(supportedRepositories)||supportedRepositories.length<1||
     !supportedRepositories.includes(slot.repository))
    return null;
  const matches=catalog.filter(t=>own(t)&&t.id===slot.task.id&&
    t.product===slot.product&&t.repository===slot.repository&&
    t.baseSha===slot.head&&t.stage===slot.task.stage);
  if(matches.length!==1)return null;
  const t=matches[0];
  if(typeof t.branch!=='string'||!/^[A-Za-z0-9][A-Za-z0-9/_-]{0,149}$/.test(t.branch)||
     typeof t.laneId!=='string'||!ID.test(t.laneId)||
     typeof t.objective!=='string'||t.objective.length<1||t.objective.length>2400||
     !Array.isArray(t.files)||t.files.length!==slot.task.paths.length||
     !t.files.every((f,i)=>own(f)&&f.path===slot.task.paths[i]&&
       safeFile(f.path)&&(f.beforeSha256===null||
         typeof f.beforeSha256==='string'&&SHA64.test(f.beforeSha256)))||
     new Set(t.files.map(f=>f.path)).size!==t.files.length)
    return null;
  return freeze({id:t.id,laneId:t.laneId,baseSha:t.baseSha,
    repository:t.repository,branch:t.branch,objective:t.objective,
    paths:freeze(t.files.map(f=>f.path))});
}

/** Call once per durable host-admitted slot. The existing producer must
 * execute its OWN native paid reservation before any model egress. This
 * adapter does not grant a model budget, and cannot retry any unknown result.
 */
export async function prepareFiveWorkerModelArtifact({
  slot,workspaceKey,signedCatalog,supportedRepositories,
  verifySignedCatalog,produce,saveArtifact,verifyArtifact
}={}){
  if(typeof workspaceKey!=='string'||!ID.test(workspaceKey)||
     typeof verifySignedCatalog!=='function'||typeof produce!=='function'||
     typeof saveArtifact!=='function'||typeof verifyArtifact!=='function')
    return deny('SIGNED_NATIVE_MODEL_PORTS_REQUIRED');
  const task=boundTask(slot,signedCatalog,supportedRepositories);
  if(!task)return deny('SIGNED_MODEL_TASK_SCOPE_INVALID');
  const pin=freeze({taskId:task.id,product:slot.product,
    repository:task.repository,baseSha:task.baseSha,workspaceKey});
  const signedTask=signedCatalog.find(t=>t.id===task.id&&t.product===slot.product);
  const signedFingerprint=h(JSON.stringify(signedTask));
  const pinnedFiles=freeze(signedTask.files.map(f=>freeze({
    path:f.path,beforeSha256:f.beforeSha256
  })));
  let admitted=false;
  try{admitted=await verifySignedCatalog(freeze({pin,task}))===true;}catch{}
  if(!admitted)return deny('SIGNED_NATIVE_MODEL_CATALOG_UNVERIFIED');
  let proposal;
  try{proposal=await produce(task);}
  catch{return deny('MODEL_OUTCOME_UNKNOWN_NO_REPLAY');}
  if(!proposal||proposal.status!=='PROPOSED'||!Array.isArray(proposal.changes)||
     proposal.changes.length!==task.paths.length)
    return deny('MODEL_PROPOSAL_UNVERIFIED_NO_REPLAY');
  // After a possibly paid model call, source scope must remain unchanged.
  const current=signedCatalog.find(t=>t.id===task.id&&t.product===slot.product);
  if(!current||h(JSON.stringify(current))!==signedFingerprint)
    return deny('SIGNED_CATALOG_CHANGED_AFTER_MODEL_NO_REPLAY');
  let stillSigned=false;
  try{stillSigned=await verifySignedCatalog(freeze({pin,task}))===true;}catch{}
  if(!stillSigned)return deny('SIGNED_CATALOG_CHANGED_AFTER_MODEL_NO_REPLAY');
  const changes=[];
  for(let i=0;i<proposal.changes.length;i++){
    const c=proposal.changes[i],expected=pinnedFiles[i];
    if(!own(c)||c.path!==expected.path||
       c.beforeSha256!==expected.beforeSha256||
       typeof c.content!=='string'||c.content.length<1||
       Buffer.byteLength(c.content)>128000||c.content.includes('\0'))
      return deny('MODEL_PROPOSAL_SCOPE_CHANGED_NO_REPLAY');
    changes.push(freeze({path:c.path,beforeSha256:c.beforeSha256,
      content:c.content,afterSha256:h(c.content)}));
  }
  const artifactSha256=h(JSON.stringify({taskId:task.id,product:slot.product,
    repository:task.repository,baseSha:task.baseSha,changes}));
  const artifact=freeze({...pin,artifactSha256,
    changes:freeze(changes)});
  // Native host persists exact source bytes in its previously admitted
  // workspace, then independently reads the artifact back under its ledger.
  try{if(await saveArtifact(artifact)!==true)
    return deny('MODEL_ARTIFACT_WRITE_UNKNOWN_NO_REPLAY');}
  catch{return deny('MODEL_ARTIFACT_WRITE_UNKNOWN_NO_REPLAY');}
  let verified=false;
  try{verified=await verifyArtifact(artifact)===true;}catch{}
  if(!verified)return deny('MODEL_ARTIFACT_READBACK_UNKNOWN_NO_REPLAY');
  return freeze({status:'PREPARED',taskId:task.id,product:slot.product,
    repository:task.repository,head:task.baseSha,workspaceKey,artifactSha256,
    authorized:false,publisherReady:false});
}
