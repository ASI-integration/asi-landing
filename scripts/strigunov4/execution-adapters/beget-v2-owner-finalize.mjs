/**
 * Owner-controlled V2 source packaging (offline, no model/API/GitHub/systemd).
 *
 * --plan prints a HYPOTHETICAL final manifest digest and makes no changes.
 * --finalize demands a real Ed25519 owner-signed acceptance pinned to that
 * exact final manifest; no fabricated marker or unsigned --install shortcut.
 * Neither mode creates a protected root installation or signs anything.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,createPublicKey,verify} from 'node:crypto';
import {fileURLToPath} from 'node:url';

export const OWNER_WIRING='OWNER_SIGNED_TECHNICAL_ACCEPTANCE_V1';
const TRUSTED_OWNER_FINGERPRINT='a32e4f00e7d05259b03a15bdc9f8b42cf2f7a40e3574e8679bab3c1a9400d8d1';
const H40=/^[0-9a-f]{40}$/,H64=/^[0-9a-f]{64}$/;
const hash=b=>createHash('sha256').update(b).digest('hex');
const must=(condition,reason)=>{if(!condition)throw Error(reason);};
const canonical=object=>JSON.stringify(object,null,2)+'\n';

export function previewOwnerFinalManifest(manifest) {
  must(manifest?.schema==='asi.beget-engine-source.v1'&&
    H40.test(manifest.sourceSha)&&H40.test(manifest.baseSha)&&
    manifest.installable===false&&
    manifest.nativeFiveLaneWiring===undefined&&
    Array.isArray(manifest.files)&&manifest.files.length>=35&&
    manifest.files.length<=100&&H64.test(manifest.catalogSha256),
    'OWNER_FINALIZE_SOURCE_UNREVIEWED');
  const seen=new Set();
  for(const item of manifest.files){
    must(typeof item?.path==='string'&&
      /^scripts\/[A-Za-z0-9_./-]+\.mjs$/.test(item.path)&&
      !item.path.split('/').some(x=>x===''||x==='.'||x==='..')&&
      H64.test(item.sha256)&&!seen.has(item.path),
      'OWNER_FINALIZE_SOURCE_INVENTORY');
    seen.add(item.path);
  }
  must(seen.has('scripts/strigunov4/execution-adapters/host-runtime.mjs')&&
    seen.has('scripts/strigunov4/execution-adapters/beget-native-source-checks.mjs'),
    'OWNER_FINALIZE_NATIVE_WIRING_INCOMPLETE');
  return canonical({...manifest,nativeFiveLaneWiring:OWNER_WIRING});
}

export function verifyOwnerTechnicalEnvelope({
  envelope,ownerPublicKey,finalManifestRaw,sourceSha,
  trustedOwnerFingerprint=TRUSTED_OWNER_FINGERPRINT
}={}) {
  must(typeof ownerPublicKey==='string'&&
    typeof finalManifestRaw==='string'&&H40.test(sourceSha),
    'OWNER_FINALIZE_PUBLIC_CONTEXT');
  const key=createPublicKey(ownerPublicKey);
  must(key.asymmetricKeyType==='ed25519'&&
    hash(key.export({type:'spki',format:'der'}))===trustedOwnerFingerprint,
    'OWNER_FINALIZE_WRONG_TRUSTED_OWNER');
  must(typeof envelope?.payload==='string'&&
    typeof envelope.signature==='string'&&
    /^[A-Za-z0-9+/]{86}==$/.test(envelope.signature),
    'OWNER_FINALIZE_ENVELOPE_FORMAT');
  const sig=Buffer.from(envelope.signature,'base64');
  must(sig.length===64&&sig.toString('base64')===envelope.signature&&
    verify(null,Buffer.from(envelope.payload),key,sig),
    'OWNER_FINALIZE_NOT_AUTHENTIC_OWNER_SIGNATURE');
  const accepted=JSON.parse(envelope.payload);
  must(JSON.stringify(accepted)===envelope.payload&&
    accepted.schema==='asi.beget-owner-native-technical-acceptance.v1'&&
    accepted.mode==='OWNER_SIGNED_TECHNICAL_ACCEPTANCE'&&
    accepted.decision==='ACCEPT_EXACT_RELEASE_FOR_INSTALL'&&
    accepted.host==='pqukibofpo'&&
    accepted.unit==='asi-strigunov-agent.service'&&
    accepted.sourceSha===sourceSha&&
    accepted.catalogSha256===JSON.parse(finalManifestRaw).catalogSha256&&
    accepted.manifestSha256===hash(finalManifestRaw)&&
    typeof accepted.validationRunId==='number'&&
    Number.isSafeInteger(accepted.validationRunId)&&accepted.validationRunId>0&&
    H64.test(accepted.oldManifestSha256)&&
    H64.test(accepted.catalogSha256)&&
    typeof accepted.oldStateDigests==='object'&&
    !Array.isArray(accepted.oldStateDigests)&&
    Object.values(accepted.oldStateDigests).length>=6&&
    Object.values(accepted.oldStateDigests).every(x=>H64.test(x))&&
    ['nativeFiveLaneAdmissionTested','realModelBudgetGateTested',
      'restoreReplayProhibitionTested'].every(k=>accepted[k]===true)&&
    accepted.testEvidenceSha256&&
    Object.keys(accepted.testEvidenceSha256).sort().join(',')===
      'installer,node,serviceUidSandbox'&&
    Object.values(accepted.testEvidenceSha256).every(x=>H64.test(x)),
    'OWNER_FINALIZE_ACCEPTANCE_SCOPE_OR_MANIFEST');
  return Object.freeze(accepted);
}
async function ordinary(abs,maxSize=3000000){
  const s=await fs.lstat(abs);
  must(s.isFile()&&!s.isSymbolicLink()&&s.nlink===1&&
    s.size>0&&s.size<=maxSize,'OWNER_FINALIZE_UNTRUSTED_SOURCE_FILE');
  const raw=await fs.readFile(abs);
  must(raw.length===s.size,'OWNER_FINALIZE_SOURCE_CHANGED');
  return raw;
}
async function checkSource(packageDir){
  const root=await fs.realpath(packageDir);
  must(path.isAbsolute(root),'OWNER_FINALIZE_ABSOLUTE_SOURCE');
  const manifest=JSON.parse((await ordinary(path.join(root,'manifest.json'))).toString());
  const finalRaw=previewOwnerFinalManifest(manifest);
  for(const row of manifest.files){
    must(await fs.realpath(path.join(root,row.path))===path.join(root,row.path),
      'OWNER_FINALIZE_SOURCE_PATH_SYMLINK');
    must(hash(await ordinary(path.join(root,row.path)))===row.sha256,
      'OWNER_FINALIZE_SOURCE_HASH_MISMATCH');
  }
  const other=[['catalog.json','catalogSha256'],
    ['asi-strigunov-agent.service','unitSha256'],
    ['beget-install.py','installerSha256']];
  for(const [name,field] of other){
    must(await fs.realpath(path.join(root,name))===path.join(root,name),
      'OWNER_FINALIZE_ARTIFACT_PATH_SYMLINK');
    must(H64.test(manifest[field])&&
      hash(await ordinary(path.join(root,name)))===manifest[field],
      'OWNER_FINALIZE_CATALOG_OR_INSTALLER_CHANGED');
  }
  return {root,manifest,finalRaw};
}
export async function finalizeOwnerPackage({
  packageDir,output,ownerPublicKey,acceptance,planOnly=true,
  trustedOwnerFingerprint=TRUSTED_OWNER_FINGERPRINT
}={}){
  const {root,manifest,finalRaw}=await checkSource(packageDir);
  const evidence=Object.freeze({status:'OWNER_TECHNICAL_MANIFEST_PROPOSAL_ONLY',
    sourceSha:manifest.sourceSha,
    candidateManifestSha256:hash(await ordinary(path.join(root,'manifest.json'))),
    proposedFinalManifestSha256:hash(finalRaw),
    catalogSha256:manifest.catalogSha256,
    moduleCount:manifest.files.length,
    authorized:false,ownerSignatureVerified:false,applyPerformed:false});
  if(planOnly)return evidence;
  must(typeof output==='string'&&path.isAbsolute(output)&&
    !(await fs.realpath(path.dirname(output))).startsWith(root+'/')&&
    output!==root&&typeof ownerPublicKey==='string'&&acceptance,
    'OWNER_FINALIZE_OUTPUT_OR_ACCEPTANCE_MISSING');
  const signed=JSON.parse((await ordinary(acceptance)).toString());
  const accepted=verifyOwnerTechnicalEnvelope({
    envelope:signed,ownerPublicKey,finalManifestRaw:finalRaw,
    sourceSha:manifest.sourceSha,trustedOwnerFingerprint});
  // The finalizer does not attest that CI passed; the protected *installer*
  // verifies the exact GitHub run and root-owned test logs during preflight.
  const outputDir=path.resolve(output);
  await fs.mkdir(outputDir,{mode:0o700,recursive:false});
  try {
    const entries=['catalog.json','asi-strigunov-agent.service',
      'beget-install.py',...manifest.files.map(x=>x.path)];
    for(const name of entries){
      const dest=path.join(outputDir,name);
      await fs.mkdir(path.dirname(dest),{recursive:true,mode:0o700});
      await fs.writeFile(dest,await ordinary(path.join(root,name)),{flag:'wx',mode:0o600});
    }
    await fs.writeFile(path.join(outputDir,'manifest.json'),finalRaw,
      {flag:'wx',mode:0o600});
    return Object.freeze({...evidence,status:'OWNER_SIGNATURE_VERIFIED_SOURCE_PACKAGE',
      authorized:false,ownerSignatureVerified:true,
      verifiedAcceptanceSourceSha:accepted.sourceSha,
      outputManifestSha256:hash(finalRaw),applyPerformed:false});
  }catch(error){
    // Outputs are non-sensitive deterministic files, but never reuse a
    // partially assembled directory after an uncertain failure.
    throw Error('OWNER_FINALIZE_PARTIAL_OUTPUT_REQUIRES_MANUAL_INSPECTION');
  }
}
function options(args){
  const fields={};
  for(let i=0;i<args.length;i+=2){
    const k=args[i];
    must(k?.startsWith('--')&&i+1<args.length&&!fields[k],
      'OWNER_FINALIZE_CLI_ARGUMENTS');
    fields[k]=args[i+1];
  }
  must(fields['--package']&&['plan','finalize'].includes(fields['--mode'])&&
    Object.keys(fields).every(x=>['--package','--mode','--output',
      '--owner-public','--acceptance'].includes(x)),'OWNER_FINALIZE_CLI_OPTIONS');
  return fields;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1])){
  try{
    const args=options(process.argv.slice(2));
    const result=await finalizeOwnerPackage({
      packageDir:args['--package'],output:args['--output'],
      ownerPublicKey:args['--owner-public']?
        (await ordinary(args['--owner-public'])).toString():undefined,
      acceptance:args['--acceptance'],planOnly:args['--mode']==='plan'
    });
    process.stdout.write(JSON.stringify(result)+'\n');
  }catch(error){
    // No key/secret/accepted payload contents ever printed.
    process.stdout.write(JSON.stringify({status:'BLOCKED',authorized:false,
      applied:false,reason:/^OWNER_FINALIZE_/.test(error.message)?
        error.message:'OWNER_FINALIZE_UNKNOWN'})+'\n');
    process.exitCode=1;
  }
}
