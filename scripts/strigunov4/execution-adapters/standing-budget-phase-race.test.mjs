import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {initializeState,inspectStandingTransaction} from './state.mjs';
import {createStandingPublisherBudget} from './standing-budget.mjs';

const h=s=>createHash('sha256').update(s).digest('hex');
const now=1793260000000,taskSha='c'.repeat(40),envelopeDigest='b'.repeat(64);
const base={id:'phase-check',sha:taskSha,repo:'ASI-integration/asi-landing',stage:'S4-G2',pr:null,branch:'phase-check'};
const envelope={schema:'asi.release-envelope.proposal.v1',repo:base.repo,
  environment:'beget-staging',target:'pqukibofpo',action:'source',
  envelopeDigest,securityDigest:'d'.repeat(64),policyDigest:'e'.repeat(64),
  notBefore:now-1000,expiresAt:now+100000,paidApiUsd:0,
  maxOperations:4,maxRequests:4,maxWrites:4};
function write(id) {
  const method='POST',route='git/commits',payloadSha256=h(JSON.stringify({id}));
  return {effectId:id,taskId:base.id,taskSha,headSha:taskSha,kind:'create-commit',
    method,route,payloadSha256,requestSha256:h(JSON.stringify({method,route,payloadSha256})),
    envelopeDigest,repo:base.repo,environment:'beget-staging',target:'pqukibofpo',action:'source'};
}
test('pre-STARTED and postflight writes rejected by the real native lease',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'asi-phase-race-writes-'));
  try {
    const store=await initializeState(root);let budget,verify=0;
    const result=await store.execute('github-publisher',async({ledger,transaction})=>{
      budget=createStandingPublisherBudget({store,ledger,transaction,clock:()=>now});
      return {...base};
    },{async verifyTask(t,{transaction}){
      verify++;
      const phase=inspectStandingTransaction(transaction).phase;
      assert.equal(phase,verify===1?'preflight':'postflight');
      const r=await budget.reserve({envelope,effect:write('blocked-'+phase)});
      assert.equal(r.reason,'BUDGET_NATIVE_LEASE_MISMATCH');
      return {verified:true};
    }},async()=>{
      const r=await budget.reserve({envelope,effect:write('allowed-started')});
      assert.equal(r.status,'RESERVED');
      return {status:'WAITING',reason:'NO_REMOTE_EFFECT'};
    });
    assert.equal(result.mode,'WAITING');
    const saved=JSON.parse(await fs.readFile(store.file('autopilot-ledger.json'),'utf8'));
    const claims=saved.standingDelegationBudget.envelopes[envelopeDigest].claims;
    assert.deepEqual(claims.map(c=>c.effectId),['allowed-started']);
    console.log('NEGATIVE_PHASES:'+JSON.stringify({preflight:'DENIED',postflight:'DENIED',writes:claims.length}));
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('selected task mutation immediately after reservation call denies without spending',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'asi-phase-race-mutated-'));
  try {
    const store=await initializeState(root);let budget,selected;
    const result=await store.execute('github-publisher',async({ledger,transaction})=>{
      budget=createStandingPublisherBudget({store,ledger,transaction,clock:()=>now});
      selected={...base};
      return selected;
    },{async verifyTask(){return {verified:true};}},async()=>{
      const pending=budget.reserve({envelope,effect:write('task-altered')});
      selected.sha='a'.repeat(40);
      const response=await pending;
      selected.sha=taskSha;
      assert.equal(response.reason,'BUDGET_NATIVE_LEASE_MISMATCH');
      return {status:'WAITING',reason:'NO_REMOTE_EFFECT'};
    });
    assert.equal(result.mode,'WAITING');
    const saved=JSON.parse(await fs.readFile(store.file('autopilot-ledger.json'),'utf8'));
    assert.equal(saved.standingDelegationBudget,undefined,'mutation must not persist a claim');
    console.log('NEGATIVE_TASK_MUTATION:'+JSON.stringify({status:'DENIED',claims:0}));
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
