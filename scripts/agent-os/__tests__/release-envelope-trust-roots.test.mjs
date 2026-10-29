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
    envelopeDigest:'c'.repeat(64),minRevocationSequence:3,
    minRevocationManifestDigest:hash('previous trusted revocation manifest'),
    priorRevokedEnvelopeDigests:[]};
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
  const readSnapshot=()=>read({expected, now:NOW,clock:()=>NOW,protectedReader});
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
    m=>{m.sequence=2;},m=>{m.expiresAt=m.issuedAt+15*86400000;}]) {
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
  const r=await read({expected:x.expected,now:NOW,clock:()=>NOW,protectedReader});
  assert.equal(r.reason,'TRUST_SNAPSHOT_CHANGED');assert.equal(r.authorized,false);
});

test('unavailable protected file denies without disclosing filesystem error',async()=>{
  const x=fixture(), r=await read({expected:x.expected,now:NOW,clock:()=>NOW,
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

test('mutating expected trust key or revocation floor during async read cannot downgrade pinned context',async()=>{
  for (const mutate of [x=>x.expected.verifierKeySha256='a'.repeat(64),
    x=>x.expected.minRevocationSequence=0,
    x=>x.expected.envelopeDigest='f'.repeat(64)]) {
    const x=fixture();let n=0;
    const protectedReader=async p=>{if(++n===1)mutate(x);return x.protectedReader(p);};
    const r=await read({expected:x.expected,now:NOW,clock:()=>NOW,protectedReader});
    assert.deepEqual(r,{status:'BLOCKED',reason:'TRUST_CONTEXT_CHANGED',authorized:false});
  }
});

test('revocation expiry after first read, invalid or regressed clock and overlong reads all deny',async()=>{
  for(const finalAt of [NOW+86400000, NOW-1, NOW+31000, NaN]){
    const x=fixture();const r=await read({expected:x.expected,now:NOW,
      clock:()=>finalAt,protectedReader:x.protectedReader});
    assert.deepEqual(r,{status:'BLOCKED',reason:'TRUST_REVOCATION_STALE',authorized:false});
  }
});

test('fresh completion time is the reported observation and never grants authority',async()=>{
  const x=fixture();const r=await read({expected:x.expected,now:NOW,
    clock:()=>NOW+10,protectedReader:x.protectedReader});
  assert.equal(r.status,'PROTECTED_TRUST_VERIFIED');
  assert.equal(r.observedAt,NOW+10);
  assert.equal(r.authorized,false);
});


test('same revision cannot be rewritten even with a valid issuer signature',async()=>{
  const x=fixture();
  x.expected.minRevocationSequence=4;
  x.expected.minRevocationManifestDigest=hash(JSON.stringify(x.manifest));
  assert.equal((await x.readSnapshot()).status,'PROTECTED_TRUST_VERIFIED');
  x.manifest.revokedEnvelopeDigests=['a'.repeat(64)];x.resign();
  assert.equal((await x.readSnapshot()).reason,'TRUST_REVOCATION_EQUIVOCATION');
});

test('newer signed manifest cannot erase a previously persisted revocation',async()=>{
  const x=fixture(),old='a'.repeat(64);
  x.expected.priorRevokedEnvelopeDigests=[old];
  assert.equal((await x.readSnapshot()).reason,'TRUST_REVOCATION_ERASURE');
  x.manifest.revokedEnvelopeDigests=[old];x.resign();
  const r=await x.readSnapshot();
  assert.equal(r.status,'PROTECTED_TRUST_VERIFIED');
  assert.equal(r.revocationCheckpoint.sequence,4);
  assert.deepEqual(r.revocationCheckpoint.revokedEnvelopeDigests,[old]);
  assert.equal(Object.isFrozen(r.revocationCheckpoint),true);
  x.expected.priorRevokedEnvelopeDigests=[old,x.expected.envelopeDigest];
  assert.equal((await x.readSnapshot()).reason,'TRUST_REVOCATION_ERASURE');
  x.manifest.revokedEnvelopeDigests=[old,x.expected.envelopeDigest].sort();x.resign();
  assert.equal((await x.readSnapshot()).reason,'TRUST_ENVELOPE_REVOKED');
});

test('invalid protected revocation history and sequence anchor deny',async()=>{
  for(const edit of [x=>x.expected.minRevocationManifestDigest='bad',
    x=>delete x.expected.priorRevokedEnvelopeDigests,
    x=>x.expected.priorRevokedEnvelopeDigests=['z'.repeat(64)],
    x=>x.expected.priorRevokedEnvelopeDigests=['a'.repeat(64),'a'.repeat(64)],
    x=>x.expected.priorRevokedEnvelopeDigests=['f'.repeat(64),'a'.repeat(64)]]) {
    const x=fixture();edit(x);
    assert.equal((await x.readSnapshot()).reason,'TRUST_CONTEXT');
  }
});

test('historical revocation list mutated across awaits fails closed',async()=>{
  const x=fixture(),old='a'.repeat(64);
  x.expected.priorRevokedEnvelopeDigests=[old];x.manifest.revokedEnvelopeDigests=[old];x.resign();
  let n=0;
  const reader=async p=>{if(++n===1)x.expected.priorRevokedEnvelopeDigests.splice(0);
    return x.protectedReader(p);};
  const r=await read({expected:x.expected,now:NOW,clock:()=>NOW,protectedReader:reader});
  assert.deepEqual(r,{status:'BLOCKED',reason:'TRUST_CONTEXT_CHANGED',authorized:false});
});


test('boxed, array, object and coercible expected digest values deny before any protected read',async()=>{
  const good='c'.repeat(64);
  for (const field of ['issuerKeySha256','verifierKeySha256','envelopeDigest','minRevocationManifestDigest']) {
    for (const value of [new String(good), [good], {toString:()=>good}, {valueOf:()=>good}]) {
      const x=fixture();x.expected[field]=value;
      assert.deepEqual(await x.readSnapshot(),
        {status:'BLOCKED',reason:'TRUST_CONTEXT',authorized:false});
      assert.equal(x.reads(),0);
    }
  }
});

test('accessor digest, inherited digest and accessor object properties never execute getters',async()=>{
  for (const field of ['envelopeDigest','issuerKeySha256','minRevocationManifestDigest']) {
    let executed=false;const x=fixture();
    Object.defineProperty(x.expected,field,{enumerable:true,configurable:true,
      get(){executed=true;return 'c'.repeat(64);}});
    assert.equal((await x.readSnapshot()).reason,'TRUST_CONTEXT');
    assert.equal(executed,false);assert.equal(x.reads(),0);
  }
  const x=fixture(),digest=x.expected.envelopeDigest;
  delete x.expected.envelopeDigest;
  Object.setPrototypeOf(x.expected,{envelopeDigest:digest});
  assert.equal((await x.readSnapshot()).reason,'TRUST_CONTEXT');
  assert.equal(x.reads(),0);
});

test('boxed, object, array and getter historical revocation entries deny before any reads',async()=>{
  const good='a'.repeat(64);
  for (const value of [new String(good),[good],{toString:()=>good},0,null]) {
    const x=fixture();x.expected.priorRevokedEnvelopeDigests=[value];
    assert.equal((await x.readSnapshot()).reason,'TRUST_CONTEXT');
    assert.equal(x.reads(),0);
  }
  let executed=false;const y=fixture(),history=[good];
  Object.defineProperty(history,'0',{configurable:true,enumerable:true,
    get(){executed=true;return good;}});
  y.expected.priorRevokedEnvelopeDigests=history;
  assert.equal((await y.readSnapshot()).reason,'TRUST_CONTEXT');
  assert.equal(executed,false);assert.equal(y.reads(),0);
  const z=fixture();z.expected.priorRevokedEnvelopeDigests=new Array(1);
  assert.equal((await z.readSnapshot()).reason,'TRUST_CONTEXT');
});

test('signed JSON revocation entries must be primitive hex strings, not arrays, numbers or objects',async()=>{
  for(const value of [0,null,['a'.repeat(64)],{digest:'a'.repeat(64)}]){
    const x=fixture();x.manifest.revokedEnvelopeDigests=[value];x.resign();
    assert.deepEqual(await x.readSnapshot(),
      {status:'BLOCKED',reason:'TRUST_REVOCATION_FORMAT',authorized:false});
  }
});

test('mid-read accessor swap in expected or historical array fails as changed context',async()=>{
  for (const mutate of [
    x=>Object.defineProperty(x.expected,'envelopeDigest',{configurable:true,get(){throw Error('getter must never run');}}),
    x=>Object.defineProperty(x.expected.priorRevokedEnvelopeDigests,'0',
      {configurable:true,get(){throw Error('history getter must never run');}})
  ]) {
    const x=fixture(),old='a'.repeat(64);
    x.expected.priorRevokedEnvelopeDigests=[old];
    x.manifest.revokedEnvelopeDigests=[old];x.resign();
    let n=0;
    const reader=async p=>{if(++n===1)mutate(x);return x.protectedReader(p);};
    const r=await read({expected:x.expected,now:NOW,clock:()=>NOW,protectedReader:reader});
    assert.deepEqual(r,{status:'BLOCKED',reason:'TRUST_CONTEXT_CHANGED',authorized:false});
  }
});

test('positive cumulative history with two primitive revoked digests stays non-authorizing',async()=>{
  const x=fixture(),history=['a'.repeat(64),'b'.repeat(64)];
  x.expected.priorRevokedEnvelopeDigests=history;
  x.manifest.revokedEnvelopeDigests=[...history];x.resign();
  const r=await x.readSnapshot();
  assert.equal(r.status,'PROTECTED_TRUST_VERIFIED');
  assert.equal(r.authorized,false);
  assert.deepEqual(r.revocationCheckpoint.revokedEnvelopeDigests,history);
  assert.equal(Object.isFrozen(r.revocationCheckpoint.revokedEnvelopeDigests),true);
  assert.equal(x.reads(),6);
});
