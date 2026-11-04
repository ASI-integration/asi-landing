import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {inspectSignedParentChildSource} from './standing-parent-signature-source.mjs';
import {inspectFiveLaneChildCheckpoint} from './host-authority.mjs';
import {inspectFiveLaneProtectedBase} from './publication-loop.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
const now=1793340000000,day=86400000,base='a'.repeat(40);
const key=()=>{const x=generateKeyPairSync('ed25519');return {
  ...x,pem:x.publicKey.export({type:'spki',format:'pem'}),
  fingerprint:hash(x.publicKey.export({type:'spki',format:'der'}))}};
const signed=(p,k)=>{const payload=JSON.stringify(p);return {
  payload,signature:sign(null,Buffer.from(payload),k.privateKey).toString('base64')}};
function fixture(){
 const owner=key(),verifier=key();
 const parent={schema:'asi.standing-parent.proposal.v1',repo:'ASI-integration/asi-landing',
  environment:'beget-staging',target:'pqukibofpo',action:'source',stage:'S4-G2',
  baseSha:base,approvedRoutineClasses:['stage4-source-maintenance'],
  securityDigest:hash('security'),policyDigest:hash('policy'),
  notBefore:now-1000,expiresAt:now-1000+365*day,
  paidApiUsd:0,maxOperations:256,maxRequests:256,maxWrites:64};
 const parentProof=signed(parent,owner),parentDigest=hash(parentProof.payload);
 const c1={...parent,schema:'asi.standing-child.proposal.v1',
   parentDigest,expiresAt:parent.notBefore+14*day,
   maxOperations:20,maxRequests:20,maxWrites:10};
 const c2={...c1,notBefore:c1.expiresAt,
   expiresAt:c1.expiresAt+14*day};
 const expected={baseSha:base,securityDigest:parent.securityDigest,
   policyDigest:parent.policyDigest,ownerKeySha256:owner.fingerprint,
   verifierKeySha256:verifier.fingerprint};
 return {owner,verifier,expected,parentProof,c1:signed(c1,verifier),
   c2:signed(c2,verifier),parentDigest};
}
test('two sequential 14-day children cryptographically verify under one 365-day parent',()=>{
 const f=fixture();
 const r1=inspectSignedParentChildSource({signedParent:f.parentProof,signedChild:f.c1,
   ownerPublicKey:f.owner.pem,verifierPublicKey:f.verifier.pem,
   expected:f.expected,now,revokedParentDigests:[],revokedChildDigests:[]});
 const r2=inspectSignedParentChildSource({signedParent:f.parentProof,signedChild:f.c2,
   ownerPublicKey:f.owner.pem,verifierPublicKey:f.verifier.pem,
   expected:f.expected,now:now+15*day,revokedParentDigests:[],revokedChildDigests:[]});
 assert.equal(r1.status,'SIGNED_PARENT_CHILD_SOURCE_VERIFIED');
 assert.equal(r2.status,'SIGNED_PARENT_CHILD_SOURCE_VERIFIED');
 assert.notEqual(r1.child.digest,r2.child.digest);
 assert.equal(r1.parent.digest,r2.parent.digest);
});
test('durable revocation checkpoint accepts renewed signed child only with sequence advancement',()=>{
 const f=fixture(),a=hash(f.c1.payload),b=hash(f.c2.payload),p=f.parentDigest;
 const old={sequence:1,parentDigest:p,childDigest:a,manifestDigest:hash('manifest-1'),
   revokedEnvelopeDigests:[]};
 const next={...old,sequence:2,manifestDigest:hash('manifest-2'),childDigest:b};
 const first=inspectFiveLaneChildCheckpoint(null,old);
 assert.equal(first.status,'FIRST_SIGNED_CHILD');
 const good=inspectFiveLaneChildCheckpoint(old,next);
 assert.equal(good.status,'SIGNED_CHILD_ROTATION');
 assert.equal(good.requiresHistoricalProof,true);
 assert.equal(good.authorized,false);
 assert.equal(inspectFiveLaneChildCheckpoint(next,old).status,'BLOCKED');
 assert.equal(inspectFiveLaneChildCheckpoint(old,{...next,sequence:1}).status,'BLOCKED');
 assert.equal(inspectFiveLaneChildCheckpoint(old,{...next,parentDigest:hash('other')}).status,'BLOCKED');
 assert.equal(inspectFiveLaneChildCheckpoint(old,{...old,childDigest:b}).status,'BLOCKED');
 assert.equal(inspectFiveLaneChildCheckpoint(old,{...old,manifestDigest:hash('fork')}).status,'BLOCKED');
 assert.equal(inspectFiveLaneChildCheckpoint(undefined,next).status,'BLOCKED');
 assert.equal(inspectFiveLaneChildCheckpoint({},next).status,'BLOCKED');
 assert.equal(inspectFiveLaneChildCheckpoint(old,{...next,revokedEnvelopeDigests:[]}).status,
   'SIGNED_CHILD_ROTATION');
 const revoked={...old,revokedEnvelopeDigests:[hash('revoked')]};
 assert.equal(inspectFiveLaneChildCheckpoint(revoked,next).status,'BLOCKED');
});
test('new child signature substituted by a stranger never counts as a valid renewal',()=>{
 const f=fixture(),attacker=key();
 const forged={...f.c2,signature:signed(JSON.parse(f.c2.payload),attacker).signature};
 const r=inspectSignedParentChildSource({signedParent:f.parentProof,signedChild:forged,
   ownerPublicKey:f.owner.pem,verifierPublicKey:f.verifier.pem,
   expected:f.expected,now:now+15*day,revokedParentDigests:[],revokedChildDigests:[]});
 assert.equal(r.authorized,false);
});
test('protected main must match exact signed base BEFORE model spends money',()=>{
 const catalog=Array.from({length:5},(_,i)=>({
  id:'lane-'+i,baseSha:base,repo:'ASI-integration/asi-landing',
  kind:'source-proposal'}));
 const main={protected:true,commit:{sha:base}};
 assert.equal(inspectFiveLaneProtectedBase({main,catalog,baseSha:base}).status,
   'BASE_PINNED');
 for(const [m,c] of [
  [{protected:false,commit:{sha:base}},catalog],
  [{protected:true,commit:{sha:'f'.repeat(40)}},catalog],
  [main,catalog.map((x,i)=>i===1?{...x,baseSha:'f'.repeat(40)}:x)],
  [main,catalog.slice(0,4)]
 ]) {
  const r=inspectFiveLaneProtectedBase({main:m,catalog:c,baseSha:base});
  assert.equal(r.status,'BLOCKED');assert.equal(r.authorized,false);
  assert.equal(r.reason,'SIGNED_PARENT_BASE_TRANSITION_REQUIRED');
 }
});
