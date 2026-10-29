import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createStandingPublisherBudget} from './standing-budget.mjs';

const at = 1793260000000;
const hex64 = 'b'.repeat(64), hex40 = 'c'.repeat(40);
const env = (override={}) => ({schema:'asi.release-envelope.proposal.v1',repo:'ASI-integration/asi-landing',
  environment:'beget-staging',target:'pqukibofpo',action:'source',envelopeDigest:hex64,
  securityDigest:'d'.repeat(64),policyDigest:'e'.repeat(64),
  notBefore:at-1000,expiresAt:at+100000,maxOperations:3,maxRequests:3,maxWrites:2,paidApiUsd:0,...override});
const effect = (id,kind='github-read',override={}) => ({effectId:id,taskId:'source-task',
  headSha:hex40,kind,envelopeDigest:hex64,repo:'ASI-integration/asi-landing',
  environment:'beget-staging',target:'pqukibofpo',action:'source',...override});
async function fixture(){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'asi-p0-budget-'));
  const file=n=>path.join(root,n);
  const ledger={schemaVersion:'asi.execution-adapters.v1',mode:'FAILED_LOCKED',
    reason:'IN_FLIGHT_OR_CRASHED',jobs:{}};
  await fs.mkdir(file('execution.lock'));
  await fs.writeFile(file('autopilot-ledger.json'),JSON.stringify(ledger));
  const store={file};
  return {root,ledger,store,budget:createStandingPublisherBudget({store,ledger,clock:()=>at}),
    read:async()=>JSON.parse(await fs.readFile(file('autopilot-ledger.json'),'utf8')),
    close:async()=>fs.rm(root,{recursive:true,force:true})};
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
    const reopened=createStandingPublisherBudget({store:f.store,ledger,clock:()=>at});
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
    assert.equal((await f.budget.reserve({envelope:env(),effect:effect('a')})).reason,'BUDGET_NOT_IN_ACTIVE_TRANSACTION');
    f.ledger.reason='IN_FLIGHT_OR_CRASHED';
    await fs.rmdir(f.store.file('execution.lock'));
    assert.equal((await f.budget.reserve({envelope:env(),effect:effect('a')})).reason,'BUDGET_LOCK_ABSENT');
  }finally{await f.close()}
});

test('clock regression rejects the next claim without restoring budget',async()=>{
  const f=await fixture();try{
    await f.budget.reserve({envelope:env(),effect:effect('a')});
    const ledger=await f.read();
    const reopened=createStandingPublisherBudget({store:f.store,ledger,clock:()=>at-1});
    assert.equal((await reopened.reserve({envelope:env(),effect:effect('b')})).reason,'BUDGET_CLOCK_REGRESSION');
  }finally{await f.close()}
});

test('tampered persisted claim counts throw and preserve state',async()=>{
  const f=await fixture();try{
    await f.budget.reserve({envelope:env(),effect:effect('a')});
    const ledger=await f.read();ledger.standingDelegationBudget.envelopes[hex64].writes=1;
    const reopened=createStandingPublisherBudget({store:f.store,ledger,clock:()=>at});
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
