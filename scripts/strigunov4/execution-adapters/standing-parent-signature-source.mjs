/**
 * Non-authorizing cryptographic source proof for an owner-signed 365-day parent
 * and verifier-signed <=14-day child. No protected filesystem reads, private
 * keys, state writes, external effects, admissions, or delegated capabilities.
 * Caller-supplied public keys/expected context are NOT independent trust roots:
 * protected-base native wiring must provide/authenticate them before any effect.
 */
import {createHash,createPublicKey,verify} from 'node:crypto';

const REPO='ASI-integration/asi-landing',TARGET='pqukibofpo';
const SHA40=/^[a-f0-9]{40}$/,SHA64=/^[a-f0-9]{64}$/;
const YEAR=365*86400000,CHILD=14*86400000;
const CLASSES=new Set(['stage4-source-maintenance','stage4-source-test']);
const common=['schema','repo','environment','target','action','stage','baseSha',
  'approvedRoutineClasses','securityDigest','policyDigest','notBefore','expiresAt',
  'paidApiUsd','maxOperations','maxRequests','maxWrites'];
const parentFields=common;
const childFields=[...common,'parentDigest'];
const expectedFields=['baseSha','securityDigest','policyDigest',
  'ownerKeySha256','verifierKeySha256'];
const deny=reason=>Object.freeze({status:'SIGNED_PARENT_CHILD_SOURCE_BLOCKED',reason,authorized:false});
const hash=value=>createHash('sha256').update(value).digest('hex');
const plain=(value,fields)=>{
  if(!value||typeof value!=='object'||Array.isArray(value)||
    ![Object.prototype,null].includes(Object.getPrototypeOf(value)))return null;
  const descriptors=Object.getOwnPropertyDescriptors(value);
  if(Reflect.ownKeys(descriptors).length!==fields.length||
    fields.some(k=>!descriptors[k]||!Object.hasOwn(descriptors[k],'value')))return null;
  return Object.fromEntries(fields.map(k=>[k,descriptors[k].value]));
};
function classes(value) {
  if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype||
    value.length<1||value.length>2)return null;
  const names=[];
  for(let i=0;i<value.length;i++){
    const d=Object.getOwnPropertyDescriptor(value,String(i));
    if(!d||!Object.hasOwn(d,'value')||!CLASSES.has(d.value)||names.includes(d.value))return null;
    names.push(d.value);
  }
  return names;
}
const caps=x=>Number.isSafeInteger(x.maxOperations)&&x.maxOperations>0&&x.maxOperations<=256&&
  Number.isSafeInteger(x.maxRequests)&&x.maxRequests>0&&x.maxRequests<=256&&
  Number.isSafeInteger(x.maxWrites)&&x.maxWrites>0&&x.maxWrites<=64&&
  x.maxWrites<=x.maxOperations&&x.maxWrites<=x.maxRequests;
