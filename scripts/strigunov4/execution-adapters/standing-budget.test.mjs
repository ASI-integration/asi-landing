import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createStandingPublisherBudget} from './standing-budget.mjs';
import {initializeState} from './state.mjs';

const at = 1793260000000;
const hex64 = 'b'.repeat(64), hex40 = 'c'.repeat(40);
const env = (override={}) => ({schema:'asi.release-envelope.proposal.v1',repo:'ASI-integration/asi-landing',
  environment:'beget-staging',target:'pqukibofpo',action:'source',envelopeDigest:hex64,
  securityDigest:'d'.repeat(64),policyDigest:'e'.repeat(64),
  notBefore:at-1000,expiresAt:at+100000,maxOperations:3,maxRequests:3,maxWrites:2,paidApiUsd:0,...override});
const hash = value => createHash('sha256').update(value).digest('hex');
const writeRoutes = {'create-tree':'git/trees','create-commit':'git/commits',
  'create-branch':'git/refs','create-draft-pr':'pulls'};
const effect = (id,kind='github-read',override={}) => {
  const method = kind==='github-read'?'GET':'POST';
  const route = kind==='github-read'?'branches/main':writeRoutes[kind]||'git/trees';
  const payloadSha256 = hash(method==='GET'?'':JSON.stringify({id}));
  const requestSha256 = hash(JSON.stringify({method,route,payloadSha256}));
  return {effectId:id,taskId:'source-task',taskSha:hex40,headSha:hex40,kind,method,
    route,payloadSha256,requestSha256,envelopeDigest:hex64,repo:'ASI-integration/asi-landing',
    environment:'beget-staging',target:'pqukibofpo',action:'source',...override};
};
async function fixture(clock=()=>at){
  // Native state.execute owns the durable lock and mints the opaque transaction.
  // Reopening below starts a NEW genuine native transaction, never a mock token.
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'asi-p0-budget-'));
  const store=await initializeState(root);
  const task={id:'source-task',sha:hex40,repo:'ASI-integration/asi-landing',
    branch:'asi/source-test',pr:null,stage:'S4-G2'};
  let running,unblock;
  async function enter(activeClock,override) {
    let readyResolve,ledger;
    const ready=new Promise(resolve=>{readyResolve=resolve});
    const hold=new Promise(resolve=>{unblock=resolve});
    running=store.execute('github-publisher',
      async({ledger:current})=>{ledger=current;return task;},
      {async verifyTask(){return {verified:true};}},
      async({transaction})=>{
        // Apply deliberately tampered historical input only AFTER state.execute
        // has durably armed and persisted the authentic STARTED job.
        if(override){
          if(Object.hasOwn(override,'standingDelegationBudget'))
            ledger.standingDelegationBudget=structuredClone(override.standingDelegationBudget);
          else delete ledger.standingDelegationBudget;
        }
        const budget=createStandingPublisherBudget({store,ledger,transaction,clock:activeClock});
        readyResolve({budget,ledger,transaction});
        await hold;
        return {status:'WAITING'};
      });
    return await Promise.race([ready,running.then(()=>{throw Error('NATIVE_FIXTURE_CLOSED_EARLY')})]);
  }
  async function leave(){unblock();await running;}
  const active=await enter(clock);
  const f={root,store,ledger:active.ledger,budget:active.budget,transaction:active.transaction,
    read:async()=>JSON.parse(await fs.readFile(store.file('autopilot-ledger.json'),'utf8')),
    async reopenBudget(snapshot,nextClock=clock){
      await leave();
      const renewed=await enter(nextClock,snapshot);
      f.ledger=renewed.ledger;f.budget=renewed.budget;f.transaction=renewed.transaction;
      return renewed.budget;
    },
    close:async()=>{try{await leave()}finally{await fs.rm(root,{recursive:true,force:true})}}};
  return f;
}

test('two distinct source HEADs consume one signed-envelope budget, without reissue',async()=>{
  const f=await fixture();try{
    const a=await f.budget.reserve({envelope:env(),effect:effect('a','create-tree')});
    const b=await f.budget.reserve({envelope:env(),effect:effect('b','create-branch',{headSha:'a'.repeat(40)})});
    assert.deepEqual([a.status,b.status],['RESERVED','RESERVED']);
    assert.equal((await f.read()).standingDelegationBudget.envelopes[hex64].writes,2);
    assert.equal((await f.budget.reserve({envelope:env(),effect:effect('c','create-commit')})).reason,'BUDGET_EXHAUSTED');
  }finally{await f.close()}
});

