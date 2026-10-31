// Inert synthetic signer keys and real temporary Git objects. No live effects.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {readProtectedGitStandingTrustSnapshot as read} from '../release-envelope-git-trust.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
const key=()=>{const k=generateKeyPairSync('ed25519');return {...k,
  pem:k.publicKey.export({type:'spki',format:'pem'}),fingerprint:hash(k.publicKey.export({type:'spki',format:'der'}))};};
const issuer=key(),verifier=key();
const signValue=(value,k=issuer)=>{const payload=JSON.stringify(value);
  return JSON.stringify({payload,signature:sign(null,Buffer.from(payload),k.privateKey).toString('base64')});};
const NOW=Date.parse('2026-10-30T02:30:00Z'),ED='e'.repeat(64),OLD='a'.repeat(64);
const DIR='docs/agent-os/standing-trust/';
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'asi-git-trust-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const git=(...args)=>execFileSync('/usr/bin/git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git('init');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
  fs.mkdirSync(path.join(root,DIR),{recursive:true});
  const manifest={schema:'asi.release-envelope-revocations.v1',repository:'ASI-integration/asi-landing',
    environment:'beget-staging',target:'pqukibofpo',issuerKeySha256:issuer.fingerprint,
    verifierKeySha256:verifier.fingerprint,sequence:3,issuedAt:NOW-1000,expiresAt:NOW+60000,
    revokedEnvelopeDigests:[OLD]};
  const registry={schema:'asi.standing-trust-registry.v1',repository:manifest.repository,
    environment:manifest.environment,target:manifest.target,issuerKeySha256:issuer.fingerprint,
    verifierKeySha256:verifier.fingerprint,minRevocationSequence:3,
    minRevocationManifestDigest:hash(JSON.stringify(manifest)),priorRevokedEnvelopeDigests:[OLD]};
  const write=(name,value)=>fs.writeFileSync(path.join(root,DIR+name),value);
  write('owner-public.pem',issuer.pem);write('standing-verifier-public.pem',verifier.pem);
  let baseSha;
  const commit=()=>{git('add','.');git('-c','core.hooksPath=/dev/null','commit','--allow-empty','-m','fixture');baseSha=git('rev-parse','HEAD');return baseSha;};
  const save=()=>{write('registry.json',JSON.stringify(registry));write('standing-revocations.json',signValue(manifest));return commit();};
  save();let calls=0,observe=()=>({name:'main',protected:true,commit:{sha:baseSha}}),at=NOW;
  const input=()=>({repoRoot:root,baseSha,envelopeDigest:ED,
    priorCheckpoint:{sequence:3,manifestDigest:hash(JSON.stringify(manifest)),revokedEnvelopeDigests:[OLD]},
    clock:()=>at,readCurrentMain:async signal=>{assert(signal instanceof AbortSignal);calls++;return observe(calls);}});
  return {root,git,write,commit,save,manifest,registry,input,get baseSha(){return baseSha;},get calls(){return calls;},
    observe:f=>{observe=f;},time:v=>{at=v;}};
}
test('fixed Git bytes and signed trust succeed; hostile working-tree configuration is ignored',async t=>{
  const f=fixture(t);f.write('registry.json','{"enabled":true}');f.write('owner-public.pem','not a key');
  const r=await read(f.input());assert.equal(r.status,'PROTECTED_GIT_TRUST_VERIFIED',JSON.stringify(r));
  assert.equal(r.authorized,false);assert.equal(r.baseSha,f.baseSha);assert.equal(r.revocationSequence,3);
  assert.equal(r.issuerKeySha256,issuer.fingerprint);assert.equal(f.calls,2);assert.match(r.registryBlobSha,/^[a-f0-9]{40}$/);
});
test('missing trust file, executable mode and symlink cannot stand in for fixed regular blobs',async t=>{
  for(const kind of ['missing','mode','symlink']){
    const f=fixture(t),file=path.join(f.root,DIR+'owner-public.pem');
    if(kind==='mode')fs.chmodSync(file,0o755);
    else {fs.unlinkSync(file);if(kind==='symlink')fs.symlinkSync('standing-verifier-public.pem',file);}
    f.commit();assert.equal((await read(f.input())).status,'BLOCKED');
  }
});
test('registry rejects wrong target, signer mismatch, unknown fields and noncanonical JSON',async t=>{
  for(const mutate of [r=>r.target='other',r=>r.verifierKeySha256='b'.repeat(64),r=>r.envelopeDigest=ED,r=>delete r.schema]){
    const f=fixture(t);mutate(f.registry);f.save();assert.equal((await read(f.input())).status,'BLOCKED');
  }
  const f=fixture(t);f.write('registry.json',JSON.stringify(f.registry,null,2));f.commit();assert.equal((await read(f.input())).status,'BLOCKED');
});
test('tampered revocation signature or another signer fails',async t=>{
  for(const raw of [signValue({},verifier),JSON.stringify({payload:JSON.stringify({}),signature:'A'.repeat(86)+'=='})]){
    const f=fixture(t);f.write('standing-revocations.json',raw);f.commit();assert.equal((await read(f.input())).status,'BLOCKED');
  }
});
test('expired and current-envelope revocations fail closed',async t=>{
  for(const revoke of [false,true]){
    const f=fixture(t);if(revoke)f.manifest.revokedEnvelopeDigests.push(ED);else f.manifest.expiresAt=NOW;
    f.registry.minRevocationManifestDigest=hash(JSON.stringify(f.manifest));f.save();
    assert.equal((await read(f.input())).status,'BLOCKED');
  }
});
test('durable checkpoint cannot be rolled back, equivocated or erased by registry',async t=>{
  for(const mutation of [p=>p.sequence=4,p=>p.manifestDigest='b'.repeat(64),p=>p.revokedEnvelopeDigests.push('b'.repeat(64))]){
    const f=fixture(t),input=f.input();mutation(input.priorCheckpoint);assert.equal((await read(input)).reason,'GIT_TRUST_ROLLBACK');
  }
  const f=fixture(t),prior=f.input().priorCheckpoint;f.manifest.sequence=4;
  f.registry.minRevocationSequence=4;f.registry.minRevocationManifestDigest=hash(JSON.stringify(f.manifest));f.save();
  assert.equal((await read({...f.input(),priorCheckpoint:prior})).status,'PROTECTED_GIT_TRUST_VERIFIED');
});
test('wrong main before read, moved main after read, malformed observation and failure block',async t=>{
  for(const mode of ['before','after','malformed','failure','unprotected','missing-protection']){
    const f=fixture(t);f.observe(n=>{if(mode==='failure')throw Error('private provider error');
      if(mode==='malformed')return {name:'other',commit:{sha:f.baseSha}};
      if(mode==='unprotected')return {name:'main',protected:false,commit:{sha:f.baseSha}};
      if(mode==='missing-protection')return {name:'main',commit:{sha:f.baseSha}};
      return {name:'main',protected:true,commit:{sha:mode==='before'||n===2?'f'.repeat(40):f.baseSha}};});
    const r=await read(f.input());assert.equal(r.status,'BLOCKED');assert(!JSON.stringify(r).includes('private provider'));
  }
});
test('late revocation expiry and clock rollback at final provider observation block',async t=>{
  for(const time of [NOW-1,NOW+60000]){
    const f=fixture(t);f.observe(n=>{if(n===2)f.time(time);return {name:'main',protected:true,commit:{sha:f.baseSha}};});
    assert.equal((await read(f.input())).reason,'GIT_TRUST_TIME');
  }
});
test('missing durable state, accessors, boxed digests and mutable caller checkpoint cannot gain trust',async t=>{
  const f=fixture(t);let getters=0;
  const accessor=f.input();Object.defineProperty(accessor,'envelopeDigest',{get(){getters++;return ED;}});
  const nested=f.input();Object.defineProperty(nested.priorCheckpoint,'sequence',{get(){getters++;return 3;}});
  for(const input of [{...f.input(),priorCheckpoint:undefined},accessor,nested,
    {...f.input(),envelopeDigest:new String(ED)},{...f.input(),clock:null}])assert.equal((await read(input)).status,'BLOCKED');
  assert.equal(getters,0);assert.equal(f.calls,0);
  const input=f.input();f.observe(()=>{input.priorCheckpoint.sequence=0;return {name:'main',protected:true,commit:{sha:f.baseSha}};});
  assert.equal((await read(input)).status,'PROTECTED_GIT_TRUST_VERIFIED');
});
test('replacement refs cannot substitute trust; corrupt commit, tree and blob contents block',async t=>{
  const f=fixture(t),old=f.baseSha;f.registry.target='other';f.save();
  f.git('replace',old,f.baseSha);f.observe(()=>({name:'main',protected:true,commit:{sha:old}}));
  assert.equal((await read({...f.input(),baseSha:old})).status,'PROTECTED_GIT_TRUST_VERIFIED');
  for(const type of ['commit','tree','blob']){
    const g=fixture(t),oid=type==='commit'?g.baseSha:g.git('rev-parse',g.baseSha+':'+
      (type==='tree'?DIR.slice(0,-1):DIR+'registry.json'));
    const bytes=execFileSync('/usr/bin/git',['cat-file',type,oid],{cwd:g.root});
    bytes[bytes.length-1]^=1;
    const objectPath=path.join(g.root,'.git/objects',oid.slice(0,2),oid.slice(2));
    fs.chmodSync(objectPath,0o600);
    fs.writeFileSync(objectPath,
      deflateSync(Buffer.concat([Buffer.from(type+' '+bytes.length+'\0'),bytes])));
    assert.equal((await read(g.input())).status,'BLOCKED');
  }
});
