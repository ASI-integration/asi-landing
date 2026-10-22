import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  inspectLegacy, readLegacyFiles, createOrchestrator, atomicWriteJson,
} from './ASI-STRIGUNOV4-ORCHESTRATOR-CANDIDATE-20261020.mjs';
const SHA='a'.repeat(40);
const HEAD='b'.repeat(40);
const TICKET='g1-unit-apply-source';
function fixture(){
  const contract={schemaVersion:'asi.demo-release.v1',releaseId:'STRIGUNOV4-READY-FOR-DEMO',state:'FROZEN_ON_OWNER_MERGE',
    stages:[1,2,3,4,5,6].map(i=>({id:`S4-G${i}`,status:i===1?'IN_PROGRESS':'NOT_STARTED',proof:[],
      files:i===1?['scripts/strigunov4/protected_c4_unit_apply.py']:[],
      plannedFiles:i===1?['scripts/strigunov4/protected_c4_unit_apply.py','.github/workflows/strigunov4-c4-unit-apply.yml','scripts/strigunov4/test_protected_c4_unit_apply.py']:[]}))};
  const prs=Object.fromEntries([[509,'b3c8ff2e4904b0b503197d29aa217773918831bc'],[508,'8ac8e8ac11e39ac070ccc058218e3b73190cb43f'],[520,'6693312b0a94b8afcee3a34907055ce301a5fb3e']].map(([n,head])=>[n,{number:n,head,state:'open',merged:false}]));
  return {mainSha:SHA,contract,issues:{511:{number:511,state:'open',labels:['agent-source-ready']}},project:{511:'PREPARATION_ONLY'},prs,
    checks:{509:{head:prs[509].head,validate:'success',release_governance:'success'}},
    reviews:{509:{head:prs[509].head,completed:true,actionable:false}},ledger:{}};
}
const defaults=()=>({receipts:{version:1,completed:[]},heartbeat:null,autopilotLedger:null});
const orders=['scripts/strigunov4/protected_c4_unit_apply.py','.github/workflows/strigunov4-c4-unit-apply.yml','scripts/strigunov4/test_protected_c4_unit_apply.py'];
let dir;
async function setup(){dir=await fs.mkdtemp(path.join(os.tmpdir(),'asi-bridge-test-'));return dir;}
async function cleanup(){if(dir)await fs.rm(dir,{recursive:true,force:true});dir=null;}
async function make({snapshot=fixture(),legacy=defaults(),authorize,dispatch,verifyPublication}={}){
  await setup();
  for(const [name,value] of [['receipts.json',legacy.receipts],['heartbeat.json',legacy.heartbeat],['autopilot-ledger.json',legacy.autopilotLedger]]){
    if(value!==null)await fs.writeFile(path.join(dir,name),JSON.stringify(value));
  }
  const calls={dispatch:0,authorize:0,verify:0};
  const x=createOrchestrator({stateDir:dir,fetchSnapshot:async()=>structuredClone(snapshot),
    authorize:async env=>{calls.authorize++;return authorize?authorize(env):{approved:false};},
    dispatch:async env=>{calls.dispatch++;return dispatch?dispatch(env):{publishedPr:521,head:HEAD};},
    verifyPublication:async (...args)=>{calls.verify++;return verifyPublication?verifyPublication(...args):true;}});
  return {x,calls};
}
test('01 empty legacy journals do not assert physical acceptance',()=>{
  assert.deepEqual(inspectLegacy(defaults()),{safe:true,reason:null});
});
test('02 FAILED receipt blocks automatically',()=>{
  assert.match(inspectLegacy({receipts:{version:1,completed:[{id:'audit',sha:SHA,status:'FAILED'}]},heartbeat:null,autopilotLedger:null}).reason,/RECEIPT_RECONCILIATION/);
});
test('03 STALE receipt blocks automatically',()=>{
  assert.match(inspectLegacy({receipts:{version:1,completed:[{id:'audit',sha:SHA,status:'STALE'}]},heartbeat:null,autopilotLedger:null}).reason,/RECEIPT_RECONCILIATION/);
});
test('04 invalid receipt status cannot be trusted',()=>{
  assert.equal(inspectLegacy({receipts:{version:1,completed:[{id:'audit',sha:SHA,status:'MYSTERY'}]},heartbeat:null,autopilotLedger:null}).safe,false);
});
test('05 prior RUNNING heartbeat cannot be assumed complete',()=>{
  assert.equal(inspectLegacy({receipts:{version:1,completed:[]},heartbeat:{mode:'RUNNING'},autopilotLedger:null}).safe,false);
});
test('06 old STARTED ledger cannot be retried',()=>{
  assert.equal(inspectLegacy({receipts:{version:1,completed:[]},heartbeat:null,autopilotLedger:{mode:'STARTED'}}).safe,false);
});
test('07 old FAILED_LOCKED ledger cannot be retried',()=>{
  assert.equal(inspectLegacy({receipts:{version:1,completed:[]},heartbeat:null,autopilotLedger:{mode:'FAILED_LOCKED'}}).safe,false);
});
test('08 unknown ledger mode blocks safely',()=>{
  assert.equal(inspectLegacy({receipts:{version:1,completed:[]},heartbeat:null,autopilotLedger:{mode:'SOMETHING'}}).safe,false);
});
test('09 read-only inspect never invokes authorizer, Codex, or publisher',async()=>{
  const {x,calls}=await make();try{const r=await x.iteration();assert.equal(r.mode,'SOURCE_PLAN_AVAILABLE');assert.equal(calls.dispatch,0);assert.equal(calls.authorize,0);}finally{await cleanup();}
});
test('10 no independent authorization prevents execution',async()=>{
  const {x,calls}=await make();try{const r=await x.iteration({execute:true});assert.equal(r.mode,'WAIT_AUTHORIZATION');assert.equal(calls.dispatch,0);}finally{await cleanup();}
});
test('11 authorizer must bind job, main SHA, and all exact paths',async()=>{
  const {x,calls}=await make({authorize:()=>({approved:true,job:TICKET,mainSha:'c'.repeat(40),paths:orders})});
  try{assert.equal((await x.iteration({execute:true})).mode,'WAIT_AUTHORIZATION');assert.equal(calls.dispatch,0);}finally{await cleanup();}
});
test('12 explicit matching source-only authorization can dispatch once',async()=>{
  const {x,calls}=await make({authorize:env=>({approved:true,job:env.job,mainSha:env.mainSha,paths:env.paths}),dispatch:async()=>({publishedPr:522,head:HEAD})});
  try{const r=await x.iteration({execute:true});assert.equal(r.mode,'PUBLISHED');assert.equal(calls.dispatch,1);assert.equal(calls.verify,1);
    const state=JSON.parse(await fs.readFile(path.join(dir,'orchestrator-state.json'),'utf8'));assert.equal(state.operation.status,'PUBLISHED');
  }finally{await cleanup();}
});
test('13 two consecutive iterations must not replay published work',async()=>{
  const {x,calls}=await make({authorize:env=>({approved:true,job:env.job,mainSha:env.mainSha,paths:env.paths})});
  try{assert.equal((await x.iteration({execute:true})).mode,'PUBLISHED');assert.equal((await x.iteration({execute:true})).mode,'WAIT_RECONCILIATION');assert.equal(calls.dispatch,1);}finally{await cleanup();}
});
test('14 exception after STARTED locks job rather than retrying',async()=>{
  const {x,calls}=await make({authorize:env=>({approved:true,job:env.job,mainSha:env.mainSha,paths:env.paths}),dispatch:async()=>{throw Error('simulated provider timeout');}});
  try{assert.equal((await x.iteration({execute:true})).mode,'FAILED_LOCKED');assert.equal((await x.iteration({execute:true})).mode,'WAIT_RECONCILIATION');assert.equal(calls.dispatch,1);}finally{await cleanup();}
});
test('15 publication without verified PR stays FAILED_LOCKED',async()=>{
  const {x,calls}=await make({authorize:env=>({approved:true,job:env.job,mainSha:env.mainSha,paths:env.paths}),verifyPublication:async()=>false});
  try{assert.equal((await x.iteration({execute:true})).mode,'FAILED_LOCKED');assert.equal(calls.dispatch,1);}finally{await cleanup();}
});
test('16 crash-simulated STARTED state is never resumed blindly',async()=>{
  const {x,calls}=await make({authorize:env=>({approved:true,job:env.job,mainSha:env.mainSha,paths:env.paths})});
  try{await fs.writeFile(path.join(dir,'orchestrator-state.json'),JSON.stringify({version:1,operation:{status:'STARTED',job:TICKET,mainSha:SHA}}));
    assert.equal((await x.iteration({execute:true})).mode,'WAIT_RECONCILIATION');assert.equal(calls.dispatch,0);
  }finally{await cleanup();}
});
test('17 concurrent callers cannot both execute a job',async()=>{
  const {x,calls}=await make({authorize:env=>({approved:true,job:env.job,mainSha:env.mainSha,paths:env.paths}),dispatch:async()=>{await new Promise(resolve=>setTimeout(resolve,60));return {publishedPr:522,head:HEAD};}});
  try{const result=await Promise.all([x.iteration({execute:true}),x.iteration({execute:true})]);assert.deepEqual(result.map(x=>x.mode).sort(),['PUBLISHED','WAIT_LOCKED']);assert.equal(calls.dispatch,1);}finally{await cleanup();}
});
test('18 red physical-gate never dispatches even with permissive authorizer',async()=>{
  const snap=fixture();snap.contract.stages[0].status='ACCEPTED';snap.contract.stages[1].status='IN_PROGRESS';snap.issues={512:{number:512,state:'open',labels:['agent-source-ready']}};
  const {x,calls}=await make({snapshot:snap,authorize:env=>({approved:true,job:env.job,mainSha:env.mainSha,paths:env.paths})});
  try{const r=await x.iteration({execute:true});assert.equal(r.mode,'OBSERVE_ONLY');assert.equal(calls.dispatch,0);}finally{await cleanup();}
});
test('19 symlink to journal is refused, not followed',async()=>{
  await setup();try{await fs.writeFile(path.join(dir,'private.json'),'{}');await fs.symlink(path.join(dir,'private.json'),path.join(dir,'receipts.json'));
    await assert.rejects(readLegacyFiles(dir),/JOURNAL_NOT_REGULAR/);
  }finally{await cleanup();}
});
test('20 atomic writer leaves valid JSON and no temporary files',async()=>{
  await setup();try{await atomicWriteJson(path.join(dir,'state.json'),{a:1});await atomicWriteJson(path.join(dir,'state.json'),{a:2});
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir,'state.json'),'utf8')),{a:2});
    assert.equal((await fs.readdir(dir)).filter(x=>x.endsWith('.tmp')).length,0);
  }finally{await cleanup();}
});

test('21 exception text never reaches durable journals',async()=>{
 for(const port of ['dispatch','verifyPublication']){
  const secret='GH_TOKEN_CANARY_DO_NOT_STORE';
  const options={authorize:env=>({approved:true,job:env.job,mainSha:env.mainSha,paths:env.paths}),[port]:async()=>{throw Error(secret);}};
  const {x}=await make(options);
  try{
   assert.equal((await x.iteration({execute:true})).mode,'FAILED_LOCKED');
   const raw=await fs.readFile(path.join(dir,'orchestrator-state.json'),'utf8');
   assert.equal(raw.includes(secret),false);
   assert.equal(JSON.parse(raw).operation.error,'DISPATCH_OR_VERIFICATION_FAILED');
   assert.equal((await x.iteration({execute:true})).mode,'WAIT_RECONCILIATION');
  }finally{await cleanup();}
 }
});
