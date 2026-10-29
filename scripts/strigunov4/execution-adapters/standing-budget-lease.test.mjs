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
import {createGitHubReader} from './github-readonly.mjs';

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


// A compiled GraphQL POST is a READ only with the actual github-readonly
// WeakSet-branded descriptor; the fake host hook always denies remote dispatch.
async function reserveOfflineCompiledRead(transaction,budget,id) {
  const lease=inspectStandingTransaction(transaction);
  let reserved;
  const reader=createGitHubReader({token:'offline-test-only',requestAdmission:async descriptor=>{
    reserved=await budget.reserve({envelope:envelope(),
      effect:{...effect(id,lease),kind:'github-compiled-read',
        method:descriptor.method,route:descriptor.route,
        payloadSha256:descriptor.payloadSha256,requestSha256:descriptor.requestSha256},
      compiledReadDescriptor:descriptor});
    return false; // Not an authorization: zero network calls.
  }});
  await assert.rejects(reader.threads({...task(),pr:1}),/HOST_REQUEST_GUARD_DENIED/);
  assert.equal(reserved?.status,'RESERVED');
  assert.equal(reserved.authorized,false);
  return reserved;
}

leaseTest('genuine private GraphQL reads are metered in admission, preflight and postflight, with zero writes or provider calls',async()=>{
  const f=await fixture();try{
    let transaction,budget;
    const claims=[];
    let verifies=0;
    const outcome=await f.store.execute('github-publisher',async context=>{
      transaction=context.transaction;budget=bound(transaction);
      claims.push(await reserveOfflineCompiledRead(transaction,budget,'gql-admission'));
      return task();
    },{async verifyTask(){
      verifies++;
      claims.push(await reserveOfflineCompiledRead(transaction,budget,'gql-verify-'+verifies));
      return {baseSha:base};
    }},async()=>({status:'WAITING'}));
    assert.equal(outcome.mode,'WAITING');
    assert.equal(verifies,2);
    assert.equal(claims.length,3);
    const saved=(await f.read()).standingDelegationBudget.envelopes['b'.repeat(64)];
    assert.equal(saved.requests,3);assert.equal(saved.operations,3);
    assert.equal(saved.writes,0);
    assert.deepEqual(saved.claims.map(x=>x.kind),
      ['github-compiled-read','github-compiled-read','github-compiled-read']);
  }finally{await f.close();}
});

leaseTest('caller-fabricated frozen GraphQL descriptor never counts as signed read',async()=>{
  const f=await fixture();try{
    await f.store.execute('github-publisher',async({transaction})=>{
      const budget=bound(transaction),lease=inspectStandingTransaction(transaction);
      const payloadSha256=h('query{maliciousMutation}'),method='POST',route='graphql';
      const requestSha256=h(JSON.stringify({method,route,payloadSha256}));
      const fake=Object.freeze({method,route,payloadSha256,requestSha256,
        signal:new AbortController().signal});
      const got=await budget.reserve({envelope:envelope(),
        effect:{...effect('forged-gql',lease),kind:'github-compiled-read',
          method,route,payloadSha256,requestSha256},
        compiledReadDescriptor:fake});
      assert.equal(got.reason,'BUDGET_COMPILED_READ_PROVENANCE');
      return null;
    },{async verifyTask(){throw Error('unexpected');}},async()=>{throw Error('unexpected');});
    assert.equal((await f.read()).standingDelegationBudget,undefined);
  }finally{await f.close();}
});

leaseTest('signature expiry after durable fsync denies success but preserves the spent claim',async()=>{
  const f=await fixture();try{
    let ticks=0;
    await f.store.execute('github-publisher',async({transaction})=>{
      const budget=createLeaseBoundStandingBudget({transaction,pinnedBaseSha:base,
        clock:()=>++ticks<=2?at:at+100001});
      const lease=inspectStandingTransaction(transaction);
      const signed=envelope();
      const pending=budget.reserve({envelope:signed,effect:effect('expiring-get',lease)});
      signed.maxOperations=0; // Caller mutation cannot change captured signed scope.
      const got=await pending;
      assert.equal(got.reason,'BUDGET_ENVELOPE_EXPIRED_AFTER_RESERVATION');
      assert.equal(got.authorized,false);
      return null;
    },{async verifyTask(){throw Error('unexpected');}},async()=>{throw Error('unexpected');});
    const saved=(await f.read()).standingDelegationBudget.envelopes['b'.repeat(64)];
    assert.equal(saved.claims.length,1);
    assert.equal(saved.requests,1);
    assert.equal(saved.scope.maxOperations,5);
  }finally{await f.close();}
});

