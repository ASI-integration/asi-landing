/**
 * Read-only active Engine upgrade gate. Not an installer, signer, lock issuer,
 * upgrade executor or permission port. Never touches private state or service.
 * A positive result remains SOURCE_PREFLIGHT_ONLY: actual native admission,
 * remote-operation quiescence and one-use root-controlled exchange are separate.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,createPublicKey,verify} from 'node:crypto';

const HEX=/^[a-f0-9]{64}$/;
const SHA=/^[a-f0-9]{40}$/;
const UNIT='asi-strigunov-agent.service';
const HOST='pqukibofpo';
const REAL_ROOT='/opt/asi-engine';
const REAL_STATE='/var/lib/asi-engine';
const ACTIONS=Object.freeze([
  'verify-current-generation','preserve-existing-private-state',
  'stage-exact-new-generation','quiesce-existing-engine',
  'replace-existing-runtime-only','restart-same-engine',
  'verify-exact-new-generation-and-no-replay'
]);
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const block=reason=>Object.freeze({schema:'asi.beget-live-upgrade-preflight.v1',
  status:'BLOCKED',reason,authorized:false,installable:false,hasLiveUpgrade:false});
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null)&&
  Reflect.ownKeys(x).every(k=>typeof k==='string'&&
    Object.hasOwn(Object.getOwnPropertyDescriptor(x,k),'value'));
const exact=(x,names)=>plain(x)&&Reflect.ownKeys(x).length===names.length&&
  names.every(k=>Object.hasOwn(x,k));
const positive=x=>Number.isSafeInteger(x)&&x>0;
const timestamp=x=>Number.isSafeInteger(x)&&x>=0;
const readJson=(raw,limit)=>{
  if(typeof raw!=='string'||Buffer.byteLength(raw)>limit)throw Error('JSON_BYTES');
  return JSON.parse(raw);
};
const approvedInstance=x=>exact(x,['host','unit','active','enabled','pid','invocationId','restartCount'])&&
  x.host===HOST&&x.unit===UNIT&&x.active===true&&x.enabled===true&&
  positive(x.pid)&&typeof x.invocationId==='string'&&
  /^[a-f0-9]{32}$/.test(x.invocationId)&&timestamp(x.restartCount);
/**
 * Verify an Ed25519 owner signature only against a separately pinned,
 * root-owned public key. Caller-supplied publicKey alone is not proven trust.
 * Output never grants execution even on authentic signature.
 */