test('concurrent requests to same locked state cannot over-issue',async()=>{
  const f=await fixture();try{
    const e=env({maxOperations:1,maxRequests:1,maxWrites:1});
    const results=await Promise.all(['a','b','c'].map(id=>f.budget.reserve({envelope:e,effect:effect(id,'create-tree')})));
    assert.equal(results.filter(x=>x.status==='RESERVED').length,1);
    assert.equal(results.filter(x=>x.reason==='BUDGET_EXHAUSTED').length,2);
    assert.equal((await f.read()).standingDelegationBudget.envelopes[hex64].claims.length,1);
  }finally{await f.close()}
});

test('restart cannot replay a reserved write, even when previous outcome is unknown',async()=>{
  const f=await fixture();try{
    assert.equal((await f.budget.reserve({envelope:env(),effect:effect('mutate','create-draft-pr')})).status,'RESERVED');
    const ledger=await f.read();
    const reopened=await f.reopenBudget(ledger,()=>at);
    assert.equal((await reopened.reserve({envelope:env(),effect:effect('mutate','create-draft-pr')})).reason,'BUDGET_REPLAY_OR_UNKNOWN');
    assert.equal((await f.read()).standingDelegationBudget.envelopes[hex64].claims.length,1);
  }finally{await f.close()}
});

test('expired and paid-API permit fail closed before reservation',async()=>{
  const f=await fixture();try{
    assert.equal((await f.budget.reserve({envelope:env({expiresAt:at}),effect:effect('x')})).reason,'BUDGET_ENVELOPE_SCOPE');
    assert.equal((await f.budget.reserve({envelope:env({paidApiUsd:1}),effect:effect('x')})).reason,'BUDGET_ENVELOPE_SCOPE');
    assert.equal((await f.read()).standingDelegationBudget,undefined);
  }finally{await f.close()}
});

test('mismatched scope, target, task SHA and unsupported operation denied',async()=>{
  const f=await fixture();try{
    for(const x of [effect('x','merge-main'),effect('x','github-read',{target:'elsewhere'}),
      effect('x','github-read',{headSha:'wrong'}),effect('x','github-read',{envelopeDigest:'f'.repeat(64)})])
      assert.equal((await f.budget.reserve({envelope:env(),effect:x})).reason,'BUDGET_EFFECT_SCOPE');
    assert.equal((await f.read()).standingDelegationBudget,undefined);
  }finally{await f.close()}
});

test('changing limits for same signed digest cannot reset consumed budget',async()=>{
  const f=await fixture();try{
    assert.equal((await f.budget.reserve({envelope:env(),effect:effect('a')})).status,'RESERVED');
    await assert.rejects(f.budget.reserve({envelope:env({maxOperations:9,maxRequests:9}),effect:effect('b')}),/BUDGET_LEDGER_INVALID/);
    assert.equal((await f.read()).standingDelegationBudget.envelopes[hex64].claims.length,1);
  }finally{await f.close()}
});

test('FAILED_LOCKED unknown state or absent execution lock cannot be reopened',async()=>{
  const f=await fixture();try{
    f.ledger.reason='UNHANDLED_OR_UNKNOWN_RESULT';
    assert.equal((await f.budget.reserve({envelope:env(),effect:effect('a')})).reason,'BUDGET_NATIVE_LEASE_MISMATCH');
    f.ledger.reason='IN_FLIGHT_OR_CRASHED';
    await fs.rmdir(f.store.file('execution.lock'));
    assert.equal((await f.budget.reserve({envelope:env(),effect:effect('a')})).reason,'BUDGET_NATIVE_LEASE_MISMATCH');
  }finally{await f.close()}
});

test('clock regression rejects the next claim without restoring budget',async()=>{
  const f=await fixture();try{
    await f.budget.reserve({envelope:env(),effect:effect('a')});
    const ledger=await f.read();
    const reopened=await f.reopenBudget(ledger,()=>at-1);
    assert.equal((await reopened.reserve({envelope:env(),effect:effect('b')})).reason,'BUDGET_CLOCK_REGRESSION');
  }finally{await f.close()}
});

test('tampered persisted claim counts throw and preserve state',async()=>{
  const f=await fixture();try{
    await f.budget.reserve({envelope:env(),effect:effect('a')});
    const ledger=await f.read();ledger.standingDelegationBudget.envelopes[hex64].writes=1;
    const reopened=await f.reopenBudget(ledger,()=>at);
    await assert.rejects(reopened.reserve({envelope:env(),effect:effect('b')}),/BUDGET_LEDGER_INVALID/);
    assert.equal((await f.read()).standingDelegationBudget.envelopes[hex64].writes,0);
  }finally{await f.close()}
});

