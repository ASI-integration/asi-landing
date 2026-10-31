// No signing key or owner grant is generated here. The operator installs a
// signed exact activation/catalog after approval; missing/revoked files stop use.
import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {verify,createPublicKey,createHash} from 'node:crypto';
import {validateStagePolicy} from './stage-authority.mjs';
import {decomposeProductGoal} from '../../global-dispatcher/product-adapters.mjs';
import {inspectSourceIntake} from '../source-work-intake.mjs';
import {inspectSignedParentChildSource} from './standing-parent-signature-source.mjs';
import {isNativeSourceModification} from '../source-publisher-handoff.mjs';

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

/** Explicit opt-in generation for ONE existing Beget service. No unsigned
 * source, GitHub label, test fixture or legacy activation can enter v2. */
export function verifyBegetFiveLaneActivation(envelope,ownerPublicKey,now=Date.now()){
  const p=verifySignedPayload(envelope,ownerPublicKey);
  const h64=/^[a-f0-9]{64}$/,h40=/^[a-f0-9]{40}$/;
  must(p?.schema==='asi.engine-beget-five-lane-activation.v1'&&
    p.repo==='ASI-integration/asi-landing'&&p.host===BEGET.host&&
    p.user===BEGET.user&&p.service===BEGET.service&&
    p.root===BEGET.root&&p.runtime===BEGET.runtime&&p.stage==='S4-G2'&&
    h40.test(p.baseSha)&&
    Number.isSafeInteger(p.notBefore)&&Number.isSafeInteger(p.expiresAt)&&
    p.notBefore<=now&&now<p.expiresAt&&
    p.expiresAt-p.notBefore<=365*86400000&&
    ['runtimeManifestSha256','catalogSha256','goalGraphSha256',
     'assessmentsSha256','fenceSha256','reviewsSha256',
     'securityDigest','policyDigest','ownerKeySha256',
     'verifierKeySha256','parentDigest'].every(k=>h64.test(p[k]))&&
    p.githubApp?.appId===5514822&&p.githubApp?.installationId===176281163&&
    p.model?.name&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,100}$/.test(p.model.name)&&
    typeof p.model.reviewName==='string'&&
    p.model.reviewName!==p.model.name&&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,100}$/.test(p.model.reviewName)&&
    Number.isSafeInteger(p.model.maxOutputTokens)&&
    p.model.maxOutputTokens>=128&&p.model.maxOutputTokens<=4096&&
    Number.isSafeInteger(p.model.maxCalls)&&p.model.maxCalls>=1&&p.model.maxCalls<=256&&
    Number.isSafeInteger(p.model.reserveMicrousdPerCall)&&
    p.model.reserveMicrousdPerCall>=1&&p.model.reserveMicrousdPerCall<=1000000&&
    Number.isSafeInteger(p.model.maxPaidMicrousd)&&
    p.model.maxPaidMicrousd>=p.model.reserveMicrousdPerCall&&
    p.model.maxPaidMicrousd<=20000000&&
    Array.isArray(p.ciPolicies)&&p.ciPolicies.length===2&&
    p.ciPolicies.some(x=>x.name==='validate'&&x.workflowId===311380800&&
      x.event==='pull_request')&&
    p.ciPolicies.some(x=>x.name==='release_governance'&&
      x.workflowId===390653294&&x.event==='pull_request_target'),
    'FIVE_LANE_SIGNED_ACTIVATION_SCOPE');
  const ownerDigest=hash(createPublicKey(ownerPublicKey).export({type:'spki',format:'der'}));
  must(ownerDigest===p.ownerKeySha256,'FIVE_LANE_OWNER_PIN');
  return p;
}
export async function loadBegetFiveLaneAuthority(){
  const read=name=>rootOwned(AUTHORITY_DIR+'/'+name);
  const owner=await read('owner-public.pem');
  const activationRaw=await read('activation.json');
  const activation=JSON.parse(activationRaw);
  const payload=verifyBegetFiveLaneActivation(activation,owner);
  const verifier=await read('standing-verifier-public.pem');
  must(hash(createPublicKey(verifier).export({type:'spki',format:'der'}))===
    payload.verifierKeySha256,'FIVE_LANE_VERIFIER_PIN');
  const names={'catalog.json':'catalogSha256','five-lane-goal.json':'goalGraphSha256',
    'five-lane-assessments.json':'assessmentsSha256',
    'fence.json':'fenceSha256','reviews.json':'reviewsSha256'};
  const files={};
  for(const [name,pin] of Object.entries(names)){
    files[name]=await read(name);
    must(hash(files[name])===payload[pin],'FIVE_LANE_SIGNED_FILE_MISMATCH');
  }
  const catalog=freeze(JSON.parse(files['catalog.json']));
  const goalGraph=freeze(JSON.parse(files['five-lane-goal.json']));
  const assessments=freeze(JSON.parse(files['five-lane-assessments.json']));
  const reviewPolicy=JSON.parse(files['reviews.json']);
  must(reviewPolicy?.schema==='asi.five-lane-independent-model-review.v1'&&
    reviewPolicy.repository===payload.repo&&
    reviewPolicy.model===payload.model.reviewName&&
    reviewPolicy.mode==='SOURCE_DRAFT_REVIEW_ONLY'&&
    reviewPolicy.requiresCi===true,
    'FIVE_LANE_SIGNED_REVIEW_POLICY');
  must(Array.isArray(catalog)&&catalog.length===5&&
    new Set(catalog.map(t=>t.id)).size===5&&
    new Set(catalog.map(t=>t.branch)).size===5&&
    catalog.every(t=>t.baseSha===payload.baseSha&&
      t.kind==='source-proposal'&&t.stage==='S4-G2'&&
      inspectSourceIntake({task:t,admittedTasks:catalog}).status==='SOURCE_CANDIDATE'),
    'FIVE_LANE_SIGNED_CATALOG_INVALID');
  must(assessments&&typeof assessments==='object'&&!Array.isArray(assessments)&&
    Object.keys(assessments).length===5&&
    catalog.every(t=>Object.hasOwn(assessments,t.id))&&
    goalGraph?.planHash&&Array.isArray(goalGraph?.nodes)&&
    catalog.every(t=>goalGraph.nodes.some(n=>n.id===t.id)),
    'FIVE_LANE_SIGNED_PLAN_INVALID');
  async function signedDelegation(){
    const parent=JSON.parse(await read('standing-parent.json'));
    const child=JSON.parse(await read('standing-child.json'));
    const revocations=verifySignedPayload(JSON.parse(await read('standing-revocations.json')),owner);
    must(revocations?.schema==='asi.standing-revocations.v1'&&
      revocations.repo===payload.repo&&revocations.target===payload.host&&
      Number.isSafeInteger(revocations.sequence)&&revocations.sequence>=1&&
      Array.isArray(revocations.revokedParentDigests)&&
      Array.isArray(revocations.revokedChildDigests),
      'FIVE_LANE_REVOCATION_INVALID');
    const evidence=inspectSignedParentChildSource({
      signedParent:parent,signedChild:child,
      ownerPublicKey:owner,verifierPublicKey:verifier,
      expected:{baseSha:payload.baseSha,securityDigest:payload.securityDigest,
        policyDigest:payload.policyDigest,ownerKeySha256:payload.ownerKeySha256,
        verifierKeySha256:payload.verifierKeySha256},
      now:Date.now(),revokedParentDigests:revocations.revokedParentDigests,
      revokedChildDigests:revocations.revokedChildDigests
    });
    must(evidence.status==='SIGNED_PARENT_CHILD_SOURCE_VERIFIED'&&
      evidence.parent.digest===payload.parentDigest,
      'FIVE_LANE_SIGNED_PARENT_CHILD_DENIED');
    return {evidence,revocations};
  }
  const initial=await signedDelegation();
  const originalChild=initial.evidence.child.digest;
  let revocationFloor=initial.revocations.sequence;
  const admission=Object.freeze({root:payload.root});
  admitted.set(admission,payload);
  async function revalidate(){
    must(await read('activation.json')===activationRaw&&
      await read('owner-public.pem')===owner&&
      await read('standing-verifier-public.pem')===verifier,
      'FIVE_LANE_SIGNED_ACTIVATION_CHANGED');
    for(const [name,raw] of Object.entries(files))
      must(await read(name)===raw,'FIVE_LANE_SIGNED_FILE_CHANGED');
    verifyBegetFiveLaneActivation(activation,owner);
    const current=await signedDelegation();
    must(current.evidence.child.digest===originalChild&&
      current.revocations.sequence>=revocationFloor,
      'FIVE_LANE_CHILD_OR_REVOCATION_ROLLBACK');
    revocationFloor=current.revocations.sequence;
    return true;
  }
  async function fencingWitness(){
    await revalidate();
    const f=JSON.parse(files['fence.json']);
    must(f.schema==='asi.old-writer-fence.v1'&&f.repository===payload.repo&&
      f.method==='REVOKED_OLD_GITHUB_INSTALLATION'&&
      f.oldCredentialsRevoked===true&&
      Number.isSafeInteger(f.oldInstallationId)&&
      f.oldInstallationId!==payload.githubApp.installationId&&
      Number.isSafeInteger(f.outstandingTokensExpiredAt)&&
      f.outstandingTokensExpiredAt<=payload.notBefore&&
      f.verifiedBy==='protected-install-review',
      'FIVE_LANE_OLD_WRITER_FENCE');
    return true;
  }
  async function verifyChildHistory(ledger){
    await revalidate();
    const entries=Object.entries(ledger?.standingDelegationBudget?.envelopes??{});
    must(entries.length<=64&&entries.every(([digest,e])=>
      /^[a-f0-9]{64}$/.test(digest)&&e?.scope?.digest===digest&&
      Array.isArray(e.claims)&&e.claims.length>0&&
      Number.isSafeInteger(e.claims[0].reservedAt)),
      'FIVE_LANE_HISTORICAL_LEDGER_INVALID');
    const old=entries.filter(([digest])=>digest!==originalChild);
    const raw=await read('standing-children-history.json');
    const artifacts=JSON.parse(raw);
    must(Array.isArray(artifacts)&&artifacts.length===old.length&&
      artifacts.length<=64,'FIVE_LANE_SIGNED_CHILD_HISTORY_MISSING');
    const parent=JSON.parse(await read('standing-parent.json'));
    const currentRev=verifySignedPayload(
      JSON.parse(await read('standing-revocations.json')),owner);
    const seen=new Set();
    for(const signedChild of artifacts){
      let found=false;
      for(const [digest,entry] of old){
        if(seen.has(digest))continue;
        const proof=inspectSignedParentChildSource({
          signedParent:parent,signedChild,
          ownerPublicKey:owner,verifierPublicKey:verifier,
          expected:{baseSha:payload.baseSha,
            securityDigest:payload.securityDigest,
            policyDigest:payload.policyDigest,
            ownerKeySha256:payload.ownerKeySha256,
            verifierKeySha256:payload.verifierKeySha256},
          now:entry.claims[0].reservedAt,
          revokedParentDigests:currentRev.revokedParentDigests,
          revokedChildDigests:currentRev.revokedChildDigests
        });
        if(proof.status==='SIGNED_PARENT_CHILD_SOURCE_VERIFIED'&&
          proof.parent.digest===payload.parentDigest&&
          proof.child.digest===digest&&
          entry.scope.notBefore===proof.child.notBefore&&
          entry.scope.expiresAt===proof.child.expiresAt){
          seen.add(digest);found=true;break;
        }
      }
      must(found,'FIVE_LANE_HISTORICAL_SIGNER_OR_SCOPE_INVALID');
    }
    must(seen.size===old.length,'FIVE_LANE_HISTORICAL_CHILD_INCOMPLETE');
    return true;
  }
  async function checkRevocationCheckpoint({store,ledger,transaction}={}){
    const {inspectStandingTransaction,atomicJson}=await import('./state.mjs');
    const lease=inspectStandingTransaction(transaction);
    must(lease.root===store?.root&&lease.ledger===ledger&&
      lease.kind==='github-publisher','NATIVE_REVOCATION_LOCK_REQUIRED');
    const current=(await signedDelegation()).revocations;
    const checkpoint={
      sequence:current.sequence,manifestDigest:hash(JSON.stringify(current)),
      revokedEnvelopeDigests:[...new Set([
        ...current.revokedParentDigests,...current.revokedChildDigests
      ])].sort()
    };
    const own=Object.getOwnPropertyDescriptor(ledger,'standingRevocationCheckpoint');
    must(own?Object.hasOwn(own,'value'):
      !('standingRevocationCheckpoint' in ledger),
      'NATIVE_REVOCATION_CHECKPOINT_INVALID');
    const prior=own?.value;
    if(prior){
      must(Number.isSafeInteger(prior.sequence)&&prior.sequence>=1&&
        /^[a-f0-9]{64}$/.test(prior.manifestDigest)&&
        Array.isArray(prior.revokedEnvelopeDigests)&&
        prior.revokedEnvelopeDigests.every(x=>/^[a-f0-9]{64}$/.test(x))&&
        checkpoint.sequence>=prior.sequence&&
        (checkpoint.sequence!==prior.sequence||
          checkpoint.manifestDigest===prior.manifestDigest)&&
        prior.revokedEnvelopeDigests.every(d=>
          checkpoint.revokedEnvelopeDigests.includes(d)),
        'NATIVE_REVOCATION_ROLLBACK');
      if(checkpoint.sequence===prior.sequence)return true;
    }else{
      must(Object.keys(ledger.standingDelegationBudget?.envelopes??{}).length===0,
        'NATIVE_UNCHECKPOINTED_SPENDING');
    }
    await revalidate();
    const again=inspectStandingTransaction(transaction);
    must(again.transactionId===lease.transactionId&&again.ledger===ledger,
      'NATIVE_REVOCATION_LOCK_CHANGED');
    await atomicJson(store.file('autopilot-ledger.json'),
      {...ledger,standingRevocationCheckpoint:checkpoint});
    ledger.standingRevocationCheckpoint=checkpoint;
    return true;
  }
  const catalogDigest=hash(JSON.stringify(catalog));
  return Object.freeze({payload,catalog,catalogDigest,goalGraph,assessments,
    admission,revalidate,fencingWitness,verifyChildHistory,
    checkRevocationCheckpoint,
    async signedDelegation(){await revalidate();return (await signedDelegation()).evidence;},
    async authorizePublisher(request,task){
      await revalidate();await fencingWitness();
      const exact=catalog.filter(t=>t.id===task?.id&&t.laneId===task.laneId);
      must(exact.length===1&&isNativeSourceModification(task)&&
        task.sha===payload.baseSha&&task.sourceBinding===
          inspectSourceIntake({task:exact[0],admittedTasks:catalog}).taskBinding&&
        task.changes.length===exact[0].files.length&&
        task.changes.every((c,i)=>c.path===exact[0].files[i].path&&
          c.beforeSha256===exact[0].files[i].beforeSha256)&&
        request?.taskId===task.id&&request.taskBinding===hash(JSON.stringify(task))&&
        request.repo===payload.repo&&request.stage===payload.stage&&
        request.baseSha===payload.baseSha&&request.branch===task.branch&&
        equal(request.paths,task.changes.map(c=>c.path))&&
        request.reviewPolicySha256===payload.reviewsSha256&&
        equal(request.operations,['create-tree','create-commit','create-branch','create-draft-pr']),
        'FIVE_LANE_PUBLISHER_NOT_SIGNED');
      // A signed envelope covers routine source scope, not production release.
      return Object.freeze({approved:true,request,automaticCiApproved:true,
        automaticReviewApproved:true,
        operationId:'native-'+hash(activationRaw+task.proposalDigest).slice(0,48),
        expiresAt:Math.min(payload.expiresAt,initial.evidence.expiresAt)});
    }
  });
}