export function inspectSignedLiveUpgrade({
  installedManifestRaw,proposedManifestRaw,upgradePlanRaw,
  signedGrantRaw,ownerPublicKey,instance,now
}={}){
  try{
    if(!approvedInstance(instance)||!timestamp(now))return block('LIVE_INSTANCE_UNVERIFIED');
    const old=readJson(installedManifestRaw,120000);
    const next=readJson(proposedManifestRaw,120000);
    const plan=readJson(upgradePlanRaw,120000);
    const envelope=readJson(signedGrantRaw,120000);
    if(!plain(old)||!plain(next)||!plain(plan)||!plain(envelope)||
       !SHA.test(old.sourceSha)||!SHA.test(next.sourceSha)||!SHA.test(next.baseSha)||
       old.schema!=='asi.beget-engine-source.v1'||
       next.schema!=='asi.beget-engine-source.v1'||
       old.sourceSha===next.sourceSha||old.unitSha256!==next.unitSha256||
       old.catalogSha256===next.catalogSha256||next.installable!==false||
       !Array.isArray(next.files)||next.files.length<25||
       !next.files.some(f=>f.path==='scripts/strigunov4/execution-adapters/standing-request-guard.mjs')||
       !next.files.some(f=>f.path==='scripts/strigunov4/execution-adapters/standing-budget.mjs'))
      return block('GENERATION_SCOPE_UNVERIFIED');
    if(plan.schema!=='asi.beget-active-upgrade-plan.v1'||
       plan.status!=='SOURCE_CANDIDATE_ONLY'||plan.authorized!==false||
       plan.installable!==false||
       plan.old?.manifestSha256!==sha(installedManifestRaw)||
       plan.proposed?.manifestSha256!==sha(proposedManifestRaw)||
       plan.old?.sourceSha!==old.sourceSha||
       plan.proposed?.sourceSha!==next.sourceSha||
       plan.old?.catalogSha256!==old.catalogSha256||
       plan.proposed?.catalogSha256!==next.catalogSha256||
       plan.proposed?.unitSha256!==next.unitSha256||
       plan.target?.service!==UNIT||plan.target?.runtime!==REAL_ROOT||
       plan.target?.privateState!==REAL_STATE)
      return block('OLD_NEW_MANIFEST_BINDING_MISMATCH');
    if(!exact(envelope,['payload','signature'])||
       typeof envelope.payload!=='string'||envelope.payload.length>40000||
       typeof envelope.signature!=='string'||
       !/^[a-zA-Z0-9+/]{86}==$/.test(envelope.signature))
      return block('OWNER_SIGNED_ENVELOPE_INVALID');
    const key=createPublicKey(ownerPublicKey);
    if(key.asymmetricKeyType!=='ed25519'||
       !verify(null,Buffer.from(envelope.payload,'utf8'),key,
         Buffer.from(envelope.signature,'base64')))
      return block('OWNER_SIGNATURE_INVALID');
    const grant=readJson(envelope.payload,40000);
    if(!exact(grant,['schema','host','unit','oldManifestSha256',
      'newManifestSha256','newSourceSha','baseSha','planSha256','actions',
      'notBefore','expiresAt'])||
       grant.schema!=='asi.beget-active-upgrade-authorization.v1'||
       grant.host!==HOST||grant.unit!==UNIT||
       grant.oldManifestSha256!==sha(installedManifestRaw)||
       grant.newManifestSha256!==sha(proposedManifestRaw)||
       grant.newSourceSha!==next.sourceSha||grant.baseSha!==next.baseSha||
       grant.planSha256!==sha(upgradePlanRaw)||
       !Array.isArray(grant.actions)||grant.actions.length!==ACTIONS.length||
       ACTIONS.some((s,i)=>grant.actions[i]!==s)||
       !timestamp(grant.notBefore)||!timestamp(grant.expiresAt)||
       grant.expiresAt-grant.notBefore>14*86400000||
       !(grant.notBefore<=now&&now<grant.expiresAt))
      return block('SIGNED_UPGRADE_SCOPE_OR_TIME_INVALID');
    return Object.freeze({schema:'asi.beget-live-upgrade-preflight.v1',
      status:'SOURCE_SIGNATURE_VERIFIED',reason:'REQUIRES_NATIVE_ROOT_AND_STATE_ADMISSION',
      authorized:false,installable:false,hasLiveUpgrade:false,
      oldManifestSha256:sha(installedManifestRaw),
      newManifestSha256:sha(proposedManifestRaw),
      signedGrantSha256:sha(signedGrantRaw),
      observedInvocationId:instance.invocationId});
  }catch{return block('UNREADABLE_OR_UNTRUSTED_UPGRADE_EVIDENCE');}
}
/**
 * Fixed-path read-only host probe. No sudo, no authority read from a PR, and
 * no protected-state access fallback. A non-root caller cannot attest
 * root-owned owner-grant provenance; it will return BLOCKED.
 */
export async function inspectBegetLiveUpgradeReadiness({
  candidatePackage,operatorUid=process.getuid(),now=Date.now()
}={}){
  if(operatorUid!==0)return block('PRIVILEGED_OPERATOR_REQUIRED');
  // Even from root, this is only an observation and MUST NOT be used to
  // request an install. An actual operator must provide independently
  // authenticated systemd instance, zero in-flight remote operations and
  // durable state continuity under the existing Engine lock.
  if(typeof candidatePackage!=='string'||!path.isAbsolute(candidatePackage)||
     !timestamp(now))return block('CANDIDATE_PACKAGE_INVALID');
  try{
    const [a,b,c]=await Promise.all([
      fs.readFile(REAL_ROOT+'/manifest.json','utf8'),
      fs.readFile(candidatePackage+'/manifest.json','utf8'),
      fs.readFile(candidatePackage+'/upgrade-source-plan.json','utf8')
    ]);
    const old=readJson(a,120000),next=readJson(b,120000),plan=readJson(c,120000);
    if(!plain(old)||!plain(next)||!plain(plan)||
       plan.old?.manifestSha256!==sha(a)||plan.proposed?.manifestSha256!==sha(b))
      return block('LIVE_PACKAGE_CONTINUITY_UNVERIFIED');
    return Object.freeze({schema:'asi.beget-live-upgrade-preflight.v1',
      status:'READ_ONLY_CANDIDATE_MATCH',authorized:false,installable:false,
      hasLiveUpgrade:false,oldSourceSha:old.sourceSha,
      proposedSourceSha:next.sourceSha,
      reason:'ROOT_OWNED_SIGNATURE_AND_IN_FLIGHT_STATE_REVIEW_REQUIRED'});
  }catch{return block('LIVE_PACKAGE_FILES_UNAVAILABLE');}
}