test('durability failure never returns RESERVED or permits effects',async()=>{
  const f=await fixture();try{
    await fs.unlink(f.store.file('autopilot-ledger.json'));
    await fs.mkdir(f.store.file('autopilot-ledger.json'));
    await assert.rejects(f.budget.reserve({envelope:env(),effect:effect('a','create-branch')}));
    assert.equal(f.ledger.standingDelegationBudget,undefined);
    await fs.rmdir(f.store.file('autopilot-ledger.json'));
    await fs.writeFile(f.store.file('autopilot-ledger.json'),JSON.stringify(f.ledger));
    assert.equal((await f.budget.reserve({envelope:env(),effect:effect('b','create-branch')})).reason,'BUDGET_UNCERTAIN_STORAGE');
  }finally{await f.close()}
});

test('a forged same-digest scope poisons the transaction',async()=>{
  const f=await fixture();try{
    assert.equal((await f.budget.reserve({envelope:env(),effect:effect('a')})).status,'RESERVED');
    await assert.rejects(f.budget.reserve({envelope:env({policyDigest:'f'.repeat(64)}),effect:effect('b')}),/BUDGET_LEDGER_INVALID/);
    assert.equal((await f.budget.reserve({envelope:env({envelopeDigest:'f'.repeat(64)}),
      effect:effect('c','github-read',{envelopeDigest:'f'.repeat(64)})})).reason,'BUDGET_UNCERTAIN_STORAGE');
    assert.equal(Object.keys((await f.read()).standingDelegationBudget.envelopes).length,1);
  }finally{await f.close()}
});
  
test('two independent signed envelopes each carry their own bounded count',async()=>{
  const f=await fixture();try{
    assert.equal((await f.budget.reserve({envelope:env(),effect:effect('a')})).status,'RESERVED');
    assert.equal((await f.budget.reserve({envelope:env({envelopeDigest:'f'.repeat(64)}),
      effect:effect('c','github-read',{envelopeDigest:'f'.repeat(64)})})).status,'RESERVED');
    assert.equal(Object.keys((await f.read()).standingDelegationBudget.envelopes).length,2);
  }finally{await f.close()}
});

test('caller mutation after reserve invocation cannot change queued scope or effect',async()=>{
  const f=await fixture();try{
    const e=env(),x=effect('original','create-branch');
    const pending=f.budget.reserve({envelope:e,effect:x});
    e.maxRequests=0;e.maxWrites=0;e.envelopeDigest='f'.repeat(64);
    x.effectId='changed';x.kind='merge-main';x.headSha='wrong';
    x.taskSha='wrong';x.requestSha256='0'.repeat(64);
    const result=await pending;
    assert.equal(result.status,'RESERVED');assert.equal(result.effectId,'original');
    const record=(await f.read()).standingDelegationBudget.envelopes[hex64];
    assert.equal(record.scope.maxRequests,3);assert.equal(record.claims[0].headSha,hex40);
  }finally{await f.close()}
});

test('one ledger instance cannot create two independent reservation queues',async()=>{
  const f=await fixture();try{
    assert.throws(()=>createStandingPublisherBudget({store:f.store,ledger:f.ledger,transaction:f.transaction,clock:()=>at}),
      /BUDGET_DUPLICATE_TRANSACTION_INSTANCE/);
    assert.equal((await f.budget.reserve({envelope:env(),effect:effect('after')})).status,'RESERVED');
  }finally{await f.close()}
});

test('a second envelope cannot replay the same effect identifier',async()=>{
  const f=await fixture();try{
    assert.equal((await f.budget.reserve({envelope:env(),effect:effect('shared','create-tree')})).status,'RESERVED');
    const newDigest='f'.repeat(64);
    const result=await f.budget.reserve({envelope:env({envelopeDigest:newDigest}),
      effect:effect('shared','create-tree',{envelopeDigest:newDigest})});
    assert.equal(result.reason,'BUDGET_REPLAY_OR_UNKNOWN');
    assert.equal(Object.keys((await f.read()).standingDelegationBudget.envelopes).length,1);
  }finally{await f.close()}
});

