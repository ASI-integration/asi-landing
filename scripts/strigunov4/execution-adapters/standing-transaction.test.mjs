import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {initializeState,existingState,inspectStandingTransaction} from './state.mjs';

const task=()=>({id:'lease-task',sha:'a'.repeat(40),repo:'ASI-integration/asi-landing',stage:'S4-G1',pr:null,branch:'asi/lease-fixture'});
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'standing-transaction-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return initializeState(root);}

test('real execute lease covers admission and both read phases without permitting early writes',async t=>{
 const store=await fixture(t), selected=task(), phases=[];let lease;
 const result=await store.execute('github-publisher',({transaction})=>{
  lease=transaction;const view=inspectStandingTransaction(transaction);phases.push(view.phase);
  assert.equal(view.taskId,null);assert.throws(()=>inspectStandingTransaction(transaction,{write:true}),/STANDING_WRITE_PHASE/);
  assert.throws(()=>inspectStandingTransaction(transaction,{taskId:selected.id}),/STANDING_TASK_UNSELECTED/);return selected;
 },{verifyTask:async(value,{transaction})=>{const view=inspectStandingTransaction(transaction,{taskId:value.id,taskSha:value.sha});phases.push(view.phase);assert.throws(()=>inspectStandingTransaction(transaction,{write:true}),/STANDING_WRITE_PHASE/);return {sha:value.sha};}},async({transaction})=>{
  const view=inspectStandingTransaction(transaction,{write:true,taskId:selected.id,taskSha:selected.sha});phases.push(view.phase);assert.equal(view.kind,'github-publisher');assert.equal(view.ledger.jobs[selected.id].mode,'STARTED');return {status:'PASS'};
 });
 assert.equal(result.status,'PASS');assert.deepEqual(phases,['admission','preflight','started','postflight']);assert.throws(()=>inspectStandingTransaction(lease),/STANDING_TRANSACTION_INVALID/);assert.throws(()=>inspectStandingTransaction({...lease}),/STANDING_TRANSACTION_INVALID/);
});

test('wrong task, changed original SHA and multiple STARTED jobs fail closed',async t=>{
 const store=await fixture(t), selected=task();
 const result=await store.execute('github-publisher',selected,{verifyTask:async()=>({sha:'a'.repeat(40)})},async({transaction})=>{
  assert.throws(()=>inspectStandingTransaction(transaction,{taskId:'other'}),/STANDING_TASK_MISMATCH/);
  const view=inspectStandingTransaction(transaction);selected.sha='b'.repeat(40);assert.throws(()=>inspectStandingTransaction(transaction),/STANDING_TASK_CHANGED/);selected.sha='a'.repeat(40);
  view.ledger.jobs.other={mode:'STARTED'};assert.throws(()=>inspectStandingTransaction(transaction,{write:true}),/STANDING_STARTED_TASK_MISMATCH/);delete view.ledger.jobs.other;
  view.ledger.jobs[selected.id].sha='c'.repeat(40);assert.throws(()=>inspectStandingTransaction(transaction),/STANDING_STARTED_TASK_MISMATCH/);view.ledger.jobs[selected.id].sha=selected.sha;return {status:'PASS'};
 });assert.equal(result.status,'PASS');
});

test('forged lease is rejected and real lease closes before unknown-result recovery',async t=>{
 assert.throws(()=>inspectStandingTransaction({}),/STANDING_TRANSACTION_INVALID/);
 const store=await fixture(t);let lease;
 const result=await store.execute('github-publisher',task(),{verifyTask:async()=>({})},async({transaction})=>{lease=transaction;throw Error('offline fixture');});
 assert.equal(result.mode,'FAILED_LOCKED');assert.throws(()=>inspectStandingTransaction(lease),/STANDING_TRANSACTION_INVALID/);
 const reopened=await existingState(store.root);assert.equal((await reopened.execute('github-publisher',task(),{},()=>{})).reason,'PHYSICAL_REVIEW_REQUIRED');
});

test('separately opened state cannot mint competing lease while real lock is held',async t=>{
 const store=await fixture(t), second=await existingState(store.root);let enter,release,lease;const entered=new Promise(r=>enter=r),hold=new Promise(r=>release=r);
 const first=store.execute('github-publisher',async({transaction})=>{lease=transaction;enter();await hold;return null;},{},()=>{});
 await entered;const blocked=await second.execute('github-publisher',()=>{throw Error('must not enter');},{},()=>{});assert.equal(blocked.reason,'LOCK_HELD_OR_CRASHED_REQUIRES_REVIEW');assert.equal(inspectStandingTransaction(lease).phase,'admission');release();await first;assert.throws(()=>inspectStandingTransaction(lease),/STANDING_TRANSACTION_INVALID/);
});

test('non-Publisher transaction never gains write capability',async t=>{
 const store=await fixture(t);const result=await store.execute('source-review',task(),{verifyTask:async()=>({})},async({transaction})=>{assert.throws(()=>inspectStandingTransaction(transaction,{write:true}),/STANDING_WRITE_PHASE/);return {status:'PASS'};});assert.equal(result.status,'PASS');
});

async function childMessage(child){
 return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('fixture child timeout'));},5000);
  child.once('message',value=>{clearTimeout(timer);resolve(value);});
  child.once('error',e=>{clearTimeout(timer);reject(e);});
  child.once('exit',code=>{if(code!==0){clearTimeout(timer);reject(Error('fixture child exited'));}});
 });
}
const stateUrl=new URL('./state.mjs',import.meta.url).href;
test('independent process cannot enter an occupied real transaction',async t=>{
 const store=await fixture(t);let release,enter;const hold=new Promise(r=>release=r),entered=new Promise(r=>enter=r);
 const active=store.execute('github-publisher',async()=>{enter();await hold;return null;},{},()=>{});await entered;
 const code=`import {existingState} from ${JSON.stringify(stateUrl)};const s=await existingState(${JSON.stringify(store.root)});process.send(await s.execute('github-publisher',null,{},()=>{}));process.disconnect();`;
 const child=spawn(process.execPath,['--input-type=module','-e',code],{stdio:['ignore','ignore','ignore','ipc']});t.after(()=>child.kill('SIGKILL'));
 try{assert.equal((await childMessage(child)).reason,'LOCK_HELD_OR_CRASHED_REQUIRES_REVIEW');}finally{release();await active;}
});

test('SIGKILL after durable brake leaves real restart blocked and history intact',async t=>{
 const store=await fixture(t);
 const code=`import {existingState,inspectStandingTransaction} from ${JSON.stringify(stateUrl)};const s=await existingState(${JSON.stringify(store.root)});await s.execute('github-publisher',async({transaction})=>{process.send(inspectStandingTransaction(transaction).phase);await new Promise(()=>{});return null;},{},()=>{});`;
 const child=spawn(process.execPath,['--input-type=module','-e',code],{stdio:['ignore','ignore','ignore','ipc']});t.after(()=>child.kill('SIGKILL'));
 assert.equal(await childMessage(child),'admission');const exited=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGKILL');await exited;
 const before=await fs.readFile(store.file('autopilot-ledger.json'),'utf8');assert.equal(JSON.parse(before).reason,'IN_FLIGHT_OR_CRASHED');
 const reopened=await existingState(store.root);assert.equal((await reopened.execute('github-publisher',task(),{},()=>{})).reason,'LOCK_HELD_OR_CRASHED_REQUIRES_REVIEW');assert.equal(await fs.readFile(store.file('autopilot-ledger.json'),'utf8'),before);
});
