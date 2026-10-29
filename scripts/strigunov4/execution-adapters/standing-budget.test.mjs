import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createStandingPublisherBudget} from './standing-budget.mjs';
import * as githubReadonly from './github-readonly.mjs';
const {createGitHubReader,isCompiledGitHubRead}=githubReadonly;
// The protected main baseline does not yet expose the private compiled-query brand.
// GraphQL regression is therefore gated on the exact #552 source overlay.
const compiledTest=typeof isCompiledGitHubRead==='function'?test:test.skip;

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
    assert.throws(()=>createStandingPublisherBudget({store:f.store,ledger:f.ledger,clock:()=>at}),
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
    const budget=createStandingPublisherBudget({store:f.store,ledger,
      clock:()=>++ticks===1?at:at+100000});
    assert.equal((await budget.reserve({envelope:env(),effect:effect('late')})).reason,
      'BUDGET_ENVELOPE_SCOPE');
    assert.equal((await f.read()).standingDelegationBudget,undefined);
  }finally{await f.close()}
});

test('malformed unrelated signed-envelope budget history fails closed',async()=>{
  const f=await fixture();try{
    await f.budget.reserve({envelope:env(),effect:effect('original','create-tree')});
    const ledger=await f.read();ledger.standingDelegationBudget.envelopes[hex64].writes=500;
    const reopened=createStandingPublisherBudget({store:f.store,ledger,clock:()=>at});
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
      'BUDGET_EFFECT_SCOPE');
    assert.equal((await f.read()).standingDelegationBudget,undefined);
  }finally{await f.close()}
});

test('reopened corrupted historical wire fingerprint poisons subsequent claims',async()=>{
  const f=await fixture();try{
    assert.equal((await f.budget.reserve({envelope:env(),effect:effect('write','create-tree')})).status,'RESERVED');
    const state=await f.read();
    state.standingDelegationBudget.envelopes[hex64].claims[0].requestSha256='0'.repeat(64);
    const reopened=createStandingPublisherBudget({store:f.store,ledger:state,clock:()=>at});
    await assert.rejects(reopened.reserve({envelope:env(),effect:effect('later')}),
      /BUDGET_LEDGER_INVALID/);
    assert.equal((await f.read()).standingDelegationBudget.envelopes[hex64].claims.length,1);
  }finally{await f.close()}
});


// GraphQL POST has read-only budget semantics solely for the compiled,
 // privately branded GitHub thread query. No test sends a network request.
async function compiledGraphqlDescriptor() {
  let captured;
  const reader=createGitHubReader({token:'isolated-fixture-token',
    beforeRequest:async d=>{captured=d;return false;}});
  await assert.rejects(reader.threads({pr:42,sha:hex40}),/HOST_REQUEST_GUARD_DENIED/);
  assert.equal(isCompiledGitHubRead(captured),true);
  return captured;
}
function graphqlEffect(id,descriptor,patch={}) {
  return effect(id,'github-read',{kind:'github-compiled-read',
    method:descriptor.method,route:descriptor.route,
    payloadSha256:descriptor.payloadSha256,requestSha256:descriptor.requestSha256,...patch});
}
compiledTest('actual privately compiled GraphQL POST spends a request but never a write',async()=>{
  const f=await fixture();try{
    const d=await compiledGraphqlDescriptor();
    const got=await f.budget.reserve({envelope:env(),effect:graphqlEffect('graphql-one',d),
      compiledReadDescriptor:d});
    assert.equal(got.status,'RESERVED');
    const saved=(await f.read()).standingDelegationBudget.envelopes[hex64];
    assert.equal(saved.operations,1);assert.equal(saved.requests,1);assert.equal(saved.writes,0);
    assert.equal(saved.claims[0].kind,'github-compiled-read');
    assert.equal(saved.claims[0].method,'POST');assert.equal(saved.claims[0].route,'graphql');
  }finally{await f.close();}
});
compiledTest('copied or fabricated compiled GraphQL descriptor cannot consume read allowance',async()=>{
  const f=await fixture();try{
    const d=await compiledGraphqlDescriptor();
    for(const forged of [Object.freeze({...d}),Object.freeze({...d,compiledRead:true}),null]){
      const got=await f.budget.reserve({envelope:env(),effect:graphqlEffect('forged',d),
        compiledReadDescriptor:forged});
      assert.equal(got.reason,'BUDGET_COMPILED_READ_PROVENANCE');
    }
    assert.equal((await f.read()).standingDelegationBudget,undefined);
  }finally{await f.close();}
});
compiledTest('compiled provenance is bound to the exact POST payload and route',async()=>{
  const f=await fixture();try{
    const d=await compiledGraphqlDescriptor();
    for(const patch of [{payloadSha256:'0'.repeat(64)},{route:'git/trees'},
      {requestSha256:'f'.repeat(64)},{method:'GET'}]){
      const got=await f.budget.reserve({envelope:env(),effect:graphqlEffect('wrong',d,patch),
        compiledReadDescriptor:d});
      assert.equal(got.reason,'BUDGET_COMPILED_READ_PROVENANCE');
    }
    assert.equal((await f.read()).standingDelegationBudget,undefined);
  }finally{await f.close();}
});
compiledTest('unbranded GraphQL POST never obtains GET or write quota classification',async()=>{
  const f=await fixture();try{
    const d=await compiledGraphqlDescriptor();
    const asGet=graphqlEffect('bad-get',d,{kind:'github-read'});
    const asWrite=graphqlEffect('bad-write',d,{kind:'create-tree'});
    assert.equal((await f.budget.reserve({envelope:env(),effect:asGet})).reason,'BUDGET_EFFECT_SCOPE');
    assert.equal((await f.budget.reserve({envelope:env(),effect:asWrite})).reason,'BUDGET_EFFECT_SCOPE');
    assert.equal((await f.read()).standingDelegationBudget,undefined);
  }finally{await f.close();}
});
compiledTest('reopened GraphQL read history remains sound and repeatable under a different envelope',async()=>{
  const f=await fixture();try{
    const d=await compiledGraphqlDescriptor();
    assert.equal((await f.budget.reserve({envelope:env(),effect:graphqlEffect('graphql-a',d),
      compiledReadDescriptor:d})).status,'RESERVED');
    const reopened=createStandingPublisherBudget({store:f.store,ledger:await f.read(),clock:()=>at});
    const nextDigest='f'.repeat(64);
    assert.equal((await reopened.reserve({envelope:env({envelopeDigest:nextDigest}),
      effect:graphqlEffect('graphql-b',d,{envelopeDigest:nextDigest}),
      compiledReadDescriptor:d})).status,'RESERVED');
    const entries=(await f.read()).standingDelegationBudget.envelopes;
    assert.equal(entries[hex64].writes,0);assert.equal(entries[nextDigest].writes,0);
  }finally{await f.close();}
});