test('expiry between queued acceptance and lock read denies without claims',async()=>{
  const f=await fixture();try{
    const ledger=await f.read();let ticks=0;
    const budget=await f.reopenBudget(ledger,()=>++ticks===1?at:at+100000);
    assert.equal((await budget.reserve({envelope:env(),effect:effect('late')})).reason,
      'BUDGET_ENVELOPE_SCOPE');
    assert.equal((await f.read()).standingDelegationBudget,undefined);
  }finally{await f.close()}
});

test('malformed unrelated signed-envelope budget history fails closed',async()=>{
  const f=await fixture();try{
    await f.budget.reserve({envelope:env(),effect:effect('original','create-tree')});
    const ledger=await f.read();ledger.standingDelegationBudget.envelopes[hex64].writes=500;
    const reopened=await f.reopenBudget(ledger,()=>at);
    const newDigest='f'.repeat(64);
    await assert.rejects(reopened.reserve({envelope:env({envelopeDigest:newDigest}),
      effect:effect('new','github-read',{envelopeDigest:newDigest})}),/BUDGET_LEDGER_INVALID/);
    assert.equal(Object.keys((await f.read()).standingDelegationBudget.envelopes).length,1);
  }finally{await f.close()}
});

test('accessor-based payload cannot change post-validation scope',async()=>{
  const f=await fixture();try{
    const e=env();Object.defineProperty(e,'maxRequests',{get(){throw Error('bad getter')}});
    assert.equal((await f.budget.reserve({envelope:e,effect:effect('x')})).reason,'BUDGET_INPUT_INVALID');
    assert.equal((await f.read()).standingDelegationBudget,undefined);
  }finally{await f.close()}
});

test('new envelope and different effect ID cannot replay the same POST wire bytes',async()=>{
  const f=await fixture();try{
    const original=effect('wire-old','create-tree');
    assert.equal((await f.budget.reserve({envelope:env(),effect:original})).status,'RESERVED');
    const other='f'.repeat(64);
    const replay=effect('wire-new','create-tree',{envelopeDigest:other,
      payloadSha256:original.payloadSha256,requestSha256:original.requestSha256});
    assert.equal((await f.budget.reserve({envelope:env({envelopeDigest:other}),effect:replay})).reason,
      'BUDGET_REPLAY_OR_UNKNOWN');
    const state=await f.read();
    assert.equal(Object.keys(state.standingDelegationBudget.envelopes).length,1);
  }finally{await f.close()}
});

test('same envelope cannot replay a POST with a fresh operation identifier',async()=>{
  const f=await fixture();try{
    const a=effect('first','create-commit');
    const b=effect('second','create-commit',{payloadSha256:a.payloadSha256,
      requestSha256:a.requestSha256});
    assert.equal((await f.budget.reserve({envelope:env(),effect:a})).status,'RESERVED');
    assert.equal((await f.budget.reserve({envelope:env(),effect:b})).reason,
      'BUDGET_REPLAY_OR_UNKNOWN');
  }finally{await f.close()}
});

test('independent read intents can repeat identical GET bytes but consume two requests',async()=>{
  const f=await fixture();try{
    assert.equal((await f.budget.reserve({envelope:env(),effect:effect('read-a')})).status,'RESERVED');
    assert.equal((await f.budget.reserve({envelope:env(),effect:effect('read-b')})).status,'RESERVED');
    const state=await f.read();
    assert.equal(state.standingDelegationBudget.envelopes[hex64].requests,2);
    assert.equal(state.standingDelegationBudget.envelopes[hex64].writes,0);
  }finally{await f.close()}
});

test('forged method, route, wire digest or original task SHA rejects before persistence',async()=>{
  const f=await fixture();try{
    const cases=[
      effect('bad-method','create-tree',{method:'GET'}),
      effect('bad-route','create-tree',{route:'git/refs'}),
      effect('bad-wire','create-tree',{requestSha256:'0'.repeat(64)}),
      effect('bad-source','create-tree',{taskSha:'bad'}),
      effect('bad-body','github-read',{payloadSha256:'0'.repeat(64)}),
    ];
    for(const e of cases)assert.equal((await f.budget.reserve({envelope:env(),effect:e})).reason,
      e.taskSha!==hex40?'BUDGET_NATIVE_LEASE_MISMATCH':'BUDGET_EFFECT_SCOPE');
    assert.equal((await f.read()).standingDelegationBudget,undefined);
  }finally{await f.close()}
});

