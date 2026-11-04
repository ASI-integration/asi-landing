import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {previewOwnerFinalManifest,verifyOwnerTechnicalEnvelope,
  finalizeOwnerPackage,OWNER_WIRING} from './beget-v2-owner-finalize.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
function fixture(){
 const modules=[
   'scripts/strigunov4/execution-adapters/host-runtime.mjs',
   'scripts/strigunov4/execution-adapters/beget-native-source-checks.mjs',
   ...Array.from({length:33},(_,i)=>'scripts/strigunov4/source-fixture-'+i+'.mjs')
 ];
 const files=modules.map((p,i)=>({path:p,sha256:sha('export const v = '+i+';\n')}));
 const catalog='[{"task":"test"}]\n',unit='[Service]\nUser=asi-engine\n';
 const installer='# one installation only\n';
 const manifest={schema:'asi.beget-engine-source.v1',
   sourceSha:'a'.repeat(40),baseSha:'b'.repeat(40),installable:false,
   catalogSha256:sha(catalog),unitSha256:sha(unit),installerSha256:sha(installer),
   files};
 return {manifest,catalog,unit,installer};
}
function acceptance(m,key){
 const data={
  schema:'asi.beget-owner-native-technical-acceptance.v1',
  mode:'OWNER_SIGNED_TECHNICAL_ACCEPTANCE',
  decision:'ACCEPT_EXACT_RELEASE_FOR_INSTALL',
  host:'pqukibofpo',unit:'asi-strigunov-agent.service',
  sourceSha:m.sourceSha,manifestSha256:sha(previewOwnerFinalManifest(m)),
  catalogSha256:m.catalogSha256,oldManifestSha256:'c'.repeat(64),
  oldStateDigests:Object.fromEntries(Array.from({length:6},(_,i)=>['state-'+i,'d'.repeat(64)])),
  validationRunId:112233,
  nativeFiveLaneAdmissionTested:true,realModelBudgetGateTested:true,
  restoreReplayProhibitionTested:true,
  testEvidenceSha256:{node:'e'.repeat(64),installer:'f'.repeat(64),
    serviceUidSandbox:'1'.repeat(64)}
 };
 const payload=JSON.stringify(data);
 return {payload,signature:sign(null,Buffer.from(payload),key).toString('base64')};
}
test('owner technical marker remains source-only proposal until authentic signature',()=>{
 const {manifest}=fixture(),proposed=previewOwnerFinalManifest(manifest);
 assert.equal(JSON.parse(proposed).nativeFiveLaneWiring,OWNER_WIRING);
 assert.equal(JSON.parse(proposed).installable,false);
 assert.equal(manifest.nativeFiveLaneWiring,undefined);
 for(const change of [
  m=>m.installable=true,m=>m.nativeFiveLaneWiring='REVIEWED_PROTECTED_ACTIVE_RUNTIME_V1',
  m=>m.files.pop(),m=>m.files[0].sha256='n',
  m=>m.files[1].path=m.files[0].path]){
  const x=structuredClone(manifest);change(x);
  assert.throws(()=>previewOwnerFinalManifest(x),/OWNER_FINALIZE_/);
 }
});
test('real test-key signature verifies exact source; forged, changed, or unknown owner denies',()=>{
 const {manifest}=fixture(),pair=generateKeyPairSync('ed25519');
 const pem=pair.publicKey.export({type:'spki',format:'pem'});
 const fp=sha(pair.publicKey.export({type:'spki',format:'der'}));
 const envelope=acceptance(manifest,pair.privateKey);
 const args={envelope,ownerPublicKey:pem,
   trustedOwnerFingerprint:fp,finalManifestRaw:previewOwnerFinalManifest(manifest),
   sourceSha:manifest.sourceSha};
 assert.equal(verifyOwnerTechnicalEnvelope(args).decision,'ACCEPT_EXACT_RELEASE_FOR_INSTALL');
 assert.throws(()=>verifyOwnerTechnicalEnvelope({...args,sourceSha:'z'.repeat(40)}),/OWNER_FINALIZE_/);
 assert.throws(()=>verifyOwnerTechnicalEnvelope({...args,
   trustedOwnerFingerprint:'1'.repeat(64)}),/OWNER_FINALIZE_WRONG_TRUSTED_OWNER/);
 const tampered=structuredClone(envelope);
 tampered.payload=tampered.payload.replace('112233','112234');
 assert.throws(()=>verifyOwnerTechnicalEnvelope({...args,envelope:tampered}),
  /OWNER_FINALIZE_NOT_AUTHENTIC_OWNER_SIGNATURE/);
 const wrong=structuredClone(manifest);wrong.sourceSha='f'.repeat(40);
 assert.throws(()=>verifyOwnerTechnicalEnvelope({...args,
   finalManifestRaw:previewOwnerFinalManifest(wrong)}),
   /OWNER_FINALIZE_ACCEPTANCE_SCOPE_OR_MANIFEST/);
});
test('source-to-acceptance package is deterministic and leaves source untouched',async()=>{
 const d=await fs.mkdtemp(path.join(os.tmpdir(),'asi-owner-finalize-test-'));
 try{
  const source=path.join(d,'source'),output=path.join(d,'output');
  await fs.mkdir(source);
  const f=fixture();
  for(let i=0;i<f.manifest.files.length;i++){
    const rel=f.manifest.files[i].path;
    await fs.mkdir(path.dirname(path.join(source,rel)),{recursive:true});
    await fs.writeFile(path.join(source,rel),'export const v = '+i+';\n');
  }
  for(const [name,content] of [
    ['catalog.json',f.catalog],['asi-strigunov-agent.service',f.unit],
    ['beget-install.py',f.installer],
    ['manifest.json',JSON.stringify(f.manifest,null,2)+'\n']]){
    await fs.writeFile(path.join(source,name),content);
  }
  const plan=await finalizeOwnerPackage({packageDir:source});
  assert.equal(plan.status,'OWNER_TECHNICAL_MANIFEST_PROPOSAL_ONLY');
  assert.equal(plan.applyPerformed,false);
  assert.equal(plan.proposedFinalManifestSha256,sha(previewOwnerFinalManifest(f.manifest)));
  const pair=generateKeyPairSync('ed25519');
  const pem=pair.publicKey.export({type:'spki',format:'pem'});
  const fingerprint=sha(pair.publicKey.export({type:'spki',format:'der'}));
  const signedPath=path.join(d,'owner-accepted.json');
  await fs.writeFile(signedPath,JSON.stringify(acceptance(f.manifest,pair.privateKey)));
  const result=await finalizeOwnerPackage({packageDir:source,output,
    ownerPublicKey:pem,acceptance:signedPath,planOnly:false,
    trustedOwnerFingerprint:fingerprint});
  assert.equal(result.status,'OWNER_SIGNATURE_VERIFIED_SOURCE_PACKAGE');
  assert.equal(result.authorized,false);
  assert.equal(result.applyPerformed,false);
  assert.equal(sha(await fs.readFile(path.join(output,'manifest.json'))),
    plan.proposedFinalManifestSha256);
  assert.equal((await fs.readFile(path.join(source,'manifest.json'),'utf8')).includes(OWNER_WIRING),false);
  await assert.rejects(finalizeOwnerPackage({packageDir:source,output,
    ownerPublicKey:pem,acceptance:signedPath,planOnly:false,
    trustedOwnerFingerprint:fingerprint}));
  const altered=JSON.parse(await fs.readFile(path.join(source,'manifest.json'),'utf8'));
  await fs.writeFile(path.join(source,'catalog.json'),'forged');
  await assert.rejects(finalizeOwnerPackage({packageDir:source}),
    /OWNER_FINALIZE_CATALOG_OR_INSTALLER_CHANGED/);
 }finally{await fs.rm(d,{recursive:true,force:true});}
});
