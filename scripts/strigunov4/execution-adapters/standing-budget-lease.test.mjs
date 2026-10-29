import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import * as state from './state.mjs';
const {initializeState,inspectStandingTransaction} = state;
// The protected main baseline has no genuine lease; these tests run on the
// exact #552 isolated source overlay. Skips on main are NOT proof of integration.
const leaseTest = typeof inspectStandingTransaction === 'function' ? test : test.skip;
import {createLeaseBoundStandingBudget} from './standing-budget-lease.mjs';

const at=1793260000000,base='c'.repeat(40),candidate='d'.repeat(40);
const h=s=>createHash('sha256').update(s).digest('hex');
const envelope=(patch={})=>({schema:'asi.release-envelope.proposal.v1',
  repo:'ASI-integration/asi-landing',environment:'beget-staging',target:'pqukibofpo',
  action:'source',envelopeDigest:'b'.repeat(64),securityDigest:'a'.repeat(64),
  policyDigest:'e'.repeat(64),paidApiUsd:0,notBefore:at-1000,expiresAt:at+100000,
  maxOperations:5,maxRequests:5,maxWrites:2,...patch});
const task=()=>({id:'source-task',sha:base,kind:'github-publisher',stage:'S4-G1',
  repo:'ASI-integration/asi-landing',branch:'asi/engine-task/source-task',pr:null});
function effect(id,lease,kind='github-read',override={}) {
  const method=kind==='github-read'?'GET':'POST';
  const route=kind==='github-read'?'branches/main':'git/trees';
  const payloadSha256=h(method==='GET'?'':JSON.stringify({id}));
  const requestSha256=h(JSON.stringify({method,route,payloadSha256}));
  return {effectId:id,taskId:lease.taskId??`admission-${lease.transactionId}`,
    taskSha:lease.taskSha??base,headSha:candidate,kind,method,route,payloadSha256,
    requestSha256,envelopeDigest:'b'.repeat(64),repo:'ASI-integration/asi-landing',
    environment:'beget-staging',target:'pqukibofpo',action:'source',...override};
}
async function fixture() {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'asi-p0-lease-'));
  const store=await initializeState(root);
  const read=async()=>JSON.parse(await fs.readFile(store.file('autopilot-ledger.json'),'utf8'));
  const close=()=>fs.rm(root,{recursive:true,force:true});
  return {root,store,read,close};
}
const bound=t=>createLeaseBoundStandingBudget({transaction:t,pinnedBaseSha:base,clock:()=>at});

leaseTest('real execute lease meters admission GET, preflight GET, STARTED POST and postflight GET',async()=>{
  const f=await fixture();try {
    let t,b;let verified=0;const results=[];
    const outcome=await f.store.execute('github-publisher',async({transaction})=>{
      t=transaction;b=bound(t);const lease=inspectStandingTransaction(t);
      results.push(await b.reserve({envelope:envelope(),effect:effect('admission',lease)}));
      return task();
    },{async verifyTask(){
      const lease=inspectStandingTransaction(t);verified++;
      results.push(await b.reserve({envelope:envelope(),effect:effect('verify-'+verified,lease)}));
      return {baseSha:base};
    }},async()=>{
      const lease=inspectStandingTransaction(t,{write:true});
      results.push(await b.reserve({envelope:envelope(),effect:effect('write',lease,'create-tree')}));
      return {status:'WAITING'};
    });
    assert.equal(outcome.mode,'WAITING');
    assert.equal(verified,2);
    assert.deepEqual(results.map(x=>x.status),['RESERVED','RESERVED','RESERVED','RESERVED']);
    assert.ok(results.every(x=>x.authorized===false));
    const state=await f.read(),entry=state.standingDelegationBudget.envelopes['b'.repeat(64)];
    assert.equal(entry.requests,4);assert.equal(entry.operations,4);assert.equal(entry.writes,1);
    assert.equal(new Set(entry.claims.map(x=>x.taskId)).size,2);
    assert.equal(state.mode,'IDLE');
  } finally {await f.close();}
});

