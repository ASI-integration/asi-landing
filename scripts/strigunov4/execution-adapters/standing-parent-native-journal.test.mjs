import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {initializeState} from './state.mjs';
import {createStandingPublisherBudget} from './standing-budget.mjs';
import {assessParentBudgetProposal} from './standing-parent-budget-proposal.mjs';

const h=v=>createHash('sha256').update(v).digest('hex');
const at=1793260000000, DAY=86400000;
const task={id:'parent-native-first',sha:'c'.repeat(40),repo:'ASI-integration/asi-landing',
  branch:'parent-native-first',pr:null,stage:'S4-G2'};
const parent={schema:'asi.standing-parent.proposal.v1',digest:h('isolated-parent'),
  repo:task.repo,environment:'beget-staging',target:'pqukibofpo',action:'source',
  securityDigest:h('sec'),policyDigest:h('policy'),notBefore:at-1000,
  expiresAt:at-1000+365*DAY,paidApiUsd:0,maxOperations:1,maxRequests:1,maxWrites:1};
const child=(name,from,to)=>({...parent,schema:undefined,digest:h(name),
  notBefore:from,expiresAt:to});
const first=child('first-child',at-1000,at+500);
const second=child('second-child',at+500,at+14*DAY);
const link=c=>({childDigest:c.digest,parentDigest:parent.digest,issuerKeyDigest:h('issuer'),
  repo:c.repo,environment:c.environment,target:c.target,action:c.action,
  securityDigest:c.securityDigest,policyDigest:c.policyDigest,
  notBefore:c.notBefore,expiresAt:c.expiresAt,paidApiUsd:0,
  maxOperations:c.maxOperations,maxRequests:c.maxRequests,maxWrites:c.maxWrites});
const links={[first.digest]:link(first),[second.digest]:link(second)};
const wire=(id)=>{const method='POST',route='git/commits',payloadSha256=h(id);
  return {effectId:id,taskId:task.id,taskSha:task.sha,headSha:task.sha,
    kind:'create-commit',method,route,payloadSha256,
    requestSha256:h(JSON.stringify({method,route,payloadSha256})),
    envelopeDigest:first.digest,repo:task.repo,environment:'beget-staging',
    target:'pqukibofpo',action:'source'};};
test('actual native durable journal canonical scope supports parent cumulative check, never authorizes',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'p0wb-native-parent-'));
  try{
    const store=await initializeState(root);let originalLedger;
    const result=await store.execute('github-publisher',
      async({ledger})=>{originalLedger=ledger;return {...task};},
      {async verifyTask(){return {verified:true};}},
      async({transaction})=>{
        const b=createStandingPublisherBudget({store,ledger:originalLedger,transaction,clock:()=>at});
        const env={...first,schema:'asi.release-envelope.proposal.v1',envelopeDigest:first.digest};
        assert.equal((await b.reserve({envelope:env,effect:wire('first-spend')})).status,'RESERVED');
        return {status:'WAITING'};
      });
    assert.equal(result.mode,'WAITING');
    const ledger=JSON.parse(await fs.readFile(store.file('autopilot-ledger.json'),'utf8'));
    const stored=ledger.standingDelegationBudget.envelopes[first.digest];
    assert.equal(stored.claims.length,1);
    assert.equal(Object.hasOwn(stored.scope,'paidApiUsd'),false,'native scope omits implicit fixed zero-paid cap');
    const oldChild=assessParentBudgetProposal({parent,child:first,childLinks:links,ledger,
      effect:wire('new-request'),now:at+1});
    assert.equal(oldChild.reason,'CHILD_BUDGET_EXHAUSTED',
      'native journal should be accepted then enforce child cap, not fail on omitted implicit zero');
    const renewed=assessParentBudgetProposal({parent,child:second,childLinks:links,ledger,
      effect:wire('renewed-child-request'),now:at+600});
    assert.equal(renewed.reason,'PARENT_CUMULATIVE_BUDGET_EXHAUSTED',
      'new child must not reset signed parent aggregate cap');
    const forged=structuredClone(ledger);
    forged.standingDelegationBudget.envelopes[first.digest].scope.paidApiUsd=1;
    const forbidden=assessParentBudgetProposal({parent,child:second,childLinks:links,
      ledger:forged,effect:wire('new-request'),now:at+600});
    assert.equal(forbidden.reason,'PARENT_HISTORY_OR_LINK_INVALID',
      'explicit paid scope tampering must not be accepted');
    console.log('NATIVE_PARENT_PROOF:'+JSON.stringify({claims:stored.claims.length,
      journalPaidField:'omitted-fixed-zero',child:oldChild.reason,
      renewed:renewed.reason,explicitPaid:forbidden.reason,authorized:false}));
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