function signedPayload(envelope,publicKey){
  const e=plain(envelope,['payload','signature']);
  if(!e||typeof e.payload!=='string'||e.payload.length>20000||
    typeof e.signature!=='string'||!/^[A-Za-z0-9+/]{86}==$/.test(e.signature))return null;
  const key=createPublicKey(publicKey);
  if(key.asymmetricKeyType!=='ed25519')return null;
  const signature=Buffer.from(e.signature,'base64');
  if(signature.length!==64||signature.toString('base64')!==e.signature||
    !verify(null,Buffer.from(e.payload,'utf8'),key,signature))return null;
  const parsed=JSON.parse(e.payload);
  // Require exactly one deterministic JSON object: no duplicate keys, aliases,
  // parser differential or unexpectedly large side fields.
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||
    JSON.stringify(parsed)!==e.payload)return null;
  return {value:parsed,digest:hash(e.payload),
    fingerprint:hash(key.export({type:'spki',format:'der'}))};
}
function scope(x,maxDuration,now) {
  const names=classes(x.approvedRoutineClasses);
  return x.repo===REPO&&x.environment==='beget-staging'&&x.target===TARGET&&
    x.action==='source'&&x.stage==='S4-G2'&&names&&x.paidApiUsd===0&&caps(x)&&
    SHA40.test(x.baseSha)&&SHA64.test(x.securityDigest)&&SHA64.test(x.policyDigest)&&
    Number.isSafeInteger(x.notBefore)&&Number.isSafeInteger(x.expiresAt)&&
    x.notBefore>=0&&x.expiresAt>x.notBefore&&x.expiresAt-x.notBefore<=maxDuration&&
    now>=x.notBefore&&now<x.expiresAt;
}
export function inspectSignedParentChildSource({
  signedParent,signedChild,ownerPublicKey,verifierPublicKey,expected,
  now,revokedParentDigests=[],revokedChildDigests=[]
}={}){
  try{
    const pinned=plain(expected,expectedFields);
    if(!pinned||!Number.isSafeInteger(now)||now<0||
      !SHA40.test(pinned.baseSha)||!SHA64.test(pinned.securityDigest)||
      !SHA64.test(pinned.policyDigest)||!SHA64.test(pinned.ownerKeySha256)||
      !SHA64.test(pinned.verifierKeySha256))
      return deny('SOURCE_CONTEXT_UNPINNED');
    const parentProof=signedPayload(signedParent,ownerPublicKey);
    const childProof=signedPayload(signedChild,verifierPublicKey);
    if(!parentProof||!childProof||
       parentProof.fingerprint!==pinned.ownerKeySha256||
       childProof.fingerprint!==pinned.verifierKeySha256)
      return deny('SOURCE_SIGNATURE_OR_SIGNER');
    const p=plain(parentProof.value,parentFields),c=plain(childProof.value,childFields);
    if(!p||!c||p.schema!=='asi.standing-parent.proposal.v1'||
       c.schema!=='asi.standing-child.proposal.v1'||
       !scope(p,YEAR,now)||!scope(c,CHILD,now)||c.parentDigest!==parentProof.digest)
      return deny('SOURCE_PARENT_CHILD_SCOPE');
    const parentClasses=classes(p.approvedRoutineClasses);
    const childClasses=classes(c.approvedRoutineClasses);
    if(!parentClasses||!childClasses||!childClasses.every(x=>parentClasses.includes(x))||
      c.notBefore<p.notBefore||c.expiresAt>p.expiresAt||
      c.maxOperations>p.maxOperations||c.maxRequests>p.maxRequests||
      c.maxWrites>p.maxWrites||
      ['repo','environment','target','action','stage','baseSha','securityDigest',
        'policyDigest'].some(k=>p[k]!==c[k])||
      p.baseSha!==pinned.baseSha||
      p.securityDigest!==pinned.securityDigest||
      p.policyDigest!==pinned.policyDigest)
      return deny('SOURCE_CHILD_WIDENED_OR_REBOUND');
    if(!Array.isArray(revokedParentDigests)||!Array.isArray(revokedChildDigests)||
      [...revokedParentDigests,...revokedChildDigests].some(x=>typeof x!=='string'||!SHA64.test(x))||
      revokedParentDigests.includes(parentProof.digest)||
      revokedChildDigests.includes(childProof.digest))
      return deny('SOURCE_REVOKED_OR_UNKNOWN');
    const parent=Object.freeze({...p,digest:parentProof.digest});
    const child=Object.freeze({...c,digest:childProof.digest});
    const childLink=Object.freeze({childDigest:child.digest,parentDigest:parent.digest,
      issuerKeyDigest:pinned.verifierKeySha256,notBefore:c.notBefore,expiresAt:c.expiresAt,
      repo:c.repo,environment:c.environment,target:c.target,action:c.action,
      securityDigest:c.securityDigest,policyDigest:c.policyDigest});
    return Object.freeze({status:'SIGNED_PARENT_CHILD_SOURCE_VERIFIED',authorized:false,
      parent,child,childLink,ownerKeySha256:pinned.ownerKeySha256,
      verifierKeySha256:pinned.verifierKeySha256,baseSha:pinned.baseSha,
      expiresAt:c.expiresAt});
  }catch{return deny('SOURCE_SIGNED_EVIDENCE_UNAVAILABLE');}
}