leaseTest('a post-fsync clock rollback poisons the lease for later operations even if the clock recovers',async()=>{
  const f=await fixture();try{
    let ticks=0,first,second;
    const outcome=await f.store.execute('github-publisher',async({transaction})=>{
      const b=createLeaseBoundStandingBudget({transaction,pinnedBaseSha:base,
        clock:()=>++ticks===3?at-100:at});
      const lease=inspectStandingTransaction(transaction);
      first=await b.reserve({envelope:envelope(),effect:effect('anomaly-first',lease)});
      second=await b.reserve({envelope:envelope(),effect:effect('anomaly-second',lease)});
      return null;
    },{async verifyTask(){throw Error('unexpected');}},async()=>{throw Error('unexpected');});
    assert.equal(outcome.mode,'WAITING');
    assert.equal(first.reason,'BUDGET_CLOCK_AFTER_RESERVATION');
    assert.equal(second.reason,'BUDGET_UNCERTAIN_TRANSACTION');
    assert.equal(second.authorized,false);
    assert.equal((await f.read()).standingDelegationBudget.envelopes['b'.repeat(64)].claims.length,1);
  }finally{await f.close();}
});

leaseTest('post-fsync signed expiry cannot switch to a fresh envelope in the same uncertain transaction',async()=>{
  const f=await fixture();try{
    let ticks=0,first,second;
    await f.store.execute('github-publisher',async({transaction})=>{
      const budget=createLeaseBoundStandingBudget({transaction,pinnedBaseSha:base,
        clock:()=>++ticks<=2?at:at+100001});
      const lease=inspectStandingTransaction(transaction);
      first=await budget.reserve({envelope:envelope(),
        effect:effect('expired-first',lease)});
      const nextDigest='f'.repeat(64);
      second=await budget.reserve({
        envelope:envelope({envelopeDigest:nextDigest,expiresAt:at+500000}),
        effect:effect('fresh-after-expiry',lease,'github-read',{envelopeDigest:nextDigest})});
      return null;
    },{async verifyTask(){throw Error('unexpected');}},async()=>{throw Error('unexpected');});
    assert.equal(first.reason,'BUDGET_ENVELOPE_EXPIRED_AFTER_RESERVATION');
    assert.equal(second.reason,'BUDGET_UNCERTAIN_TRANSACTION');
    const budget=(await f.read()).standingDelegationBudget;
    assert.deepEqual(Object.keys(budget.envelopes),['b'.repeat(64)]);
    assert.equal(budget.envelopes['b'.repeat(64)].claims.length,1);
  }finally{await f.close();}
});

leaseTest('post-fsync clock rollback denies but keeps its durable spent claim',async()=>{
  const f=await fixture();try{
    let ticks=0, observed;
    const outcome=await f.store.execute('github-publisher',async({transaction})=>{
      const budget=createLeaseBoundStandingBudget({transaction,pinnedBaseSha:base,
        clock:()=>++ticks<=2?at:at-100});
      const lease=inspectStandingTransaction(transaction);
      observed=await budget.reserve({envelope:envelope(),
        effect:effect('clock-rollback-read',lease)});
      return null;
    },{async verifyTask(){throw Error('unexpected');}},async()=>{throw Error('unexpected');});
    assert.equal(outcome.mode,'WAITING');
    assert.equal(observed?.reason,'BUDGET_CLOCK_AFTER_RESERVATION');
    assert.equal(observed.authorized,false);
    const saved=(await f.read()).standingDelegationBudget.envelopes['b'.repeat(64)];
    assert.equal(saved.claims.length,1);
    assert.equal(saved.requests,1);
  }finally{await f.close();}
});

