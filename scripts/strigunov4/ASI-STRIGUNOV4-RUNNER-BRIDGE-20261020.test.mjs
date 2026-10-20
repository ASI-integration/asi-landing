import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createReadOnlyRunnerBridge,selectRoute} from './ASI-STRIGUNOV4-RUNNER-BRIDGE-20261020.mjs';
const SHA='a'.repeat(40);
const X='5ba61e734a1f9a56cd807eee91b4e217bf6ee040';
const Y='8ac8e8ac11e39ac070ccc058218e3b73190cb43f';
const Z='6693312b0a94b8afcee3a34907055ce301a5fb3e';
const paths=['scripts/strigunov4/protected_c4_unit_apply.py','.github/workflows/strigunov4-c4-unit-apply.yml','scripts/strigunov4/test_protected_c4_unit_apply.py'];
function snapshot(){
 const prs={509:{number:509,head:X,state:'open',merged:false},508:{number:508,head:Y,state:'open',merged:false},520:{number:520,head:Z,state:'open',merged:false}};
 return {mainSha:SHA,contract:{schemaVersion:'asi.demo-release.v1',releaseId:'STRIGUNOV4-READY-FOR-DEMO',state:'FROZEN_ON_OWNER_MERGE',stages:[1,2,3,4,5,6].map(i=>({id:'S4-G'+i,status:i===1?'IN_PROGRESS':'NOT_STARTED',proof:[],files:[],plannedFiles:i===1?paths:[]}))},issues:{511:{number:511,state:'open',labels:['agent-source-ready']}},project:{511:'PREPARATION_ONLY'},prs,checks:{509:{head:X,validate:'success',release_governance:'success'}},reviews:{509:{head:X,completed:true,actionable:false}},ledger:{}};
}
const dir=async()=>await fs.mkdtemp(path.join(os.tmpdir(),'asi-runner-bridge-'));
const clean=async p=>fs.rm(p,{recursive:true,force:true});
test('01 initial status is a safe WAIT',async()=>{
 const p=await dir();try{const b=createReadOnlyRunnerBridge({stateDir:p,fetchSnapshot:async()=>snapshot()});assert.equal(b.status().mode,'WAIT');assert.equal(typeof b.execute,'undefined');}finally{await clean(p);}
});
test('02 polling is read-only even for admitted source ticket',async()=>{
 const p=await dir();try{const b=createReadOnlyRunnerBridge({stateDir:p,fetchSnapshot:async()=>snapshot()});const r=await b.poll();assert.equal(r.mode,'SOURCE_PLAN_AVAILABLE');assert.equal((await fs.readdir(p)).length,0);}finally{await clean(p);}
});
test('03 180-second polling budget suppresses repeated source reads',async()=>{
 const p=await dir();let t=10000,n=0;try{const b=createReadOnlyRunnerBridge({stateDir:p,fetchSnapshot:async()=>{n++;return snapshot()},clock:()=>t});await b.poll();t+=30000;await b.poll();t+=149999;await b.poll();assert.equal(n,1);t++;await b.poll();assert.equal(n,2);}finally{await clean(p);}
});
test('04 concurrent ticks are single-flight',async()=>{
 const p=await dir();let n=0;try{const b=createReadOnlyRunnerBridge({stateDir:p,fetchSnapshot:async()=>{n++;await new Promise(r=>setTimeout(r,25));return snapshot();}});const rs=await Promise.all([b.poll(),b.poll(),b.poll()]);assert.equal(n,1);assert.ok(rs.every(x=>x.mode==='SOURCE_PLAN_AVAILABLE'));}finally{await clean(p);}
});
test('05 existing legacy autopilot ledger blocks execution instead of replay',async()=>{
 const p=await dir();try{await fs.writeFile(path.join(p,'autopilot-ledger.json'),JSON.stringify({mode:'PUBLISHED',job:'S4-G1',pr:520}));const b=createReadOnlyRunnerBridge({stateDir:p,fetchSnapshot:async()=>snapshot()});assert.equal((await b.poll()).mode,'WAIT_RECONCILIATION');assert.equal((await fs.readdir(p)).length,1);}finally{await clean(p);}
});
test('06 failures remain fail-closed',async()=>{
 const p=await dir();try{const b=createReadOnlyRunnerBridge({stateDir:p,fetchSnapshot:async()=>{throw Error('API not available');}});assert.equal((await b.poll()).mode,'WAIT_RECONCILIATION');}finally{await clean(p);}
});
test('07 next stage can be selected without S4-G1 hardcode',()=>{
 const s=snapshot();s.contract.stages[0].status='ACCEPTED';s.contract.stages[1].status='IN_PROGRESS';assert.deepEqual(selectRoute(s.contract,{number:512,state:'open',title:'[S4-G2] operator'}),{stage:'S4-G2',issue:512,mode:'ACTIVE'});
});
test('08 stage cannot be skipped using an arbitrary issue number',()=>{
 assert.throws(()=>selectRoute(snapshot().contract,{number:513,state:'open',title:'[S4-G3] spoofed'}),/ACTIVE_ISSUE_NOT_VERIFIED/);
});
test('09 unacceptable poll interval is rejected',async()=>{
 const p=await dir();try{assert.throws(()=>createReadOnlyRunnerBridge({stateDir:p,fetchSnapshot:async()=>snapshot(),intervalMs:1000}),/INVALID_POLL_INTERVAL/);}finally{await clean(p);}
});
test('10 backwards clock does not cause an unbounded loop',async()=>{
 const p=await dir();let t=180000;try{const b=createReadOnlyRunnerBridge({stateDir:p,fetchSnapshot:async()=>snapshot(),clock:()=>t});await b.poll();t-=1;assert.equal((await b.poll()).reason,'CLOCK_MOVED_BACKWARDS');}finally{await clean(p);}
});
