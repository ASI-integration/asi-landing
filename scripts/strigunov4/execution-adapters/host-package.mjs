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
export async function buildRuntimeClosure({repository,output}){
  const scripts=path.join(await fs.realpath(repository),'scripts'),files={};
  await fs.mkdir(output,{mode:0o700});
  must(await fs.realpath(output)===path.resolve(output),'PACKAGE_OUTPUT_PATH');
  async function copy(relative){
    const name=path.posix.normalize(relative);
    must((/^strigunov4\/[A-Za-z0-9_./-]+\.mjs$/.test(name)||
      ['global-dispatcher/dispatcher.mjs','global-dispatcher/product-adapters.mjs'].includes(name))&&
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
