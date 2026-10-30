/** Source-only parent/child verification for #551. NO signer, renewal, admission or transport.
 * A future protected verifier must provide pinned keys, fresh revocation and
 * durable Publisher ledger evidence from a trusted channel, never from a PR.
 */
import {createHash,createPublicKey,verify} from 'node:crypto';

export const PARENT_MAX_MS=365*86400000;
export const CHILD_MAX_MS=14*86400000;
const REPO='ASI-integration/asi-landing',HOST='pqukibofpo',OWNER=207600140;
const LANES=Object.freeze([
  ['engine','asi/beget-one-engine-20261028'],
  ['ru-auth','feat/ru-unified-auth-20261029'],
  ['p0-integration','asi/standing-delegation-551'],
  ['p0-trust','asi/p0-trusted-evidence-worker-20261029'],
  ['p0-atomic-budget','asi/p0-atomic-budget-worker-20261029'],
]);
const DIGEST=/^[a-f0-9]{64}$/,IDENT=/^[a-z0-9][a-z0-9-]{7,79}$/;
const hash=b=>createHash('sha256').update(b).digest('hex');
const fail=reason=>Object.freeze({status:'BLOCKED',reason,authorized:false});
const own=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&
  Object.getPrototypeOf(v)===Object.prototype&&
  Object.keys(v).sort().join('|')===[...keys].sort().join('|');
const num=v=>Number.isSafeInteger(v)&&v>=0;
const digest=v=>typeof v==='string'&&DIGEST.test(v);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const lanes=arr=>Array.isArray(arr)&&arr.length===5&&
  arr.every((x,i)=>own(x,['id','branch'])&&
    x.id===LANES[i][0]&&x.branch===LANES[i][1]);
function inspectSigned(envelope,pem,pin,domain) {
  if(!own(envelope,['payload','signature'])||typeof envelope.payload!=='string'||
     envelope.payload.length>30000||typeof envelope.signature!=='string'||
     !/^[A-Za-z0-9+/]{86}==$/.test(envelope.signature)||!digest(pin)) throw Error('ENVELOPE_INVALID');
  const key=createPublicKey(pem);
  if(key.asymmetricKeyType!=='ed25519'||
     hash(key.export({type:'spki',format:'der'}))!==pin) throw Error('SIGNER_NOT_PINNED');
  if(!verify(null,Buffer.concat([Buffer.from(domain),Buffer.from([0]),Buffer.from(envelope.payload)]),
      key,Buffer.from(envelope.signature,'base64')))throw Error('INVALID_SIGNATURE');
  const object=JSON.parse(envelope.payload);
  if(JSON.stringify(object)!==envelope.payload)throw Error('NONCANONICAL_PAYLOAD');
  return object;
}
/**
 * Every caller-supplied value is UNTRUSTED here, including pinned keys, ledger
 * and revocations. Even a positive result cannot grant authority. The live
 * host must reread these from authenticated protected sources under one lock.
 */
