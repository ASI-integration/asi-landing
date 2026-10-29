// No signing key or owner grant is generated here. The operator installs a
// signed exact activation/catalog after approval; missing/revoked files stop use.
import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {verify,createPublicKey,createHash} from 'node:crypto';
import {validateStagePolicy} from './stage-authority.mjs';
import {decomposeProductGoal} from '../../global-dispatcher/product-adapters.mjs';

export const ENGINE_ROOT='/home/project_ayfaar/asi-strigunov-agent/engine';
export const LEGACY_STATE='/home/project_ayfaar/asi-strigunov-agent/state';
export const AUTHORITY_DIR='/etc/asi-github-engine';
const admitted=new WeakMap();
const must=(ok,code)=>{if(!ok)throw Error(code);};
const hash=x=>createHash('sha256').update(x).digest('hex');
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const freeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}return x;};

// Optional native-host wiring only. This does not admit a new host, stage,
// catalog or reviewer. The complete policy is covered by the owner signature.
export function validateHostLoop(payload,now=Date.now()){
  if(payload.closedLoop===undefined)return;
  const c=payload.closedLoop;
  must(c&&Object.keys(c).sort().join(',')==='intervalMs,maxTicks,policy,reviewMode'&&
    c.reviewMode==='coderabbit'&&Number.isSafeInteger(c.intervalMs)&&c.intervalMs>=600000&&c.intervalMs<=900000&&
    Number.isSafeInteger(c.maxTicks)&&c.maxTicks>=1&&c.maxTicks<=100,'HOST_LOOP_SCOPE');
  validateStagePolicy(c.policy,now);
  must(c.policy.baseSha===payload.baseSha&&c.policy.notBefore===payload.notBefore&&
    c.policy.expiresAt===payload.expiresAt,'HOST_LOOP_POLICY_BINDING');
}

export function validateHostRequest(payload,catalog,request){
  const task=catalog.find(t=>t.id===request.taskId);
  // A source-supplied review port must never inherit native CodeRabbit consent.
  must(!Object.hasOwn(request,'reviewPolicySha256'),'HOST_REVIEW_POLICY_NOT_ADMITTED');
  must(task&&request.taskBinding===hash(JSON.stringify(task))&&request.repo===payload.repo&&
    request.baseSha===payload.baseSha&&request.stage==='S4-G1'&&request.branch===task.branch&&
    equal(request.paths,task.changes.map(c=>c.path))&&equal(request.operations,
      ['create-tree','create-commit','create-branch','create-draft-pr']),'TASK_AUTHORITY_MISMATCH');
}

export async function rootOwned(file,max=1000000,{secret=false,encoding='utf8'}={}){
  must(path.isAbsolute(file)&&await fs.realpath(file)===file,'AUTHORITY_PATH');
  for(let dir=path.dirname(file);;dir=path.dirname(dir)){
    const st=await fs.lstat(dir);
    must(st.isDirectory()&&!st.isSymbolicLink()&&st.uid===0&&!(st.mode&0o022),'AUTHORITY_DIRECTORY');
    if(dir==='/')break;
  }
  const h=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{const st=await h.stat();must(st.isFile()&&st.uid===0&&st.nlink===1&&!(st.mode&0o022)&&
      (!secret||!(st.mode&0o007))&&st.size<=max,'AUTHORITY_FILE');
    return await h.readFile(encoding??undefined);}finally{await h.close();}
}

// Cryptographic primitive only; decoded payload is NOT a live admission.
export function verifySignedPayload(envelope,publicKey){
  must(envelope&&typeof envelope.payload==='string'&&envelope.payload.length<800000&&
    typeof envelope.signature==='string'&&/^[A-Za-z0-9+/]{86}==$/.test(envelope.signature),'SIGNED_ARTIFACT_SCHEMA');
  const key=createPublicKey(publicKey);must(key.asymmetricKeyType==='ed25519','OWNER_KEY_TYPE');
  must(verify(null,Buffer.from(envelope.payload),key,Buffer.from(envelope.signature,'base64')),'OWNER_SIGNATURE_INVALID');
  return freeze(JSON.parse(envelope.payload));
}

export function verifySignedArtifact(envelope,publicKey,now=Date.now()){
  const p=verifySignedPayload(envelope,publicKey);
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
  validateHostLoop(p,now);
  return freeze(p);
}

