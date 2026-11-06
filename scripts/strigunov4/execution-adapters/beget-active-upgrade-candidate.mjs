/**
 * The EXISTING ACTIVE Beget Engine needs an in-place upgrade, not an installer.
 * This module only assembles and checks a source candidate package plus a
 * continuity report. It has NO privileged apply/start/stop/sudo/rollback port.
 *
 * The real upgrade must be implemented and reviewed separately with a genuine
 * root-owned owner-signed grant, preserve existing native state, and prove
 * all in-flight Publisher effects settled before any process transition.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {buildBegetCandidate} from './host-package.mjs';

const SHA=/^[a-f0-9]{40}$/;
const HASH=/^[a-f0-9]{64}$/;
const digest=b=>createHash('sha256').update(b).digest('hex');
const LIVE='/opt/asi-engine';
const ROOT='/var/lib/asi-engine';
const UNIT='asi-strigunov-agent.service';
export const ACTIVE_RUNTIME_ROOTS=Object.freeze([
  'strigunov4/execution-adapters/owner-lane-native-bridge.mjs',
  'strigunov4/source-work-intake.mjs',
  'strigunov4/source-responses-provider.mjs',
  'strigunov4/source-git-context.mjs',
  'strigunov4/source-publisher-handoff.mjs',
  'strigunov4/execution-adapters/autonomy-recovery-observer.mjs'
]);
export const STANDING_RUNTIME_ROOTS=Object.freeze([
  'strigunov4/execution-adapters/standing-budget.mjs',
  'strigunov4/execution-adapters/standing-parent-budget-proposal.mjs',
  'strigunov4/execution-adapters/standing-parent-native-preview.mjs',
  'strigunov4/execution-adapters/standing-parent-signature-source.mjs',
  'strigunov4/execution-adapters/standing-parent-task-lease-proposal.mjs',
  'strigunov4/execution-adapters/standing-request-guard.mjs',
]);
const block=reason=>Object.freeze({schema:'asi.beget-active-upgrade-plan.v1',
  status:'BLOCKED',reason,authorized:false,installable:false});
const ownPlain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null)&&
  Reflect.ownKeys(x).every(k=>typeof k==='string'&&
    Object.hasOwn(Object.getOwnPropertyDescriptor(x,k),'value'));
export function inspectExistingRuntimeManifest(raw){
  try {
    if(typeof raw!=='string'||Buffer.byteLength(raw)>100000)return block('OLD_MANIFEST_BYTES');
    const m=JSON.parse(raw);
    if(!ownPlain(m)||m.schema!=='asi.beget-engine-source.v1'||
      !SHA.test(m.sourceSha)||!SHA.test(m.baseSha)||m.installable!==false||
      !Array.isArray(m.files)||m.files.length<10||m.files.length>100||
      !HASH.test(m.catalogSha256)||!HASH.test(m.unitSha256)||
      m.entry!=='scripts/strigunov4/ASI-STRIGUNOV4-RUNNER-BRIDGE-20261020.mjs')
      return block('OLD_MANIFEST_IDENTITY');
    const names=new Set();
    for(const f of m.files){
      if(!ownPlain(f)||typeof f.path!=='string'||names.has(f.path)||
        !/^scripts\/[A-Za-z0-9_./-]+\.mjs$/.test(f.path)||
        f.path.split('/').some(x=>x==='.'||x==='..')||
        !HASH.test(f.sha256))return block('OLD_MANIFEST_FILE_IDENTITY');
      names.add(f.path);
    }
    return Object.freeze({schema:'asi.beget-active-upgrade-plan.v1',
      status:'OBSERVED_SOURCE_CANDIDATE',authorized:false,installable:false,
      oldManifestSha256:digest(raw),oldSourceSha:m.sourceSha,
      oldBaseSha:m.baseSha,oldCatalogSha256:m.catalogSha256,
      oldUnitSha256:m.unitSha256,oldFiles:Object.freeze([...names])});
  }catch{return block('OLD_MANIFEST_UNREADABLE');}
}
/**
 * The caller-provided old manifest is NOT an owner signature or sufficient
 * proof of live host identity; the output is always blocked for installation.
 */
export async function buildActiveStandingUpgradeCandidate({
  repository,output,baseSha,expectedSourceSha,installedManifestRaw
}={}){
  const old=inspectExistingRuntimeManifest(installedManifestRaw);
  if(old.status!=='OBSERVED_SOURCE_CANDIDATE')return old;
  if(!SHA.test(baseSha)||!SHA.test(expectedSourceSha)||!repository||!output||
    old.oldSourceSha===expectedSourceSha)
    return block('NEW_SOURCE_INVALID');
  // Prevent replacing owner state or a running service by construction. This
  // invokes only the original source closure builder in a separate scratch.
  const manifest=await buildBegetCandidate({
    repository,output,baseSha,
    extraRuntimeRoots:[...STANDING_RUNTIME_ROOTS,...ACTIVE_RUNTIME_ROOTS]
  });
  const roots=[...STANDING_RUNTIME_ROOTS,...ACTIVE_RUNTIME_ROOTS].map(p=>'scripts/'+p);
  const names=manifest.files.map(f=>f.path);
  if(!roots.every(p=>names.includes(p))||!names.includes(manifest.entry)||
    manifest.sourceSha!==expectedSourceSha||manifest.baseSha!==baseSha||
    manifest.installable!==false||manifest.catalogSha256===undefined)
    throw Error('STANDING_UPGRADE_PACKAGE_INCOMPLETE');
  const manifestRaw=await fs.readFile(path.join(output,'manifest.json'));
  const plan={
    schema:'asi.beget-active-upgrade-plan.v1',
    status:'SOURCE_CANDIDATE_ONLY',authorized:false,installable:false,
    old:{sourceSha:old.oldSourceSha,baseSha:old.oldBaseSha,
      manifestSha256:old.oldManifestSha256,
      catalogSha256:old.oldCatalogSha256,
      unitSha256:old.oldUnitSha256,fileCount:old.oldFiles.length},
    proposed:{sourceSha:manifest.sourceSha,baseSha,
      manifestSha256:digest(manifestRaw),
      catalogSha256:manifest.catalogSha256,unitSha256:manifest.unitSha256,
      fileCount:manifest.files.length,
      standingModuleCount:STANDING_RUNTIME_ROOTS.length,
      autonomyModuleCount:ACTIVE_RUNTIME_ROOTS.length},
    target:{runtime:LIVE,privateState:ROOT,service:UNIT},
    continuity:{
      preserveExistingRuntime:true,preserveExistingPrivateState:true,
      preserveBudgetClaims:true,preserveReceipts:true,preserveFences:true,
      preserveServiceIdentity:true,failOnUnknownRemoteEffects:true
    },
    missingGates:[
      'AUTHENTICATED_INSTALLED_GENERATION',
      'NATIVE_SIGNED_PARENT_CHILD_ISSUER_AND_REVOCATION',
      'REVIEWED_STATE_PRESERVING_IN_PLACE_UPDATER',
      'OWNER_SIGNED_EXACT_RUNTIME_UPGRADE',
      'AUTHORIZED_PRIVILEGED_OPERATOR',
      'PREFLIGHT_IN_FLIGHT_WRITES_AND_BACKUP_RESTORE',
      'PHYSICAL_POST_UPGRADE_VALIDATION'
    ]
  };
  await fs.writeFile(path.join(output,'upgrade-source-plan.json'),
    JSON.stringify(plan,null,2)+'\n',{flag:'wx',mode:0o600});
  return Object.freeze(plan);
}