test('reopened corrupted historical wire fingerprint poisons subsequent claims',async()=>{
  const f=await fixture();try{
    assert.equal((await f.budget.reserve({envelope:env(),effect:effect('write','create-tree')})).status,'RESERVED');
    const state=await f.read();
    state.standingDelegationBudget.envelopes[hex64].claims[0].requestSha256='0'.repeat(64);
    const reopened=await f.reopenBudget(state,()=>at);
    await assert.rejects(reopened.reserve({envelope:env(),effect:effect('later')}),
      /BUDGET_LEDGER_INVALID/);
    assert.equal((await f.read()).standingDelegationBudget.envelopes[hex64].claims.length,1);
  }finally{await f.close()}
});

test('cross-envelope duplicate historical write or effect ID poisons reopened journal',async()=>{
  // Each corruption scenario starts from a fresh native transaction so that a
  // deliberately injected prior bad fixture cannot pollute the next scenario.
  for(const id of ['first','another-id']){
    const f=await fixture();try{
      const second='f'.repeat(64),third='a'.repeat(64);
      assert.equal((await f.budget.reserve({envelope:env(),effect:effect('first','create-tree')})).status,'RESERVED');
      assert.equal((await f.budget.reserve({envelope:env({envelopeDigest:second}),
        effect:effect('second','github-read',{envelopeDigest:second})})).status,'RESERVED');
      const original=await f.read();
      const corrupted=structuredClone(original);
      const first=corrupted.standingDelegationBudget.envelopes[hex64].claims[0];
      const entry=corrupted.standingDelegationBudget.envelopes[second];
      entry.claims[0]={...first,effectId:id};
      entry.writes=1;
      const reopened=await f.reopenBudget(corrupted,()=>at);
      await assert.rejects(reopened.reserve({envelope:env({envelopeDigest:third}),
        effect:effect('unrelated','github-read',{envelopeDigest:third})}),/BUDGET_LEDGER_INVALID/);
      assert.deepEqual((await f.read()).standingDelegationBudget,original.standingDelegationBudget);
    }finally{await f.close()}
  }
});

test('prior-envelope clock high-water blocks rollback on newly signed digest',async()=>{
  const f=await fixture();try{
    assert.equal((await f.budget.reserve({envelope:env(),effect:effect('first')})).status,'RESERVED');
    const second='f'.repeat(64);
    const reopened=await f.reopenBudget(await f.read(),()=>at-500);
    assert.equal((await reopened.reserve({envelope:env({envelopeDigest:second}),
      effect:effect('second','github-read',{envelopeDigest:second})})).reason,'BUDGET_CLOCK_REGRESSION');
    assert.deepEqual(Object.keys((await f.read()).standingDelegationBudget.envelopes),[hex64]);
  }finally{await f.close()}
});



test('27 sequential 14-day children retain all prior spends under a 365-day term',async()=>{
  const time={value:at},f=await fixture(()=>time.value),day=86400000;
  try{
    const first=at, end=first+365*day;
    for(let i=0;i<27;i++){
      time.value=first+i*14*day;
      const digest=(i+1).toString(16).padStart(64,'0');
      const scope=env({envelopeDigest:digest,notBefore:time.value-1000,
        expiresAt:Math.min(time.value+14*day-1000,end),maxOperations:1,maxRequests:1,maxWrites:1});
      const result=await f.budget.reserve({envelope:scope,
        effect:effect('rotation-'+i,'github-read',{envelopeDigest:digest})});
      assert.equal(result.status,'RESERVED','child '+i);
    }
    const retained=await f.read();
    const history=retained.standingDelegationBudget.envelopes;
    assert.equal(Object.keys(history).length,27);
    assert.equal(Object.values(history).reduce((n,x)=>n+x.claims.length,0),27);
    const reopened=await f.reopenBudget(retained,()=>time.value);
    const last='1b'.padStart(64,'0'),lastScope=history[last].scope;
    assert.equal((await reopened.reserve({envelope:env({...lastScope,envelopeDigest:last}),
      effect:effect('rotation-26','github-read',{envelopeDigest:last})})).reason,
      'BUDGET_REPLAY_OR_UNKNOWN');
    assert.deepEqual((await f.read()).standingDelegationBudget,retained.standingDelegationBudget);
  }finally{await f.close()}
});

test('64 retained child histories deny 65th without truncation or replay reset',async()=>{
  const f=await fixture();
  try{
    for(let i=1;i<=64;i++){
      const digest=i.toString(16).padStart(64,'0');
      assert.equal((await f.budget.reserve({envelope:env({envelopeDigest:digest}),
        effect:effect('history-'+i,'github-read',{envelopeDigest:digest})})).status,
        'RESERVED','history '+i);
    }
    const before=await f.read(),next='41'.padStart(64,'0');
    assert.equal(Object.keys(before.standingDelegationBudget.envelopes).length,64);
    assert.equal((await f.budget.reserve({envelope:env({envelopeDigest:next}),
      effect:effect('history-65','github-read',{envelopeDigest:next})})).reason,
      'BUDGET_HISTORY_FULL');
    assert.deepEqual((await f.read()).standingDelegationBudget,before.standingDelegationBudget);
  }finally{await f.close()}
});