export async function loadHostAuthority(){
  const key=await rootOwned(path.join(AUTHORITY_DIR,'owner-public.pem'),10000);
  const raw=await rootOwned(path.join(AUTHORITY_DIR,'activation.json'));
  const payload=verifySignedArtifact(JSON.parse(raw),key);
  const catalogRaw=await rootOwned(path.join(AUTHORITY_DIR,'catalog.json'));
  must(hash(catalogRaw)===payload.catalogSha256,'CATALOG_NOT_SIGNED');
  const catalog=freeze(JSON.parse(catalogRaw));
  must(Array.isArray(catalog)&&catalog.length===1&&catalog[0].sha===payload.baseSha,'PILOT_CATALOG');
  if(payload.closedLoop)must(payload.closedLoop.policy.tasks.length===catalog.length&&catalog.every(t=>
    payload.closedLoop.policy.tasks.some(p=>p.id===t.id&&p.workOrderId===t.workOrderId&&p.branch===t.branch&&
      p.baseSha===t.sha&&equal(p.paths,t.changes.map(c=>c.path)))),'HOST_LOOP_CATALOG_BINDING');
  const admission=Object.freeze({root:payload.root,legacyStateDir:payload.legacyStateDir});
  admitted.set(admission,payload);
  async function revalidate(){
    must(await rootOwned(path.join(AUTHORITY_DIR,'activation.json'))===raw,'ACTIVATION_REVOKED_OR_CHANGED');
    must(await rootOwned(path.join(AUTHORITY_DIR,'owner-public.pem'),10000)===key,'OWNER_KEY_CHANGED');
    must(await rootOwned(path.join(AUTHORITY_DIR,'catalog.json'))===catalogRaw,'CATALOG_CHANGED');
    verifySignedArtifact(JSON.parse(raw),key);
  }
  return Object.freeze({payload,catalog,admission,revalidate,async authorize(request){
    await revalidate();validateHostRequest(payload,catalog,request);
    const task=catalog.find(t=>t.id===request.taskId);
    return {approved:true,request,automaticCiApproved:true,automaticReviewApproved:true,
      operationId:'pilot-'+hash(raw+task.id).slice(0,48),expiresAt:payload.expiresAt};
  }});
}

export function assertLiveAdmission(admission,root,legacy){
  const p=admitted.get(admission);
  must(p&&p.expiresAt>Date.now()&&p.root===root&&(!legacy||p.legacyStateDir===legacy),'LIVE_ADMISSION_REQUIRED');
}

// New host admission, never inferred from a historical G1 activation.
export const BEGET=Object.freeze({host:'pqukibofpo',service:'asi-strigunov-agent.service',
  root:'/var/lib/asi-engine',runtime:'/opt/asi-engine',user:'asi-engine'});