export function inspectStandingYearLease({parentEnvelope,childEnvelope,ownerPublicKey,
    issuerPublicKey,pinnedOwnerKeySha256,pinnedIssuerKeySha256,
    trustedLedger,revokedParentDigests,now}={}) {
  try {
    if(!num(now)||!digest(pinnedOwnerKeySha256)||!digest(pinnedIssuerKeySha256)||
       pinnedOwnerKeySha256===pinnedIssuerKeySha256) return fail('TRUST_INPUTS_INVALID');
    const p=inspectSigned(parentEnvelope,ownerPublicKey,pinnedOwnerKeySha256,
      'ASI_STANDING_PARENT_V1');
    const c=inspectSigned(childEnvelope,issuerPublicKey,pinnedIssuerKeySha256,
      'ASI_STANDING_CHILD_V1');
    const parentHash=hash(parentEnvelope.payload),childHash=hash(childEnvelope.payload);
    if(!own(p,['schema','repository','host','ownerId','ownerKeySha256',
       'childIssuerKeySha256','notBefore','expiresAt','ledgerId','lanes',
       'maxRequests','maxWrites','maxTasks','paidUsd','revocationSequence'])||
       p.schema!=='asi.standing-owner-parent.v1'||p.repository!==REPO||
       p.host!==HOST||p.ownerId!==OWNER||p.ownerKeySha256!==pinnedOwnerKeySha256||
       p.childIssuerKeySha256!==pinnedIssuerKeySha256||!num(p.notBefore)||
       !num(p.expiresAt)||p.notBefore>now||now>=p.expiresAt||
       p.expiresAt<=p.notBefore||p.expiresAt-p.notBefore>PARENT_MAX_MS||
       !IDENT.test(p.ledgerId)||!lanes(p.lanes)||p.paidUsd!==0||
       !num(p.revocationSequence)||!num(p.maxRequests)||!num(p.maxWrites)||
       !num(p.maxTasks)||p.maxRequests<1||p.maxWrites>p.maxRequests||
       p.maxTasks>5||p.maxTasks<1||p.maxRequests>50000||p.maxWrites>64)\n       return fail('PARENT_SCOPE_OR_EXPIRY');
    if(!Array.isArray(revokedParentDigests)||
       revokedParentDigests.some(d=>!digest(d))||
       new Set(revokedParentDigests).size!==revokedParentDigests.length||
       revokedParentDigests.includes(parentHash))return fail('PARENT_REVOKED_OR_REVOCATION_UNKNOWN');
    if(!own(c,['schema','parentSha256','repository','host','ledgerId',
       'sequence','notBefore','expiresAt','lanes','maxRequests','maxWrites',
       'maxTasks','paidUsd','revocationSequence'])||
       c.schema!=='asi.standing-child-lease.v1'||c.parentSha256!==parentHash||
       c.repository!==p.repository||c.host!==p.host||c.ledgerId!==p.ledgerId||
       !num(c.sequence)||c.sequence<1||!num(c.notBefore)||!num(c.expiresAt)||
       c.notBefore< p.notBefore||c.notBefore>now||now>=c.expiresAt||
       c.expiresAt>p.expiresAt||c.expiresAt<=c.notBefore||
       c.expiresAt-c.notBefore>CHILD_MAX_MS||c.paidUsd!==0||
       c.revocationSequence!==p.revocationSequence||
       !Array.isArray(c.lanes)||c.lanes.length<1||c.lanes.length>5||
       new Set(c.lanes).size!==c.lanes.length||
       c.lanes.some(id=>!p.lanes.some(l=>l.id===id))||
       !num(c.maxRequests)||!num(c.maxWrites)||!num(c.maxTasks)||
       c.maxRequests>p.maxRequests||c.maxWrites>p.maxWrites||
       c.maxTasks>p.maxTasks||c.maxRequests<1||c.maxWrites>c.maxRequests||
       c.maxTasks<1) return fail('CHILD_SCOPE_OR_EXPIRY');
    // Snapshot must come from the SAME existing durable Publisher transaction.
    // Never initialize a fresh ledger on renewal or refund consumed effects.
    if(!own(trustedLedger,['ledgerId','parentSha256','revocationSequence',
       'requestsUsed','writesUsed','tasksUsed','latestLeaseSequence','latestLeaseSha256'])||
       trustedLedger.ledgerId!==p.ledgerId||trustedLedger.parentSha256!==parentHash||
       trustedLedger.revocationSequence!==p.revocationSequence||
       !num(trustedLedger.requestsUsed)||!num(trustedLedger.writesUsed)||
       !num(trustedLedger.tasksUsed)||trustedLedger.requestsUsed>p.maxRequests||
       trustedLedger.writesUsed>p.maxWrites||trustedLedger.tasksUsed>p.maxTasks||
       !num(trustedLedger.latestLeaseSequence)||
       !(trustedLedger.latestLeaseSha256===null||digest(trustedLedger.latestLeaseSha256))||
       c.sequence<trustedLedger.latestLeaseSequence||
       (c.sequence===trustedLedger.latestLeaseSequence&&
        trustedLedger.latestLeaseSha256!==childHash))
       return fail('DURABLE_LEDGER_OR_REPLAY_UNVERIFIED');
    return Object.freeze({status:'SOURCE_POLICY_ELIGIBLE',authorized:false,
      executionAllowed:false,automaticRenewalPerformed:false,parentSha256:parentHash,
      childSha256:childHash,expiresAt:c.expiresAt,remainingBudget:Object.freeze({
        requests:p.maxRequests-trustedLedger.requestsUsed,
        writes:p.maxWrites-trustedLedger.writesUsed,
        tasks:p.maxTasks-trustedLedger.tasksUsed})});
  }catch{return fail('SIGNATURE_OR_POLICY_UNVERIFIED');}
}
