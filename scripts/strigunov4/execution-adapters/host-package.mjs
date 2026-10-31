// Reproducible offline package builder. No SSH, secrets, activation or GitHub writes.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {digest,must} from './state.mjs';
import {ENGINE_PILOT} from '../ASI-STRIGUNOV4-MULTIJOB-20261020.mjs';

/** Non-installable runtime source closure. Preserve the repository layout so
 * the existing sibling Global Dispatcher imports resolve without duplication.
 * Never reuse the old pilot installer/claim for this new source layout.
 */
export async function buildRuntimeClosure({repository,output,extraRoots=[]}){
  const scripts=path.join(await fs.realpath(repository),'scripts'),files={};
  await fs.mkdir(output,{mode:0o700});
  must(await fs.realpath(output)===path.resolve(output),'PACKAGE_OUTPUT_PATH');
  const namedAutonomyRoots=new Set([
    'strigunov4/execution-adapters/owner-lane-native-bridge.mjs',
    'strigunov4/source-work-intake.mjs',
    'strigunov4/source-responses-provider.mjs',
    'strigunov4/source-git-context.mjs',
    'strigunov4/source-publisher-handoff.mjs',
    'strigunov4/execution-adapters/autonomy-recovery-observer.mjs'
  ]);
  const standingAgentDependencies=new Set([
    'agent-os/check-demo-release.mjs',
    'agent-os/release-envelope-review-freshness.mjs',
    'agent-os/release-envelope-git-trust.mjs',
    'agent-os/release-envelope-trust-roots.mjs',
    'agent-os/verify-owner-security-baseline.mjs'
  ]);
  async function copy(relative){
    const name=path.posix.normalize(relative);
    must((/^strigunov4\/[A-Za-z0-9_./-]+\.mjs$/.test(name)||
      ['global-dispatcher/dispatcher.mjs','global-dispatcher/product-adapters.mjs',
       'global-dispatcher/task-intake.mjs'].includes(name)||
      (extraRoots.length>0&&standingAgentDependencies.has(name)))&&
      !name.split('/').includes('..'),'PACKAGE_IMPORT_SCOPE');
    if(Object.hasOwn(files,name))return;
    const source=path.join(scripts,name);
    must(await fs.realpath(source)===source&&(await fs.lstat(source)).isFile(),'PACKAGE_SOURCE_PATH');
    const content=await fs.readFile(source,'utf8');files[name]=digest(content);
    const destination=path.join(output,'scripts',name);
    await fs.mkdir(path.dirname(destination),{recursive:true,mode:0o700});
    await fs.writeFile(destination,content,{flag:'wx',mode:0o600});
    for(const m of content.matchAll(/(?:from\s*|import\s*)['"]([^'"]+)['"]/g)){
      if(m[1].startsWith('node:'))continue;
      must(m[1].startsWith('.'),'PACKAGE_EXTERNAL_DEPENDENCY');
      await copy(path.posix.join(path.posix.dirname(name),m[1]));
    }
  }
  await copy('strigunov4/execution-adapters/host-runtime.mjs');
  // Additional source-only standing code is packaged as a separately
  // pinned module set. Merely copying it never changes live admission.
  must(Array.isArray(extraRoots)&&extraRoots.length<=12&&
    new Set(extraRoots).size===extraRoots.length,'PACKAGE_EXTRA_ROOTS');
  for(const extra of extraRoots){
    must(typeof extra==='string'&&
      (/^strigunov4\/execution-adapters\/standing-[a-z-]+\.mjs$/.test(extra)||
       namedAutonomyRoots.has(extra)),
      'PACKAGE_STANDING_EXTRA_ROOT');
    await copy(extra);
  }
  const manifest={schema:'asi.engine-runtime-source-closure.v1',entry:'scripts/strigunov4/execution-adapters/host-runtime.mjs',
    files,installable:false,reason:'HOST_RUNNER_ADMISSION_AND_FENCING_REQUIRED'};
  await fs.writeFile(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
  return manifest;
}
export const OLD_RUNNER='afbac44ff351d7c929e20886b6739bef97e302eb28f89d344902a9364e1d98e8';
export function runnerCandidate(original){
  must(digest(original)===OLD_RUNNER,'RUNNER_BASE_MISMATCH');
  const old="  try{await iteration();}catch(e){await beat({mode:'BLOCKED',reason:String(e.message).slice(0,230)});console.error('BLOCKED',String(e.message).slice(0,230));}";
  must(original.split(old).length===2,'RUNNER_HOOK_NOT_UNIQUE');
  return original.replace("import { autopilotIteration } from './autopilot.mjs';",
    "import { autopilotIteration } from './autopilot.mjs';\nimport {engineIteration} from './engine/execution-adapters/host-runtime.mjs';")
    .replace(old,"  console.log(JSON.stringify(await engineIteration({readProjectGates}))); ".trimEnd());
}
export function pilotTask(source,baseSha){
  const anchor='    def test_real_old_pin_rejects_synthetic_and_ambiguous_content(self):';
  const method=`    def test_receipt_replay_flag_requires_literal_false(self):
        expected = receipt()
        self.assertEqual(c.validate_receipt(expected, SHA, RID), expected)
        for replay in (True, 0, 1, None, "false", [], {}):
            with self.subTest(replay=replay), self.assertRaises(c.Block):
                c.validate_receipt(dict(expected, replayAllowed=replay), SHA, RID)

`;
  must(/^[a-f0-9]{40}$/.test(baseSha)&&source.split(anchor).length===2&&
    !source.includes('def test_receipt_replay_flag_requires_literal_false'),'PILOT_BASE_CHANGED');
  return {id:'g1-receipt-replay-20261022',kind:'github-publisher',stage:'S4-G1',workOrderId:ENGINE_PILOT.id,
    repo:'ASI-integration/asi-landing',sha:baseSha,pr:null,branch:'asi/engine-task/g1-receipt-replay-20261022',
    changes:[{path:ENGINE_PILOT.paths[0],beforeSha256:digest(source),content:source.replace(anchor,method+anchor)}]};
}
export async function buildPackage({repository,runnerFile,output,baseSha}){
  const original=await fs.readFile(runnerFile,'utf8'),runner=runnerCandidate(original);
  const source=execFileSync('/usr/bin/git',['show',baseSha+':'+ENGINE_PILOT.paths[0]],{cwd:repository,encoding:'utf8'});
  const task=pilotTask(source,baseSha),catalog=JSON.stringify([task],null,2)+'\n';
  await fs.mkdir(output,{mode:0o700});
  const sourceRoot=path.join(repository,'scripts/strigunov4'),files={};
  async function copy(name){
    must(!name.startsWith('../')&&name.endsWith('.mjs'),'PACKAGE_IMPORT_SCOPE');
    if(files[name])return;const content=await fs.readFile(path.join(sourceRoot,name),'utf8');files[name]=digest(content);
    const dest=path.join(output,'engine',name);await fs.mkdir(path.dirname(dest),{recursive:true,mode:0o700});
    await fs.writeFile(dest,content,{flag:'wx',mode:0o600});
    for(const m of content.matchAll(/(?:from\s*|import\s*)['"](\.[^'"]+)['"]/g))await copy(path.normalize(path.join(path.dirname(name),m[1])));
  }
  await copy('execution-adapters/host-runtime.mjs');
  await fs.writeFile(path.join(output,'runner.original.mjs'),original,{flag:'wx',mode:0o600});
  await fs.writeFile(path.join(output,'runner.candidate.mjs'),runner,{flag:'wx',mode:0o600});
  await fs.writeFile(path.join(output,'catalog.json'),catalog,{flag:'wx',mode:0o600});
  const manifest={schema:'asi.engine-package.v1',baseSha,service:'asi-strigunov-agent.service',
    oldRunnerSha256:OLD_RUNNER,newRunnerSha256:digest(runner),catalogSha256:digest(catalog),files,
    protectedInstallExecuted:false,autonomousE2E:false};
  await fs.writeFile(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
  return manifest;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  const [repository,runnerFile,output,baseSha]=process.argv.slice(2);
  buildPackage({repository,runnerFile,output,baseSha}).then(x=>console.log(JSON.stringify(x))).catch(()=>{console.error('PACKAGE_BUILD_FAILED');process.exitCode=1;});
}

/** Freeze a Beget source candidate, not an assertion of install/authority PASS. */
export async function buildBegetCandidate({repository,output,baseSha,extraRuntimeRoots=[]}){
  must(/^[a-f0-9]{40}$/.test(baseSha),'BEGET_BASE_SHA');
  repository=await fs.realpath(repository);
  const outputPath=path.resolve(output),outputParent=await fs.realpath(path.dirname(outputPath));
  const canonicalOutput=path.join(outputParent,path.basename(outputPath));
  must(canonicalOutput!==repository&&!canonicalOutput.startsWith(repository+path.sep),'PACKAGE_OUTPUT_IN_SOURCE');
  // The closure builder requires a canonical, previously absent destination.
  // Reject aliases before mkdir so a failed build cannot dirty its own source.
  must(outputParent===path.dirname(outputPath),'PACKAGE_OUTPUT_PATH');
  const sourceSha=execFileSync('/usr/bin/git',['rev-parse','HEAD'],{cwd:repository,encoding:'utf8'}).trim();
  const assertSource=()=>{
    must(execFileSync('/usr/bin/git',['status','--porcelain','--untracked-files=normal'],{cwd:repository,encoding:'utf8'}).trim()==='', 'PACKAGE_DIRTY_SOURCE');
    must(execFileSync('/usr/bin/git',['rev-parse','HEAD'],{cwd:repository,encoding:'utf8'}).trim()===sourceSha,'PACKAGE_SOURCE_CHANGED');
  };
  assertSource();
  const closure=await buildRuntimeClosure({repository,output,extraRoots:extraRuntimeRoots});
  const catalog=[];
  for(const part of ['identity','races']){
    const id=`beget-g2-witness-${part}-v1`,name=`scripts/strigunov4/test_${id.replaceAll('-','_')}.py`;
    const content=await fs.readFile(path.join(repository,`scripts/strigunov4/execution-adapters/beget-work-orders/${part}.py.txt`),'utf8');
    // Exact source branch must already contain the accepted witness; no substitute stub.
    const witness=execFileSync('/usr/bin/git',['show',baseSha+':scripts/strigunov4/beget_g2_operator_witness.py'],{cwd:repository});
    must(digest(witness)==='44bd342a521a3c609338cd9fd29e7f9e1388d8c85cbd71cf68a8990fdbefad6a','WITNESS_BASE_HASH');
    try{execFileSync('/usr/bin/git',['cat-file','-e',baseSha+':'+name],{cwd:repository,stdio:'pipe'});throw Error('TASK_ALREADY_EXISTS');}
    catch(e){must(e.status===128,'TASK_ALREADY_EXISTS');}
    catalog.push({id,kind:'github-publisher',stage:'S4-G2',workOrderId:id,repo:'ASI-integration/asi-landing',sha:baseSha,pr:null,
      branch:'asi/engine-task/'+id,changes:[{path:name,beforeSha256:null,content}]});
  }
  const catalogRaw=JSON.stringify(catalog,null,2)+'\n';
  await fs.writeFile(path.join(output,'catalog.json'),catalogRaw,{flag:'wx',mode:0o600});
  const unit=await fs.readFile(path.join(repository,'scripts/strigunov4/execution-adapters/asi-strigunov-agent.service'));
  await fs.writeFile(path.join(output,'asi-strigunov-agent.service'),unit,{flag:'wx',mode:0o600});
  const installer=await fs.readFile(path.join(repository,'scripts/strigunov4/execution-adapters/beget-install.py'));
  await fs.writeFile(path.join(output,'beget-install.py'),installer,{flag:'wx',mode:0o600});
  assertSource();
  const manifest={schema:'asi.beget-engine-source.v1',sourceSha,
    baseSha,entry:'scripts/strigunov4/ASI-STRIGUNOV4-RUNNER-BRIDGE-20261020.mjs',
    files:Object.entries(closure.files).map(([name,sha256])=>({path:'scripts/'+name,sha256})).sort((a,b)=>a.path.localeCompare(b.path)),
    catalogSha256:digest(catalogRaw),unitSha256:digest(unit),installerSha256:digest(installer),
    nodeSha256:'8142d37c6f2f372ef040419e7a111a6baf17df89f8078d02447d6c639ae20c1d',
    bwrapSha256:'e318903862396f96de3df57264e0158682b952fd3fb53ac23d876413e7b30f71',installable:false,
    requiredGates:['SOURCE_REVIEW','PROTECTED_MAIN_BASE','NATIVE_BWRAP_ACCEPTANCE','INDEPENDENT_OLD_WRITER_FENCE','SIGNED_INSTALL_AND_TASK_AUTHORITY']};
  await fs.writeFile(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{mode:0o600});
  return manifest;
}

/** Deterministic, explicitly non-installable v2 *source closure*.
 * The existing two-witness catalog in buildBegetCandidate is retained only
 * for source/preflight compatibility. Five signed tasks, independent review
 * and new host activation are NOT issued by this helper.
 */
export const BEGET_FIVE_LANE_SOURCE_ROOTS=Object.freeze([
  'strigunov4/execution-adapters/standing-request-guard.mjs',
  'strigunov4/execution-adapters/standing-parent-native-preview.mjs',
  'strigunov4/source-responses-provider.mjs',
  'strigunov4/source-git-context.mjs',
  'strigunov4/source-publisher-handoff.mjs',
  'strigunov4/source-work-intake.mjs',
  'strigunov4/execution-adapters/autonomy-recovery-observer.mjs'
]);
export async function buildBegetFiveLaneSourceCandidate({repository,output,baseSha}={}){
  const candidate=await buildBegetCandidate({repository,output,baseSha,
    extraRuntimeRoots:[...BEGET_FIVE_LANE_SOURCE_ROOTS]});
  const required=[
    'scripts/strigunov4/execution-adapters/standing-request-guard.mjs',
    'scripts/strigunov4/execution-adapters/beget-native-request-admission.mjs',
    'scripts/strigunov4/execution-adapters/beget-native-source-review.mjs',
    'scripts/strigunov4/execution-adapters/beget-native-five-lane-source.mjs',
    'scripts/strigunov4/execution-adapters/owner-lane-native-bridge.mjs',
    'scripts/strigunov4/source-responses-provider.mjs',
    'scripts/global-dispatcher/task-intake.mjs'
  ];
  must(required.every(path=>candidate.files.some(f=>f.path===path)),
    'FIVE_LANE_SOURCE_CLOSURE_INCOMPLETE');
  must(candidate.installable===false &&
    candidate.nativeFiveLaneWiring===undefined,
    'FIVE_LANE_SOURCE_NOT_REVIEWED');
  return candidate;
}

/** A five-task source *package* requires explicit reviewed catalog bytes.
 * The legacy two-witness source closure is never a five-lane release catalog.
 * No signatures or runtime authority are issued by packaging.
 */
export function inspectFiveLaneCatalog(catalog,baseSha){
  const reject=reason=>Object.freeze({status:'BLOCKED',reason,authorized:false});
  try{
    if(!/^[a-f0-9]{40}$/.test(baseSha||'')||
      !Array.isArray(catalog)||catalog.length!==5)
      return reject('FIVE_LANE_EXACT_BASE_AND_COUNT');
    const lanes=[
      ['engine','asi/beget-one-engine-20261028'],
      ['ru-auth','feat/ru-unified-auth-20261029'],
      ['p0-integration','asi/standing-delegation-551'],
      ['p0-trust','asi/p0-trusted-evidence-worker-20261029'],
      ['p0-atomic-budget','asi/p0-atomic-budget-worker-20261029']
    ];
    const ids=new Set(),paths=new Set();
    for(let i=0;i<5;i++){
      const t=catalog[i],lane=lanes[i];
      if(!t||typeof t!=='object'||Array.isArray(t)||
        Object.keys(t).sort().join(',')!==
          'baseSha,branch,files,id,kind,laneId,objective,repo,stage'||
        t.baseSha!==baseSha||t.laneId!==lane[0]||t.branch!==lane[1]||
        t.repo!=='ASI-integration/asi-landing'||
        t.stage!=='S4-G2'||t.kind!=='source-proposal'||
        typeof t.id!=='string'||!/^[a-z0-9][a-z0-9-]{0,79}$/.test(t.id)||
        ids.has(t.id)||typeof t.objective!=='string'||
        !t.objective.trim()||t.objective.trim()!==t.objective||
        t.objective.length>2400||!Array.isArray(t.files)||
        t.files.length<1||t.files.length>3)return reject('FIVE_LANE_TASK_SCOPE');
      ids.add(t.id);
      for(const file of t.files){
        if(!file||Object.keys(file).sort().join(',')!=='beforeSha256,path'||
          typeof file.path!=='string'||file.path.length>180||
          !/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*\.(?:mjs|js|json|py)$/.test(file.path)||
          file.path.split('/').some(s=>s==='.'||s==='..'||s.toLowerCase()==='.git')||
          !/^[a-f0-9]{64}$/.test(file.beforeSha256||'')||paths.has(file.path))
          return reject('FIVE_LANE_EXACT_EXISTING_FILE_SCOPE');
        paths.add(file.path);
      }
    }
    return Object.freeze({status:'SOURCE_CATALOG_VALIDATED',authorized:false,
      taskCount:5,fileCount:paths.size,
      catalogSha256:digest(JSON.stringify(catalog,null,2)+'\n')});
  }catch{return reject('FIVE_LANE_CATALOG_UNREADABLE');}
}
/** Build the first package whose catalog bytes can actually equal a future
 * five-lane owner-signed activation. This remains NOT_INSTALLABLE until
 * independent protected review and genuine owner Ed25519 upgrade authority.
 * Catalog is explicit owner-controlled input, never generated by a model.
 */
export async function buildBegetFiveLaneBoundSourceCandidate({
  repository,output,baseSha,catalog
}={}){
  const check=inspectFiveLaneCatalog(catalog,baseSha);
  must(check.status==='SOURCE_CATALOG_VALIDATED','FIVE_LANE_CATALOG_INVALID');
  const repo=await fs.realpath(repository);
  // Verify every expected existing source byte at the exact protected base,
  // not the checkout HEAD or an untrusted model-supplied before hash.
  for(const task of catalog)for(const c of task.files){
    const raw=execFileSync('/usr/bin/git',
      ['-c','core.hooksPath=/dev/null','show',baseSha+':'+c.path],{
        cwd:repo,timeout:10000,maxBuffer:20000,encoding:'utf8',
        env:{PATH:'/usr/bin:/bin',GIT_CONFIG_NOSYSTEM:'1',
          GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0'}
      });
    must(Buffer.byteLength(raw,'utf8')<=15000&&digest(raw)===c.beforeSha256,
      'FIVE_LANE_BASE_SOURCE_CHANGED');
  }
  const m=await buildBegetFiveLaneSourceCandidate({repository:repo,output,baseSha});
  const raw=JSON.stringify(catalog,null,2)+'\n';
  must(digest(raw)===check.catalogSha256,'FIVE_LANE_CATALOG_SERIALIZATION_CHANGED');
  await fs.writeFile(path.join(output,'catalog.json'),raw,{mode:0o600});
  const revised={...m,catalogSha256:check.catalogSha256};
  // No false reviewed marker, install permission or signed grant.
  must(revised.installable===false&&revised.nativeFiveLaneWiring===undefined,
    'FIVE_LANE_SOURCE_GRANT_NOT_ALLOWED');
  await fs.writeFile(path.join(output,'manifest.json'),
    JSON.stringify(revised,null,2)+'\n',{mode:0o600});
  return revised;
}