export function verifyBegetActivation(envelope,publicKey,now=Date.now()){
  must(envelope&&typeof envelope.payload==='string'&&envelope.payload.length<800000&&
    /^[A-Za-z0-9+/]{86}==$/.test(envelope.signature),'SIGNED_ARTIFACT_SCHEMA');
  const key=createPublicKey(publicKey);must(key.asymmetricKeyType==='ed25519'&&
    verify(null,Buffer.from(envelope.payload),key,Buffer.from(envelope.signature,'base64')),'OWNER_SIGNATURE_INVALID');
  const p=JSON.parse(envelope.payload),c=p?.closedLoop;
  must(p?.schema==='asi.engine-beget-activation.v1'&&p.repo==='ASI-integration/asi-landing'&&
    p.host===BEGET.host&&p.service===BEGET.service&&p.root===BEGET.root&&p.runtime===BEGET.runtime&&p.user===BEGET.user&&
    p.stage==='S4-G2'&&/^[a-f0-9]{40}$/.test(p.baseSha)&&
    Number.isSafeInteger(p.notBefore)&&Number.isSafeInteger(p.expiresAt)&&p.notBefore<=now&&now<p.expiresAt&&
    p.expiresAt-p.notBefore<=14*86400000&&p.automaticCiApproved===true&&p.automaticReviewApproved===true&&
    p.budget?.paidUsd===0&&p.budget.maxTasks===2&&p.budget.maxMutations===8&&
    Number.isSafeInteger(p.budget.maxRequests)&&p.budget.maxRequests>=100&&p.budget.maxRequests<=50000&&
    ['catalogSha256','runtimeManifestSha256','fenceSha256','reviewsSha256','releaseSha256'].every(k=>/^[a-f0-9]{64}$/.test(p[k]))&&
    Number.isSafeInteger(p.githubApp?.appId)&&p.githubApp.appId>0&&Number.isSafeInteger(p.githubApp?.installationId)&&p.githubApp.installationId>0&&
    c?.continuous===true&&c.reviewMode==='signed-offline-delta'&&c.intervalMs===600000&&
    Number.isSafeInteger(c.maxTicks)&&c.maxTicks>=1&&c.maxTicks<=2016&&
    c.policy?.schema==='asi.stage-authority.beget.v1'&&c.policy.baseSha===p.baseSha&&
    c.policy.notBefore===p.notBefore&&c.policy.expiresAt===p.expiresAt,'BEGET_SCOPE_OR_EXPIRY');
  validateStagePolicy(c.policy,now);
  if(c.planning!==undefined){
    const planning=c.planning;
    must(planning&&Object.keys(planning).sort().join(',')==='contract,goal,workOrders',
      'BEGET_PLANNING_SCOPE');
    const graph=decomposeProductGoal(planning.contract,planning.goal,planning.workOrders,{now});
    // Requests/mutations are enforced by the existing durable native counter.
    // Do not promise a tighter graph cap than that counter actually enforces.
    // computeMs remains a declared preparation estimate, NOT an aggregate meter.
    must(graph.product==='strigunov4'&&graph.repository===p.repo&&graph.head===p.baseSha&&
      graph.notBefore===p.notBefore&&graph.expiresAt===p.expiresAt&&
      graph.budget.maxTasks===p.budget.maxTasks&&graph.budget.maxRequests===p.budget.maxRequests&&
      graph.budget.maxMutations===p.budget.maxMutations&&graph.budget.maxPaidMicrousd===0&&
      planning.workOrders.length===2&&graph.nodes.length===2&&graph.nodes.every(n=>{
        const task=c.policy.tasks.find(t=>t.workOrderId===n.id);
        return task&&n.stage===p.stage.toLowerCase()&&n.operation==='prepare-source'&&
          n.tool==='existing-runner-bridge'&&equal(n.paths,[...task.paths].sort());
      }),'BEGET_PLANNING_BINDING');
  }
  must(Array.isArray(p.ciPolicies)&&p.ciPolicies.length===2&&
    p.ciPolicies.some(q=>q.name==='validate'&&q.workflowId===311380800&&q.event==='pull_request')&&
    p.ciPolicies.some(q=>q.name==='release_governance'&&q.workflowId===390653294&&q.event==='pull_request_target'),'BEGET_CI_POLICY');
  return freeze(p);
}
export async function loadBegetAuthority(){
  const read=name=>rootOwned(AUTHORITY_DIR+'/'+name);
  const key=await read('owner-public.pem'),raw=await read('activation.json');
  const payload=verifyBegetActivation(JSON.parse(raw),key),files={};
  for(const [name,field] of Object.entries({'catalog.json':'catalogSha256','fence.json':'fenceSha256',
    'reviews.json':'reviewsSha256'})){
    files[name]=await read(name);must(hash(files[name])===payload[field],'BEGET_ARTIFACT_CHANGED');
  }
  const catalog=freeze(JSON.parse(files['catalog.json']));
  must(Array.isArray(catalog)&&catalog.length===2&&catalog.every(t=>t.repo===payload.repo&&t.stage===payload.stage&&
    t.sha===payload.baseSha&&t.pr===null&&t.kind==='github-publisher'&&t.id===t.workOrderId&&
    payload.closedLoop.policy.tasks.some(p=>p.id===t.id&&p.branch===t.branch&&
      equal(p.paths,t.changes?.map(c=>c.path)))&&t.changes.length===1&&t.changes[0].beforeSha256===null&&
      typeof t.changes[0].content==='string'),'BEGET_CATALOG_BINDING');
  must(new Set(catalog.map(t=>t.id)).size===2,'BEGET_CATALOG_DUPLICATE');
  const admission=Object.freeze({root:payload.root});admitted.set(admission,payload);
  async function revalidate(){
    must(await read('activation.json')===raw&&await read('owner-public.pem')===key,'BEGET_ACTIVATION_CHANGED');
    for(const [name,bytes] of Object.entries(files))must(await read(name)===bytes,'BEGET_ARTIFACT_CHANGED');
    verifyBegetActivation(JSON.parse(raw),key);
  }
  async function fencingWitness(){
    await revalidate();const f=JSON.parse(files['fence.json']);
    // Root installer must independently verify provider/GitHub evidence before
    // admitting this record. DNS failure/SSH timeout/owner assertion are forbidden.
    must(f.schema==='asi.old-writer-fence.v1'&&f.repository===payload.repo&&
      f.method==='REVOKED_OLD_GITHUB_INSTALLATION'&&Number.isSafeInteger(f.oldInstallationId)&&f.oldInstallationId>0&&
      f.oldInstallationId!==payload.githubApp.installationId&&f.oldCredentialsRevoked===true&&
      f.outstandingTokensExpiredAt<=payload.notBefore&&Number.isSafeInteger(f.outstandingTokensExpiredAt)&&
      /^[a-f0-9]{64}$/.test(f.independentEvidenceSha256)&&f.verifiedBy==='protected-install-review'&&
      Array.isArray(f.deniedPullRequests)&&f.deniedPullRequests.includes(531),'OLD_WRITER_FENCING_UNVERIFIED');
    return {sha256:payload.fenceSha256};
  }
  return Object.freeze({payload,catalog,admission,revalidate,fencingWitness,files,
    async authorize(request){await revalidate();await fencingWitness();const t=catalog.find(t=>t.id===request.taskId);
      must(t&&request.taskBinding===hash(JSON.stringify(t))&&request.repo===payload.repo&&request.stage===payload.stage&&
        request.baseSha===payload.baseSha&&request.branch===t.branch&&equal(request.paths,t.changes.map(c=>c.path))&&
        equal(request.operations,['create-tree','create-commit','create-branch','create-draft-pr'])&&
        request.reviewPolicySha256===payload.reviewsSha256,'BEGET_TASK_NOT_ADMITTED');
      return {approved:true,request,automaticCiApproved:true,automaticReviewApproved:true,
        operationId:'beget-'+hash(raw+t.id).slice(0,48),expiresAt:payload.expiresAt};}
  });
}
