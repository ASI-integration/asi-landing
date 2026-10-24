// No signing key or owner grant is generated here. The operator installs a
// signed exact activation/catalog after approval; missing/revoked files stop use.
import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {verify,createPublicKey,createHash} from 'node:crypto';

export const ENGINE_ROOT='/home/project_ayfaar/asi-strigunov-agent/engine';
export const LEGACY_STATE='/home/project_ayfaar/asi-strigunov-agent/state';
export const AUTHORITY_DIR='/etc/asi-github-engine';
const admitted=new WeakMap();
const must=(ok,code)=>{if(!ok)throw Error(code);};
const hash=x=>createHash('sha256').update(x).digest('hex');
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const freeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}return x;};

export async function rootOwned(file,max=1000000,{secret=false}={}){
  must(path.isAbsolute(file)&&await fs.realpath(file)===file,'AUTHORITY_PATH');
  for(let dir=path.dirname(file);;dir=path.dirname(dir)){
    const st=await fs.lstat(dir);
    must(st.isDirectory()&&!st.isSymbolicLink()&&st.uid===0&&!(st.mode&0o022),'AUTHORITY_DIRECTORY');
    if(dir==='/')break;
  }
  const h=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{const st=await h.stat();must(st.isFile()&&st.uid===0&&st.nlink===1&&!(st.mode&0o022)&&
      (!secret||!(st.mode&0o007))&&st.size<=max,'AUTHORITY_FILE');
    return await h.readFile('utf8');}finally{await h.close();}
}

export function verifySignedArtifact(envelope,publicKey,now=Date.now()){
  must(envelope&&typeof envelope.payload==='string'&&envelope.payload.length<800000&&
    typeof envelope.signature==='string'&&/^[A-Za-z0-9+/]{86}==$/.test(envelope.signature),'SIGNED_ARTIFACT_SCHEMA');
  const key=createPublicKey(publicKey);must(key.asymmetricKeyType==='ed25519','OWNER_KEY_TYPE');
  must(verify(null,Buffer.from(envelope.payload),key,Buffer.from(envelope.signature,'base64')),'OWNER_SIGNATURE_INVALID');
  const p=JSON.parse(envelope.payload);
  must(p?.schema==='asi.engine-activation.v1'&&p.repo==='ASI-integration/asi-landing'&&
    p.root===ENGINE_ROOT&&p.legacyStateDir===LEGACY_STATE&&p.stage==='S4-G1'&&
    p.host==='asi-agent-runner'&&p.service==='asi-strigunov-agent.service'&&
    typeof p.ownerApprovalId==='string'&&p.ownerApprovalId.length>0&&p.ownerApprovalId.length<=500&&
    p.githubApp&&Number.isSafeInteger(p.githubApp.appId)&&p.githubApp.appId>0&&
    Number.isSafeInteger(p.githubApp.installationId)&&p.githubApp.installationId>0&&
    Array.isArray(p.ciPolicies)&&p.ciPolicies.length===2&&
    p.ciPolicies.filter(q=>q?.name==='validate'&&q.workflowId===311380800&&
      (q.event===undefined||q.event==='pull_request')).length===1&&
    p.ciPolicies.filter(q=>q?.name==='release_governance'&&q.workflowId===390653294&&q.event==='pull_request_target').length===1&&
    Number.isSafeInteger(p.notBefore)&&Number.isSafeInteger(p.expiresAt)&&p.notBefore<=now&&p.expiresAt>now&&
    /^[a-f0-9]{64}$/.test(p.runnerSha256)&&/^[a-f0-9]{64}$/.test(p.catalogSha256)&&
    /^[a-f0-9]{40}$/.test(p.baseSha)&&p.automaticCiApproved===true&&p.automaticReviewApproved===true,
    'ACTIVATION_SCOPE_OR_EXPIRY');
  return freeze(p);
}

