import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {fixture,makeLoop} from './publisher-fixture.mjs';
import {createPublisherTransport} from './publisher-transport.mjs';
import {createGitHubReader} from './github-readonly.mjs';
import {inspectStandingTransaction} from './state.mjs';

test('one real publication transaction supplies all snapshot, preflight, write and review ports',async t=>{
 const native=globalThis.fetch;t.after(()=>{globalThis.fetch=native;});
 const f=await fixture(t),seen=[];let lease,factories=0;
 const loop=await makeLoop(f,{transactionPorts:async({store,transaction})=>{
  factories++;lease=transaction;const first=inspectStandingTransaction(transaction);
  assert.equal(first.phase,'admission');assert.equal(Object.keys(first.ledger.jobs).length,0);
  assert.equal(JSON.parse(await fs.readFile(store.file('autopilot-ledger.json'),'utf8')).reason,'IN_FLIGHT_OR_CRASHED');
  // A synthetic test hook, NOT a signed authority or an adoption proof.
  const requestAdmission=async d=>{const p=inspectStandingTransaction(transaction);seen.push({phase:p.phase,method:d.method,route:d.route});return true;};
  const reader=createGitHubReader({token:'INERT_FIXTURE_ONLY',requestAdmission});
  const remote=createPublisherTransport({token:'INERT_FIXTURE_ONLY',requestAdmission});
  return {remote,reader,fetchSnapshot:async({transaction:current})=>{
   assert.equal(current,transaction);await reader.get('branches/main');return structuredClone(f.snapshot);
  }};
 }});
 const result=await loop.poll({execute:true});assert.equal(result.mode,'REPORT_READY');
 assert.equal(factories,1);assert.equal(seen.length,f.requests.length);
 for(const phase of ['admission','preflight','started','postflight'])assert(seen.some(x=>x.phase===phase),phase);
 assert(seen.some(x=>x.route==='graphql'&&x.phase==='started'));
 assert(seen.filter(x=>x.method==='POST'&&x.route!=='graphql').every(x=>x.phase==='started'));
 assert.throws(()=>inspectStandingTransaction(lease),/STANDING_TRANSACTION_INVALID|STANDING_TRANSACTION_CLOSED/);
});

test('pre-STARTED request rejection leaves crash brake and no publication or automatic retry',async t=>{
 const native=globalThis.fetch;t.after(()=>{globalThis.fetch=native;});
 const f=await fixture(t);let attempts=0;
 const loop=await makeLoop(f,{transactionPorts:async({transaction})=>{
  const requestAdmission=async()=>{attempts++;assert.equal(inspectStandingTransaction(transaction).phase,'admission');return false;};
  const reader=createGitHubReader({token:'INERT_FIXTURE_ONLY',requestAdmission});
  return {reader,remote:createPublisherTransport({token:'INERT_FIXTURE_ONLY',requestAdmission}),fetchSnapshot:async()=>{await reader.get('branches/main');return f.snapshot;}};
 }});
 assert.equal((await loop.poll({execute:true})).mode,'FAILED_LOCKED');
 assert.equal((await loop.poll({execute:true})).mode,'FAILED_LOCKED');
 assert.equal(attempts,1);assert.equal(f.requests.length,0);assert.equal(f.writes.length,0);
});

test('invalid factory output never falls back to unmetered legacy ports',async t=>{
 const native=globalThis.fetch;t.after(()=>{globalThis.fetch=native;});
 const f=await fixture(t);let getters=0;
 const loop=await makeLoop(f,{transactionPorts:async()=>({get reader(){getters++;return {};},remote:{},fetchSnapshot:async()=>f.snapshot})});
 assert.equal((await loop.poll({execute:true})).mode,'FAILED_LOCKED');
 assert.equal(getters,0);assert.equal(f.requests.length,0);
});

test('mutable factory transport cannot swap request methods after admission',async t=>{
 const native=globalThis.fetch;t.after(()=>{globalThis.fetch=native;});
 const f=await fixture(t);
 const loop=await makeLoop(f,{transactionPorts:async()=>({
  remote:{...createPublisherTransport({token:'INERT_FIXTURE_ONLY'})},
  reader:createGitHubReader({token:'INERT_FIXTURE_ONLY'}),fetchSnapshot:async()=>f.snapshot,
 })});
 assert.equal((await loop.poll({execute:true})).mode,'FAILED_LOCKED');assert.equal(f.requests.length,0);
});