leaseTest('existing lock directory or fabricated transaction cannot mint actual execute lease',async()=>{
  const f=await fixture();try {
    await fs.mkdir(f.store.file('execution.lock'));
    assert.throws(()=>bound(Object.freeze({})),/STANDING_TRANSACTION_INVALID/);
    assert.equal((await f.read()).standingDelegationBudget,undefined);
  }finally{await f.close();}
});

leaseTest('selected task original SHA and ID cannot be substituted',async()=>{
  const f=await fixture();try{
    let t,b;
    await f.store.execute('github-publisher',async({transaction})=>{
      t=transaction;b=bound(t);return task();
    },{async verifyTask(){return {baseSha:base};}},async()=>{
      const lease=inspectStandingTransaction(t);
      for(const override of [{taskId:'forged'},{taskSha:'a'.repeat(40)}]){
        const got=await b.reserve({envelope:envelope(),effect:effect('bad',lease,'github-read',override)});
        assert.equal(got.reason,'BUDGET_SELECTED_TASK_MISMATCH');
      }
      return {status:'WAITING'};
    });
    assert.equal((await f.read()).standingDelegationBudget,undefined);
  }finally{await f.close();}
});

leaseTest('writes are refused in preflight and postflight even with valid catalog task',async()=>{
  const f=await fixture();try{
    let t,b;const reasons=[];
    await f.store.execute('github-publisher',async({transaction})=>{
      t=transaction;b=bound(t);return task();
    },{async verifyTask(){
      const lease=inspectStandingTransaction(t);
      reasons.push((await b.reserve({envelope:envelope(),
        effect:effect('bad-write',lease,'create-tree')})).reason);
      return {baseSha:base};
    }},async()=>({status:'WAITING'}));
    assert.deepEqual(reasons,['BUDGET_LEASE_INACTIVE','BUDGET_LEASE_INACTIVE']);
    assert.equal((await f.read()).standingDelegationBudget,undefined);
  }finally{await f.close();}
});

leaseTest('closed transaction token cannot be reused after successful completion',async()=>{
  const f=await fixture();try {
    let t,b;
    await f.store.execute('github-publisher',async({transaction})=>{
      t=transaction;b=bound(t);return null;
    },{async verifyTask(){throw Error('unexpected');}},async()=>{throw Error('unexpected');});
    const got=await b.reserve({envelope:envelope(),
      effect:effect('late',{transactionId:'unused',taskId:null,taskSha:null})});
    assert.equal(got.reason,'BUDGET_LEASE_INACTIVE');
  }finally{await f.close();}
});

leaseTest('concurrent admission reservations share the real fsync journal cap',async()=>{
  const f=await fixture();try{
    const result=await f.store.execute('github-publisher',async({transaction})=>{
      const b=bound(transaction),lease=inspectStandingTransaction(transaction);
      const e=envelope({maxOperations:1,maxRequests:1,maxWrites:1});
      const outcomes=await Promise.all(['r1','r2','r3'].map(id=>b.reserve({
        envelope:e,effect:effect(id,lease)})));
      assert.equal(outcomes.filter(x=>x.status==='RESERVED').length,1);
      assert.equal(outcomes.filter(x=>x.reason==='BUDGET_EXHAUSTED').length,2);
      return null;
    },{async verifyTask(){throw Error('unexpected');}},async()=>{throw Error('unexpected');});
    assert.equal(result.mode,'WAITING');
    assert.equal((await f.read()).standingDelegationBudget.envelopes['b'.repeat(64)].claims.length,1);
  }finally{await f.close();}
});

leaseTest('second STARTED job denies claim even when current job matches selected task',async()=>{
  const f=await fixture();try{
    let t,b,ledger;
    await f.store.execute('github-publisher',async(ctx)=>{
      ({transaction:t,ledger}=ctx);b=bound(t);return task();
    },{async verifyTask(){return {baseSha:base};}},async()=>{
      const lease=inspectStandingTransaction(t);ledger.jobs.rogue={
        mode:'STARTED',kind:'github-publisher',sha:base,pr:null};
      const got=await b.reserve({envelope:envelope(),effect:effect('blocked',lease)});
      assert.equal(got.reason,'BUDGET_LEASE_INACTIVE');
      delete ledger.jobs.rogue;
      return {status:'WAITING'};
    });
    assert.equal((await f.read()).standingDelegationBudget,undefined);
  }finally{await f.close();}
});
