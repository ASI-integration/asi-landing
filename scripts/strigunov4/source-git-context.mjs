/**
 * Narrow, local, exact-commit source reader for existing private detached
 * Engine scratch clones. NOT an admission verifier or secrets exporter.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {inspectSourceIntake} from './source-work-intake.mjs';
import {validateScratchGitConfig} from './execution-adapters/change-preparer.mjs';

const exec=promisify(execFile);
const sum=x=>createHash('sha256').update(x).digest('hex');
const SAFE=/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*\.(?:py|js|mjs|json)$/;
const goodPath=p=>typeof p==='string'&&SAFE.test(p)&&
  p.split('/').every(x=>x!=='..'&&x!=='.'&&x.toLowerCase()!=='.git');
async function git(cwd,args) {
  try{
    const {stdout}=await exec('/usr/bin/git',
      ['-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false',...args],
      {cwd,timeout:12000,maxBuffer:200000,
        env:{PATH:'/usr/bin:/bin',GIT_CONFIG_NOSYSTEM:'1',
          GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0',
          GIT_OPTIONAL_LOCKS:'0'}});
    return stdout.trim();
  }catch{throw Error('PINNED_GIT_CHECK_FAILED');}
}
async function dir(p) {
  const st=await fs.lstat(p);
  if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==process.getuid())
    throw Error('SCRATCH_DIRECTORY_NOT_TRUSTED');
}
export function createPinnedSourceReader({checkout,admittedTasks}={}){
  return async function getContext({id,baseSha,paths}={}){
    if(typeof checkout!=='string'||!path.isAbsolute(checkout)||
       typeof id!=='string'||typeof baseSha!=='string'||
       !Array.isArray(paths)||paths.length<1||paths.length>3||
       paths.some(p=>!goodPath(p)))throw Error('PINNED_SOURCE_SCOPE_INVALID');
    // No work order is obtained from Issue text or model output.
    const tasks=admittedTasks?.filter(t=>t?.id===id);
    if(tasks?.length!==1)throw Error('NATIVE_CATALOG_NOT_PINNED');
    const task=tasks[0];
    if(task.baseSha!==baseSha||paths.length!==task.files?.length||
       paths.some((p,i)=>p!==task.files[i].path)||
       inspectSourceIntake({task,admittedTasks}).status!=='SOURCE_CANDIDATE')
      throw Error('PINNED_TASK_MISMATCH');
    const root=path.resolve(checkout);
    if(await fs.realpath(root)!==root)throw Error('SCRATCH_LINK');
    await dir(root);await dir(path.join(root,'.git'));
    // Local clone config must be checked BEFORE any Git executable is
    // invoked: status can otherwise execute malicious filters/fsmonitor.
    const configPath=path.join(root,'.git','config');
    const configStat=await fs.lstat(configPath);
    if(!configStat.isFile()||configStat.isSymbolicLink()||
       configStat.uid!==process.getuid()||configStat.nlink!==1||
       configStat.size>100000)throw Error('SCRATCH_GIT_CONFIG_UNVERIFIED');
    validateScratchGitConfig(await fs.readFile(configPath,'utf8'));
    if(await git(root,['rev-parse','--show-toplevel'])!==root||
       await git(root,['rev-parse','--git-dir'])!=='.git'||
       await git(root,['rev-parse','--abbrev-ref','HEAD'])!=='HEAD'||
       await git(root,['rev-parse','HEAD'])!==baseSha||
       await git(root,['status','--porcelain=v1','--untracked-files=all'])!=='')
      throw Error('GIT_BASE_OR_SCRATCH_UNVERIFIED');
    const result=[];let total=0;
    for(let i=0;i<paths.length;i++){
      const p=paths[i],expected=task.files[i],target=path.join(root,p);
      let parent=root;
      for(const segment of p.split('/').slice(0,-1)){
        parent=path.join(parent,segment);await dir(parent);
      }
      let source='';
      try{
        const st=await fs.lstat(target);
        if(expected.beforeSha256===null||!st.isFile()||st.isSymbolicLink()||
           st.nlink!==1||st.uid!==process.getuid()||st.size>15000)
          throw Error('SOURCE_ENTRY_UNVERIFIED');
        source=await fs.readFile(target,'utf8');
      }catch(e){
        if(e.code!=='ENOENT'||expected.beforeSha256!==null)
          throw Error('SOURCE_ENTRY_UNVERIFIED');
      }
      total+=Buffer.byteLength(source);
      if(total>30000||source.includes('\0')||
         (expected.beforeSha256!==null&&sum(source)!==expected.beforeSha256))
        throw Error('SOURCE_CONTENT_UNVERIFIED');
      result.push(Object.freeze({path:p,beforeSha256:expected.beforeSha256,
        content:source}));
    }
    if(await git(root,['rev-parse','HEAD'])!==baseSha||
       await git(root,['status','--porcelain=v1','--untracked-files=all'])!=='')
      throw Error('GIT_MOVED_DURING_READ');
    return Object.freeze(result);
  };
}