export async function loadHostAuthority(){
  const key=await rootOwned(path.join(AUTHORITY_DIR,'owner-public.pem'),10000);
  const raw=await rootOwned(path.join(AUTHORITY_DIR,'activation.json'));
  const payload=verifySignedArtifact(JSON.parse(raw),key);
  const catalogRaw=await rootOwned(path.join(AUTHORITY_DIR,'catalog.json'));
  must(hash(catalogRaw)===payload.catalogSha256,'CATALOG_NOT_SIGNED');
  const catalog=verifyBoundedStageCatalog(catalogRaw,payload);
  const admission=Object.freeze({root:payload.root,legacyStateDir:payload.legacyStateDir});
  admitted.set(admission,payload);
  async function revalidate(){
    must(await rootOwned(path.join(AUTHORITY_DIR,'activation.json'))===raw,'ACTIVATION_REVOKED_OR_CHANGED');
    must(await rootOwned(path.join(AUTHORITY_DIR,'owner-public.pem'),10000)===key,'OWNER_KEY_CHANGED');
    must(await rootOwned(path.join(AUTHORITY_DIR,'catalog.json'))===catalogRaw,'CATALOG_CHANGED');
    verifySignedArtifact(JSON.parse(raw),key);
  }
  return Object.freeze({payload,catalog,admission,revalidate,async authorize(request){
    await revalidate();const task=catalog.find(t=>t.id===request.taskId);
    must(task&&request.taskBinding===hash(JSON.stringify(task))&&request.repo===payload.repo&&
      request.baseSha===payload.baseSha&&request.stage==='S4-G1'&&request.branch===task.branch&&
      equal(request.paths,task.changes.map(c=>c.path))&&equal(request.operations,
        ['create-tree','create-commit','create-branch','create-draft-pr']),'TASK_AUTHORITY_MISMATCH');
    return {approved:true,request,automaticCiApproved:true,automaticReviewApproved:true,
      operationId:'pilot-'+hash(raw+task.id).slice(0,48),expiresAt:payload.expiresAt};
  }});
}

export function assertLiveAdmission(admission,root,legacy){
  const p=admitted.get(admission);
  must(p&&p.expiresAt>Date.now()&&p.root===root&&(!legacy||p.legacyStateDir===legacy),'LIVE_ADMISSION_REQUIRED');
}

/** Existing single-task authorities remain valid. Multi-task execution is
 * opt-in ONLY via a new signed activation with an exact stageDelegation scope.
 * One signed bounded catalog can cover ordinary task cycles without any more
 * owner-key/password prompts. This grants NO additional GitHub permissions.
 */
export function verifyBoundedStageCatalog(catalogRaw,payload) {
  must(typeof catalogRaw==='string'&&hash(catalogRaw)===payload.catalogSha256,
    'CATALOG_NOT_SIGNED');
  const catalog=JSON.parse(catalogRaw);
  must(Array.isArray(catalog)&&catalog.length>=1&&catalog.length<=8,'STAGE_CATALOG_SIZE');
  if(catalog.length>1) {
    const d=payload.stageDelegation;
    must(d?.schema==='asi.engine-stage-catalog.v1'&&d.stage==='S4-G1'&&
      d.maximumTasks===catalog.length&&Array.isArray(d.workOrderIds)&&
      JSON.stringify(d.workOrderIds)===JSON.stringify(catalog.map(t=>t.workOrderId))&&
      d.noWorkflowWrite===true&&d.noMerge===true,'STAGE_DELEGATION_NOT_SIGNED');
  }
  must(new Set(catalog.map(t=>t.id)).size===catalog.length&&
    new Set(catalog.map(t=>t.branch)).size===catalog.length&&
    new Set(catalog.map(t=>t.workOrderId)).size===catalog.length,'STAGE_CATALOG_DUPLICATE');
  for(const t of catalog){
    must(typeof t?.id==='string'&&/^[a-z0-9][a-z0-9-]{3,79}$/.test(t.id)&&
      t.kind==='github-publisher'&&t.stage==='S4-G1'&&t.repo===payload.repo&&
      t.pr===null&&t.sha===payload.baseSha&&
      typeof t.branch==='string'&&/^asi\\/engine-task\\/[a-z0-9][a-z0-9-]{3,79}$/.test(t.branch)&&
      Array.isArray(t.changes)&&t.changes.length>=1&&t.changes.length<=3&&
      new Set(t.changes.map(c=>c.path)).size===t.changes.length&&
      t.changes.every(c=>typeof c?.path==='string'&&
        /^scripts\\/strigunov4\\/[a-zA-Z0-9][a-zA-Z0-9_./-]*\\.py$/.test(c.path)&&
        !c.path.includes('..')&&!c.path.includes('//')&&
        /^[a-f0-9]{64}$/.test(c.beforeSha256)&&typeof c.content==='string'),
      'STAGE_CATALOG_TASK_SCOPE');
  }
  return freeze(catalog);
}
