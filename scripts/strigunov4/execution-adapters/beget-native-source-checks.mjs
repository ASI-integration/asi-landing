/**
 * Native V2 local checks for the ORIGINAL single-lock Publisher.
 * Read-only Bubblewrap, no network, no caller-selected command, no imported
 * model code in the trusted host process and no second execution daemon.
 * A valid diff alone is NOT test evidence.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {must} from './state.mjs';
import {nativeDevelopmentPath,isNativeSourceModification} from '../source-publisher-handoff.mjs';

const ROOT_TEST=/^scripts\/strigunov4\/[A-Za-z0-9_-]+\.test\.mjs$/;
const TESTS_TEST=/^tests\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.test\.mjs$/;
const RU_FIXTURE='tests/telegram-live-identity-acceptance.ru.json';
const RU_CASES=[
  'unknown_greeting_ru','unknown_greeting_en','self_declared_guest',
  'lead_intent','self_declared_owner'
];
const deny=x=>{throw Error(x);};
function jsonRuCase(s){
  if(!s||typeof s!=='object'||Array.isArray(s)||
    !RU_CASES.includes(s.name)||
    typeof s.input!=='string'||s.input.length<1||s.input.length>350||
    !s.assertions||typeof s.assertions!=='object'||Array.isArray(s.assertions))return false;
  const keys=Object.keys(s.assertions);
  if(keys.some(x=>!['should_include_any','must_not_include_any'].includes(x))||
    !Array.isArray(s.assertions.should_include_any)||
    s.assertions.should_include_any.length<1)return false;
  const arrays=keys.map(k=>s.assertions[k]);
  return arrays.every(a=>Array.isArray(a)&&a.length>=1&&a.length<=12&&
    a.every(x=>typeof x==='string'&&x.length>0&&x.length<=350));
}
/** Fixed RU fixture; never execute data from an arbitrary JSON file. */
export function inspectNativeRuIdentityFixture(text){
  try{
    if(typeof text!=='string'||Buffer.byteLength(text)>15000) return false;
    const x=JSON.parse(text);
    return x&&typeof x==='object'&&!Array.isArray(x)&&
      Object.keys(x).sort().join(',')==='cases,reset_command,reset_expected_reply'&&
      x.reset_command==='/reset_identity'&&
      x.reset_expected_reply==='Идентичность и сессия сброшены для acceptance-тестирования.'&&
      Array.isArray(x.cases)&&x.cases.length===5&&
      x.cases.every(jsonRuCase)&&
      RU_CASES.every((name,i)=>x.cases[i].name===name);
  }catch{return false;}
}
export function parseNativeNodeTestSummary(output){
  must(typeof output==='string'&&Buffer.byteLength(output)<=160000,'NATIVE_TEST_OUTPUT_UNTRUSTED');
  const last=pattern=>[...output.matchAll(pattern)].at(-1)?.[1];
  const n=Number(last(/^# tests ([0-9]+)\r?$/gm));
  const pass=Number(last(/^# pass ([0-9]+)\r?$/gm));
  const fail=Number(last(/^# fail ([0-9]+)\r?$/gm));
  const skip=Number(last(/^# skipped ([0-9]+)\r?$/gm));
  const cancel=Number(last(/^# cancelled ([0-9]+)\r?$/gm));
  const todo=Number(last(/^# todo ([0-9]+)\r?$/gm));
  must(Number.isSafeInteger(n)&&n>0&&n<=1000&&
    pass===n&&fail===0&&skip===0&&cancel===0&&todo===0,
    'NATIVE_TESTS_NOT_COMPLETED');
  return n;
}
const defaultExecute=(exe,args,{cwd,signal,timeoutMs})=>new Promise((resolve,reject)=>{
  const child=execFile(exe,args,{cwd,signal,timeout:timeoutMs,killSignal:'SIGKILL',
    maxBuffer:180000,env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8',
      GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',
      GIT_TERMINAL_PROMPT:'0'}},
    (error,stdout)=>error?reject(Error('NATIVE_ISOLATED_TEST_PROCESS_FAILED')):resolve(stdout));
  child.stdin.end();
});
export function nativeBwrapNodeArguments({workspace,nodeExecutable,testPath}){
  must(typeof workspace==='string'&&path.isAbsolute(workspace)&&
    typeof nodeExecutable==='string'&&path.isAbsolute(nodeExecutable)&&
    (ROOT_TEST.test(testPath)||TESTS_TEST.test(testPath))&&
    nativeDevelopmentPath(testPath),'NATIVE_ISOLATED_TEST_SCOPE');
  return ['--die-with-parent','--new-session','--unshare-all',
    '--ro-bind','/usr','/usr','--ro-bind','/lib','/lib',
    '--ro-bind-try','/lib64','/lib64','--dev','/dev','--tmpfs','/tmp',
    '--ro-bind',nodeExecutable,'/node','--ro-bind',workspace,'/work',
    '--chdir','/work','--clearenv','--setenv','PATH','/usr/bin:/bin',
    '--setenv','LANG','C.UTF-8',
    '/node','--test','./'+testPath];
}
/**
 * Called only AFTER verifyPreparedDelta and again followed by same-delta
 * verification in host-runtime. A test report is not an owner signature,
 * independent model review, release-gate PASS or protected installation.
 */
export async function runNativeSourceChecks({
  task,workspace,nodeExecutable,bwrapExecutable='/usr/bin/bwrap',
  signal,execute=defaultExecute,timeoutMs=20000
}={}){
  must(isNativeSourceModification(task)&&
    typeof workspace==='string'&&path.isAbsolute(workspace)&&
    typeof nodeExecutable==='string'&&path.isAbsolute(nodeExecutable)&&
    bwrapExecutable==='/usr/bin/bwrap'&&
    Number.isSafeInteger(timeoutMs)&&timeoutMs>=1000&&timeoutMs<=30000&&
    typeof execute==='function'&&signal?.aborted!==true,
    'NATIVE_SOURCE_CHECK_AUTHORITY');
  let total=0,validated=0;
  for(const c of task.changes){
    must(nativeDevelopmentPath(c.path),'NATIVE_DEVELOPMENT_CHECK_SCOPE');
    if(c.path===RU_FIXTURE){
      const text=await fs.readFile(path.join(workspace,c.path),'utf8');
      must(inspectNativeRuIdentityFixture(text),'NATIVE_RU_FIXTURE_NOT_VALIDATED');
      validated++;
    }else {
      const args=nativeBwrapNodeArguments({workspace,nodeExecutable,testPath:c.path});
      const raw=await execute(bwrapExecutable,args,{cwd:workspace,signal,timeoutMs});
      total+=parseNativeNodeTestSummary(raw);
    }
    must(signal?.aborted!==true,'NATIVE_CHECK_ABORTED');
  }
  must(total+validated>0,'NATIVE_TEST_COVERAGE_MISSING');
  return Object.freeze({status:'PASS',testsExecuted:total,
    validatedFixtures:validated,isolated:true,networkDisabled:true});
}