leaseTest('concurrent queued admission reserves cannot outlive a poisoned post-fsync lease', async () => {
  const f = await fixture();
  try {
    let first, second, ticks = 0;
    const outcome = await f.store.execute('github-publisher', async ({transaction}) => {
      const b = createLeaseBoundStandingBudget({
        transaction, pinnedBaseSha:base,
        clock:() => ++ticks <= 2 ? at : at + 100001,
      });
      const lease = inspectStandingTransaction(transaction);
      const freshDigest = 'f'.repeat(64);
      [first, second] = await Promise.all([
        b.reserve({envelope:envelope(),effect:effect('queued-expiring',lease)}),
        b.reserve({
          envelope:envelope({envelopeDigest:freshDigest,expiresAt:at+500000}),
          effect:effect('queued-after-poison',lease,'github-read',{envelopeDigest:freshDigest}),
        }),
      ]);
      return null;
    }, {async verifyTask(){throw Error('unexpected');}},
       async () => {throw Error('unexpected');});
    assert.equal(outcome.mode,'WAITING');
    assert.equal(first.reason,'BUDGET_ENVELOPE_EXPIRED_AFTER_RESERVATION');
    assert.equal(second.reason,'BUDGET_UNCERTAIN_TRANSACTION');
    assert.equal(second.authorized,false);
    const saved=(await f.read()).standingDelegationBudget;
    assert.deepEqual(Object.keys(saved.envelopes),['b'.repeat(64)]);
    assert.equal(saved.envelopes['b'.repeat(64)].claims.length,1);
  } finally {await f.close();}
});


leaseTest('expiry between post-fsync callback and public lease return spends but denies', async () => {
  const f=await fixture();
  try {
    let ticks=0, got;
    const outcome=await f.store.execute('github-publisher',async ({transaction})=>{
      const budget=createLeaseBoundStandingBudget({transaction,pinnedBaseSha:base,
        clock:()=>++ticks<=3?at:at+100001});
      const lease=inspectStandingTransaction(transaction);
      got=await budget.reserve({envelope:envelope(),effect:effect('last-moment-expiry',lease)});
      assert.equal(got.reason,'BUDGET_ENVELOPE_EXPIRED_AFTER_RESERVATION');
      assert.equal(got.authorized,false);
      return null;
    },{async verifyTask(){throw Error('unexpected');}},
       async()=>{throw Error('unexpected');});
    assert.equal(outcome.mode,'WAITING');
    const saved=(await f.read()).standingDelegationBudget.envelopes['b'.repeat(64)];
    assert.equal(saved.requests,1);
    assert.equal(saved.claims.length,1); // post-fsync uncertainty cannot refund
  } finally {await f.close();}
});

leaseTest('selected task mutation during final post-fsync clock read cannot return RESERVED', async () => {
  const f=await fixture();
  try {
    let transaction, observed, ticks=0;
    const selected=task();
    const outcome=await f.store.execute('github-publisher',async ({transaction:t})=>{
      transaction=t;
      return selected;
    },{async verifyTask(){return {baseSha:base};}},async()=>{
      const lease=inspectStandingTransaction(transaction,{write:true});
      const budget=createLeaseBoundStandingBudget({transaction,pinnedBaseSha:base,
        clock:()=>{if(++ticks===3)selected.sha='f'.repeat(40);return at;}});
      observed=await budget.reserve({envelope:envelope(),
        effect:effect('postfsync-selected-mutation',lease,'create-tree')});
      // Real state.execute rejects the mutated source task, even when
      // the id/SHA captured in the effect were originally correct.
      assert.equal(observed.reason,'BUDGET_LEASE_EXPIRED_AFTER_RESERVATION');
      assert.equal(observed.authorized,false);
      selected.sha=base; // test fixture restoration, no state or journal reset
      return {status:'WAITING'};
    });
    assert.equal(outcome.mode,'WAITING');
    const saved=(await f.read()).standingDelegationBudget.envelopes['b'.repeat(64)];
    assert.equal(saved.requests,1);
    assert.equal(saved.writes,1);
    assert.equal(saved.claims.length,1);
  } finally {await f.close();}
});