test('global cumulative 256 reservations cannot reset at child renewal',async()=>{
  const f=await fixture();
  try{
    for(let i=1;i<=64;i++){
      const digest=i.toString(16).padStart(64,'0');
      for(let k=1;k<=4;k++){
        const result=await f.budget.reserve({envelope:env({envelopeDigest:digest,
          maxOperations:5,maxRequests:5,maxWrites:1}),
          effect:effect('global-'+i+'-'+k,'github-read',{envelopeDigest:digest})});
        assert.equal(result.status,'RESERVED','claim '+i+':'+k);
      }
    }
    const before=await f.read(),digest='40'.padStart(64,'0');
    const denied=await f.budget.reserve({envelope:env({envelopeDigest:digest,
      maxOperations:5,maxRequests:5,maxWrites:1}),
      effect:effect('global-257','github-read',{envelopeDigest:digest})});
    assert.equal(denied.reason,'BUDGET_GLOBAL_EXHAUSTED');
    assert.deepEqual((await f.read()).standingDelegationBudget,before.standingDelegationBudget);
    const reopened=await f.reopenBudget(await f.read(),()=>at);
    assert.equal((await reopened.reserve({envelope:env({envelopeDigest:digest,
      maxOperations:5,maxRequests:5,maxWrites:1}),
      effect:effect('global-after-restart','github-read',{envelopeDigest:digest})})).reason,
      'BUDGET_GLOBAL_EXHAUSTED');
  }finally{await f.close()}
});

test('365-day parent is never substituted for a signed short-lived execution child',async()=>{
  const f=await fixture();
  try{
    const year=365*86400000;
    const forgedParentAsChild=env({notBefore:at-1000,expiresAt:at-1000+year});
    const denied=await f.budget.reserve({envelope:forgedParentAsChild,effect:effect('year-is-not-child')});
    assert.equal(denied.reason,'BUDGET_ENVELOPE_SCOPE');
    assert.equal((await f.read()).standingDelegationBudget,undefined);
    const short=env({notBefore:at-1000,expiresAt:at-1000+14*86400000});
    assert.equal((await f.budget.reserve({envelope:short,effect:effect('short-child')})).status,'RESERVED');
    assert.equal((await f.read()).standingDelegationBudget.envelopes[hex64].claims.length,1);
  }finally{await f.close()}
});

test('a child rotation cannot recycle a spent digest with expanded validity or counters',async()=>{
  const f=await fixture();try{
    const first='1'.padStart(64,'0');
    assert.equal((await f.budget.reserve({envelope:env({envelopeDigest:first}),
      effect:effect('first-child','create-tree',{envelopeDigest:first})})).status,'RESERVED');
    const spent=await f.read();
    const recycled=env({envelopeDigest:first,expiresAt:at+200000,maxOperations:7,maxRequests:7,maxWrites:3});
    await assert.rejects(f.budget.reserve({envelope:recycled,
      effect:effect('recycled-child','create-tree',{envelopeDigest:first})}),/BUDGET_LEDGER_INVALID/);
    assert.deepEqual((await f.read()).standingDelegationBudget,spent.standingDelegationBudget);
  }finally{await f.close()}
});

test('native reservation refuses explicit undefined or accessor budget root instead of treating it as pristine',async()=>{
  const outcomes=[];
  for(const variant of ['own-undefined','accessor-undefined']){
    const f=await fixture();
    try{
      if(variant==='own-undefined'){
        Object.defineProperty(f.ledger,'standingDelegationBudget',
          {value:undefined,writable:true,enumerable:true,configurable:true});
      }else{
        Object.defineProperty(f.ledger,'standingDelegationBudget',
          {get(){return undefined},enumerable:true,configurable:true});
      }
      try{
        const result=await f.budget.reserve({envelope:env(),effect:effect('root-tampered')});
        outcomes.push(result.status);
      }catch(err){outcomes.push(err.message)}
    }finally{await f.close()}
  }
  assert.deepEqual(outcomes,['BUDGET_LEDGER_INVALID','BUDGET_LEDGER_INVALID']);
});
