import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {inspectNativeRuIdentityFixture,nativeBwrapNodeArguments,
  parseNativeNodeTestSummary,runNativeSourceChecks} from './beget-native-source-checks.mjs';
const sha=v=>createHash('sha256').update(v).digest('hex');
const TEST='scripts/strigunov4/ASI-STRIGUNOV4-RUNNER-BRIDGE-20261020.test.mjs';
const JSON_PATH='tests/telegram-live-identity-acceptance.ru.json';
function sourceTask(p,content, laneId='engine'){
 const id='native-check-test';
 return {id,laneId,repo:'ASI-integration/asi-landing',stage:'S4-G2',
   kind:'github-publisher',pr:null,branch:'asi/engine-task/'+id,sha:'a'.repeat(40),
   sourceBinding:'b'.repeat(64),proposalDigest:'c'.repeat(64),
   changes:[{path:p,beforeSha256:'d'.repeat(64),afterSha256:sha(content),content}]};
}
const tap=({n=2,pass=n,fail=0,skip=0,todo=0,cancelled=0}={})=>
 'TAP version 13\n1..'+n+'\n# tests '+n+'\n# pass '+pass+
 '\n# fail '+fail+'\n# cancelled '+cancelled+'\n# skipped '+skip+'\n# todo '+todo+'\n';
test('actual Node TAP pass requires positive count and no skips/failures',()=>{
 assert.equal(parseNativeNodeTestSummary(tap()),2);
 for(const options of [{n:0},{n:2,pass:1,fail:1},{n:2,pass:1,skip:1},
   {n:2,pass:1,todo:1},{n:2,cancelled:1}])
   assert.throws(()=>parseNativeNodeTestSummary(tap(options)),/NATIVE_TESTS_NOT_COMPLETED/);
 // A model can print fake TAP lines. Only the final native harness summary
 // is accepted; an earlier forged success cannot overwrite the final zero.
 assert.throws(()=>parseNativeNodeTestSummary(tap()+tap({n:0})),
   /NATIVE_TESTS_NOT_COMPLETED/);
});
test('native sandbox is read-only and unshares network; no arbitrary command',()=>{
 const args=nativeBwrapNodeArguments({
  workspace:'/private/scratch',nodeExecutable:'/opt/asi-engine/node',testPath:TEST});
 assert(args.includes('--unshare-all')&&args.includes('--ro-bind')&&
   args.includes('--clearenv')&&args.includes('--tmpfs'));
 assert.equal(args.at(-1),'./'+TEST);
 assert(!args.includes('--bind'));
 for(const path of ['scripts/strigunov4/execution-adapters/host-runtime.mjs',
   'tests/telegram-live-identity-acceptance.ru.json','/bin/sh','scripts/test.js'])
   assert.throws(()=>nativeBwrapNodeArguments({workspace:'/private/scratch',
     nodeExecutable:'/opt/asi-engine/node',testPath:path}),/NATIVE_ISOLATED_TEST_SCOPE/);
});
test('node changes must actually complete isolated sandbox checks',async()=>{
 const content='import test from "node:test";test("pass",()=>{});';
 const task=sourceTask(TEST,content);let executions=0;
 const result=await runNativeSourceChecks({task,workspace:'/tmp/fake-native',
  nodeExecutable:'/opt/asi-engine/node',execute:async(exe,args)=>{
    executions++;assert.equal(exe,'/usr/bin/bwrap');
    assert.equal(args.at(-1),'./'+TEST);
    return tap();
  }});
 assert.equal(result.testsExecuted,2);
 assert.equal(result.isolated,true);
 assert.equal(executions,1);
 await assert.rejects(runNativeSourceChecks({
   task,workspace:'/tmp/fake-native',nodeExecutable:'/opt/asi-engine/node',
   execute:async()=>tap({n:0})
 }),/NATIVE_TESTS_NOT_COMPLETED/);
 await assert.rejects(runNativeSourceChecks({
   task,workspace:'/tmp/fake-native',nodeExecutable:'/opt/asi-engine/node',
   execute:async()=>{throw Error('NATIVE_ISOLATED_TEST_PROCESS_FAILED')}
 }),/NATIVE_ISOLATED_TEST_PROCESS_FAILED/);
});
test('RU signed identity fixture passes shape validation but cannot execute arbitrary JSON',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'asi-native-fixture-check-'));
 try{
  const text=JSON.stringify({
   reset_command:'/reset_identity',
   reset_expected_reply:'Идентичность и сессия сброшены для acceptance-тестирования.',
   cases:['unknown_greeting_ru','unknown_greeting_en','self_declared_guest',
    'lead_intent','self_declared_owner'].map(name=>({
    name,input:'example',assertions:{should_include_any:['example']}
   }))
  });
  assert.equal(inspectNativeRuIdentityFixture(text),true);
  const target=path.join(root,JSON_PATH);
  await fs.mkdir(path.dirname(target),{recursive:true});
  await fs.writeFile(target,text);
  const result=await runNativeSourceChecks({
   task:sourceTask(JSON_PATH,text,'ru-auth'),workspace:root,
   nodeExecutable:'/opt/asi-engine/node',
   execute:async()=>{throw Error('JSON_MUST_NOT_EXECUTE')}
  });
  assert.equal(result.testsExecuted,0);
  assert.equal(result.validatedFixtures,1);
  const changed=JSON.parse(text);changed.reset_command='/exec-untrusted';
  assert.equal(inspectNativeRuIdentityFixture(JSON.stringify(changed)),false);
  changed.reset_command='/reset_identity';changed.cases.pop();
  assert.equal(inspectNativeRuIdentityFixture(JSON.stringify(changed)),false);
  assert.equal(inspectNativeRuIdentityFixture('{"unexpected":"value"}'),false);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
