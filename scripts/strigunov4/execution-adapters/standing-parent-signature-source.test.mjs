import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {inspectSignedParentChildSource as inspect} from './standing-parent-signature-source.mjs';

const sha=x=>createHash('sha256').update(x).digest('hex');
const now=1793340000000,day=86400000,base='a'.repeat(40);
const key=()=>{
  const pair=generateKeyPairSync('ed25519');
  return {...pair,publicPem:pair.publicKey.export({type:'spki',format:'pem'}),
    digest:sha(pair.publicKey.export({type:'spki',format:'der'}))};
};
const signed=(value,pair)=>{const payload=JSON.stringify(value);return {
  payload,signature:sign(null,Buffer.from(payload),pair.privateKey).toString('base64')}};
function fixture(){
  const owner=key(),verifier=key();
  const parent={schema:'asi.standing-parent.proposal.v1',
    repo:'ASI-integration/asi-landing',environment:'beget-staging',target:'pqukibofpo',
    action:'source',stage:'S4-G2',baseSha:base,
    approvedRoutineClasses:['stage4-source-maintenance','stage4-source-test'],
    securityDigest:sha('security'),policyDigest:sha('policy'),notBefore:now-1000,
    expiresAt:now-1000+365*day,paidApiUsd:0,
    maxOperations:256,maxRequests:256,maxWrites:64};
  const signedParent=signed(parent,owner);
  const child={...parent,schema:'asi.standing-child.proposal.v1',
    parentDigest:sha(signedParent.payload),
    approvedRoutineClasses:['stage4-source-maintenance'],
    expiresAt:now-1000+14*day,maxOperations:3,maxRequests:3,maxWrites:2};
  const expected={baseSha:base,securityDigest:parent.securityDigest,
    policyDigest:parent.policyDigest,
    ownerKeySha256:owner.digest,verifierKeySha256:verifier.digest};
  const signedChild=signed(child,verifier);
  const args={signedParent,signedChild,ownerPublicKey:owner.publicPem,
    verifierPublicKey:verifier.publicPem,expected,now,revokedParentDigests:[],
    revokedChildDigests:[]};
  return {owner,verifier,parent,child,expected,args};
}
const check=f=>inspect(f.args);
test('owner+verifier exact signatures bind parent, child and revocation in a non-authorizing result',()=>{
  const f=fixture(),r=check(f);
  assert.equal(r.status,'SIGNED_PARENT_CHILD_SOURCE_VERIFIED');
  assert.equal(r.authorized,false);
  assert.equal(r.child.parentDigest,r.parent.digest);
  assert.equal(r.childLink.parentDigest,r.parent.digest);
  assert.equal(r.childLink.issuerKeyDigest,f.verifier.digest);
  assert.equal(r.baseSha,base);
  assert(Object.isFrozen(r)&&Object.isFrozen(r.parent)&&Object.isFrozen(r.child));
});
test('ed25519 tampering, malformed signature and substituted verifier deny',()=>{
  const f=fixture(),other=key();
  const alternatives=[
    {...f.args,signedParent:{...f.args.signedParent,payload:f.args.signedParent.payload+' '}},
    {...f.args,signedChild:{...f.args.signedChild,signature:'A'.repeat(86)+'=='}},
    {...f.args,verifierPublicKey:other.publicPem},
    {...f.args,expected:{...f.expected,ownerKeySha256:other.digest}},
    {...f.args,expected:{...f.expected,verifierKeySha256:other.digest}},
    {...f.args,ownerPublicKey:other.publicPem},
  ];
  for(const args of alternatives)assert.equal(inspect(args).authorized,false);
});
test('verifier cannot replace owner by re-signing an unrelated parent or child link',()=>{
  const f=fixture(),replacement={...f.parent,maxWrites:10};
  assert.notEqual(inspect({...f.args,signedParent:signed(replacement,f.verifier)}).status,
    'SIGNED_PARENT_CHILD_SOURCE_VERIFIED');
  const wrongChild={...f.child,parentDigest:sha('not-this-parent')};
  assert.equal(inspect({...f.args,signedChild:signed(wrongChild,f.verifier)}).authorized,false);
});
test('scope widening, wrong protected base and immutable key/policy drift deny',()=>{
  const f=fixture();
  for(const changed of [
    {maxWrites:65},{maxWrites:65,maxRequests:256},
    {maxOperations:300},{expiresAt:f.parent.expiresAt+1},
    {baseSha:'b'.repeat(40)},{paidApiUsd:1},
    {stage:'S4-G1'},{repo:'foreign/foreign'},
  ]) {
    const c={...f.child,...changed};
    assert.equal(inspect({...f.args,signedChild:signed(c,f.verifier)}).authorized,false);
  }
  for(const drift of [{baseSha:'b'.repeat(40)},
    {securityDigest:sha('wrong')},{policyDigest:sha('wrong')}])
    assert.equal(inspect({...f.args,expected:{...f.expected,...drift}}).authorized,false);
});
test('expired, not-yet-valid, 365+ parent, 365+ child deny',()=>{
  const f=fixture();
  assert.equal(inspect({...f.args,now:f.child.expiresAt}).authorized,false);
  assert.equal(inspect({...f.args,now:f.parent.notBefore-1}).authorized,false);
  const p={...f.parent,expiresAt:f.parent.notBefore+366*day};
  assert.equal(inspect({...f.args,signedParent:signed(p,f.owner)}).authorized,false);
  const c={...f.child,expiresAt:f.child.notBefore+365*day+1};
  assert.equal(inspect({...f.args,signedChild:signed(c,f.verifier)}).authorized,false);
});
test('signed parent or child revocation denies; missing revocation context is no proof',()=>{
  const f=fixture();
  const p=sha(f.args.signedParent.payload),c=sha(f.args.signedChild.payload);
  assert.equal(inspect({...f.args,revokedParentDigests:[p]}).authorized,false);
  assert.equal(inspect({...f.args,revokedChildDigests:[c]}).authorized,false);
  assert.equal(inspect({...f.args,revokedChildDigests:null}).authorized,false);
  assert.equal(inspect({...f.args,revokedParentDigests:[new String(p)]}).authorized,false);
});
test('malformed context getters, duplicate signed keys and shadow signer arrays deny',()=>{
  const f=fixture();
  const ctx={...f.expected};
  Object.defineProperty(ctx,'baseSha',{enumerable:true,get(){throw Error('caller getter')}});
  assert.equal(inspect({...f.args,expected:ctx}).authorized,false);
  const p=f.args.signedParent.payload.replace('"schema":',
    '"schema":"asi.standing-parent.proposal.v1","schema":');
  // The actual noncanonical duplicated bytes are signed verbatim and rejected.
  const dup={payload:p,signature:sign(null,Buffer.from(p),f.owner.privateKey).toString('base64')};
  assert.equal(inspect({...f.args,signedParent:dup}).authorized,false);
  assert.equal(inspect({...f.args,expected:[f.expected]}).authorized,false);
});

test('owner-approved 365-day child signs once and stays valid without 14-day renewal',()=>{
  const f=fixture(),issued={...f.child,expiresAt:f.parent.expiresAt,
    maxRequests:8,maxOperations:8,maxWrites:4};
  const signedOnce=signed(issued,f.verifier);
  for(const days of [0,15,180,364]){
    const r=inspect({...f.args,signedChild:signedOnce,
      now:f.parent.notBefore+days*day+1000});
    assert.equal(r.status,'SIGNED_PARENT_CHILD_SOURCE_VERIFIED',String(days));
    assert.equal(r.authorized,false);
    assert.equal(r.child.maxWrites,4);
  }
  assert.equal(inspect({...f.args,signedChild:signedOnce,now:f.parent.expiresAt}).authorized,false);
  assert.equal(inspect({...f.args,signedChild:signedOnce,
    revokedChildDigests:[sha(signedOnce.payload)]}).authorized,false);
  assert.equal(inspect({...f.args,signedChild:signedOnce,
    revokedParentDigests:[sha(f.args.signedParent.payload)]}).authorized,false);
  const forged=signed(issued,key());
  assert.equal(inspect({...f.args,signedChild:forged}).authorized,false);
});
