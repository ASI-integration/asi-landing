import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createHash,sign} from 'node:crypto';
import {readProtectedStandingTrustSnapshot as read} from '../release-envelope-trust-roots.mjs';

const hash = x => createHash('sha256').update(x).digest('hex');
const key = () => {
  const x=generateKeyPairSync('ed25519');
  return {privateKey:x.privateKey, pem:x.publicKey.export({type:'spki',format:'pem'}),
    digest:hash(x.publicKey.export({type:'spki',format:'der'}))};
};
const signed = (obj, signer) => {
  const payload=JSON.stringify(obj);
  return JSON.stringify({payload,signature:sign(null,Buffer.from(payload),signer.privateKey).toString('base64')});
};
const NOW=1793260000000;
const ENV={repository:'ASI-integration/asi-landing',environment:'beget-staging',target:'pqukibofpo'};
function fixture() {
  const issuer=key(), verifier=key();
  const expected={...ENV,issuerKeySha256:issuer.digest,verifierKeySha256:verifier.digest,
    envelopeDigest:'c'.repeat(64),minRevocationSequence:4};
  const manifest={schema:'asi.release-envelope-revocations.v1',...ENV,
    issuerKeySha256:issuer.digest,verifierKeySha256:verifier.digest,
    sequence:4,issuedAt:NOW-2000,expiresAt:NOW+86400000,revokedEnvelopeDigests:[]};
  const documents={
    'owner-public.pem':issuer.pem,
    'standing-verifier-public.pem':verifier.pem,
    'standing-revocations.json':signed(manifest,issuer),
  };
  let reads=0;
  const protectedReader=async p=>{ reads++; const name=p.split('/').at(-1);
    if (!Object.hasOwn(documents,name)) throw Error('unexpected filename'); return documents[name]; };
  const readSnapshot=()=>read({expected, now:NOW,protectedReader});
  const resign=()=>{documents['standing-revocations.json']=signed(manifest,issuer);};
  return {issuer,verifier,expected,manifest,documents,readSnapshot,resign,protectedReader,
    reads:()=>reads};
}

test('read-only pinned issuer and independent verifier prove signed local revocation state, never authority',async()=>{
  const x=fixture(), r=await x.readSnapshot();
  assert.equal(r.status,'PROTECTED_TRUST_VERIFIED');
  assert.equal(r.authorized,false);
  assert.equal(r.revocationSequence,4);
  assert.equal(r.issuerKeySha256,x.issuer.digest);
  assert.equal(r.verifierKeySha256,x.verifier.digest);
  assert.equal(x.reads(),6); // independent read twice, no writes or network
  assert.equal(Object.hasOwn(r,'privateKey'),false);
});

test('expired, future-dated and rollback revocation manifests deny',async()=>{
  for(const edit of [m=>{m.expiresAt=NOW;},m=>{m.issuedAt=NOW+1;},
    m=>{m.sequence=3;},m=>{m.expiresAt=m.issuedAt+15*86400000;}]) {
    const x=fixture();edit(x.manifest);x.resign();
    assert.deepEqual(await x.readSnapshot(),{status:'BLOCKED',reason:'TRUST_REVOCATION_STALE',authorized:false});
  }
});

test('envelope digest revocation denies even while signed manifest is otherwise valid',async()=>{
  const x=fixture();x.manifest.revokedEnvelopeDigests=[x.expected.envelopeDigest];x.resign();
  assert.equal((await x.readSnapshot()).reason,'TRUST_ENVELOPE_REVOKED');
});

test('unsigned and cross-issuer revocations fail, no signature bypass',async()=>{
  const x=fixture();x.documents['standing-revocations.json']=signed(x.manifest,key());
  assert.equal((await x.readSnapshot()).reason,'TRUST_SNAPSHOT_UNAVAILABLE');
  x.documents['standing-revocations.json']=JSON.stringify({...JSON.parse(signed(x.manifest,x.issuer)),signature:'A'.repeat(86)+'=='});
  assert.equal((await x.readSnapshot()).reason,'TRUST_SNAPSHOT_UNAVAILABLE');
});

test('wrong pinned fingerprint and same signer/verifier fail closed',async()=>{
  const x=fixture();x.expected.verifierKeySha256='a'.repeat(64);
  assert.equal((await x.readSnapshot()).reason,'TRUST_KEY_PROVENANCE');
  const y=fixture();y.expected.verifierKeySha256=y.expected.issuerKeySha256;
  assert.equal((await y.readSnapshot()).reason,'TRUST_CONTEXT');
});

test('revocations bind specific repository, environment, target, and both key identities',async()=>{
  for (const [field,value] of [['repository','else/repo'],['environment','production'],
    ['target','other-host'],['verifierKeySha256','f'.repeat(64)]]) {
    const x=fixture();x.manifest[field]=value;x.resign();
    assert.equal((await x.readSnapshot()).reason,'TRUST_REVOCATION_BINDING');
  }
});

test('revocation digest list must be strictly ordered, unique and hashes',async()=>{
  for (const list of [['f'.repeat(64),'a'.repeat(64)],['a'.repeat(64),'a'.repeat(64)],['oops']]) {
    const x=fixture();x.manifest.revokedEnvelopeDigests=list;x.resign();
    assert.equal((await x.readSnapshot()).reason,'TRUST_REVOCATION_FORMAT');
  }
});

test('changed protected snapshot during read fails closed',async()=>{
  const x=fixture();let n=0;
  const protectedReader=async p=>{
    n++;
    if(n===6)return 'replaced file during read';
    return x.protectedReader(p);
  };
  const r=await read({expected:x.expected,now:NOW,protectedReader});
  assert.equal(r.reason,'TRUST_SNAPSHOT_CHANGED');assert.equal(r.authorized,false);
});

test('unavailable protected file denies without disclosing filesystem error',async()=>{
  const x=fixture(), r=await read({expected:x.expected,now:NOW,
    protectedReader:async()=>{throw Error('DO NOT LOG PRIVATE CONTEXT');}});
  assert.deepEqual(r,{status:'BLOCKED',reason:'TRUST_SNAPSHOT_UNAVAILABLE',authorized:false});
});

test('untrusted caller cannot change target, empty fingerprint, or revision floor',async()=>{
  const x=fixture();x.expected.target='wrong';
  assert.equal((await x.readSnapshot()).reason,'TRUST_CONTEXT');
  x.expected.target='pqukibofpo';x.expected.minRevocationSequence=-1;
  assert.equal((await x.readSnapshot()).reason,'TRUST_CONTEXT');
  x.expected.minRevocationSequence=0;x.expected.issuerKeySha256='bad';
  assert.equal((await x.readSnapshot()).reason,'TRUST_CONTEXT');
});
