import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {assessParentBudgetProposal as assess} from './standing-parent-budget-proposal.mjs';

const h=s=>createHash('sha256').update(s).digest('hex');
const Y=365*86400000,D=86400000;
const start=1793340000000;
const sha40='a'.repeat(40);
const parent=()=>({schema:'asi.standing-parent.proposal.v1',digest:h('signed-parent'),
  securityDigest:h('security'),policyDigest:h('policy'),repo:'ASI-integration/asi-landing',
  environment:'beget-staging',target:'pqukibofpo',action:'source',paidApiUsd:0,
  notBefore:start,expiresAt:start+Y,maxOperations:256,maxRequests:256,maxWrites:64});
const child=(i,p=parent())=>({...p,digest:h('child'+i),schema:undefined,paidApiUsd:undefined,
  notBefore:start+i*D,expiresAt:start+(i+1)*D,maxOperations:2,maxRequests:2,maxWrites:2});
const link=(c,p)=>({childDigest:c.digest,parentDigest:p.digest,issuerKeyDigest:h('verified-issuer-fixture'),
  notBefore:c.notBefore,expiresAt:c.expiresAt,repo:c.repo,environment:c.environment,
  target:c.target,action:c.action,securityDigest:c.securityDigest,policyDigest:c.policyDigest});
const claim=(id,time,kind='create-commit')=>{
  const method=kind==='github-read'?'GET':'POST', route=kind==='github-read'?'pulls/552':'git/commits';
  const payloadSha256=h(id+'-payload');
  return {effectId:id,taskId:'task-'+id,taskSha:sha40,headSha:sha40,kind,method,route,payloadSha256,
    requestSha256:h(JSON.stringify({method,route,payloadSha256})),reservedAt:time,phase:'RESERVED',
    publicationJournal:`publication-task-${id}.json`};
};
function fixture(n=1,p=parent()){
  const children=Array.from({length:n},(_,i)=>child(i,p));
  const childLinks=Object.fromEntries(children.map(c=>[c.digest,link(c,p)]));
  const envelopes=Object.fromEntries(children.map(c=>[c.digest,{scope:c,claims:[],operations:0,requests:0,writes:0,
    lastObservedAt:c.notBefore}]));
  const ledger={schemaVersion:'asi.execution-adapters.v1',standingDelegationBudget:{version:1,envelopes}};
  const effect=claim('fresh',start+2*D);
  return {parent:p,child:children[0],childLinks,ledger,effect,now:start+1000};
}
function spend(f,index,id,kind='create-commit'){
  const scope=Object.values(f.ledger.standingDelegationBudget.envelopes)[index];
  const c=claim(id,scope.scope.notBefore+500,kind);
  scope.claims.push(c);scope.operations++;scope.requests++;scope.writes+=Number(kind!=='github-read');
  scope.lastObservedAt=c.reservedAt;
}
test('new source proposal is never authorization',()=>{
  const f=fixture();const r=assess(f);
  assert.equal(r.status,'PARENT_BUDGET_SOURCE_ELIGIBLE');assert.equal(r.authorized,false);
});
test('two independent child spend amounts count against parent cumulative cap',()=>{
  const f=fixture(2);spend(f,0,'one');spend(f,1,'two');
  f.parent.maxOperations=2;f.parent.maxRequests=2;f.parent.maxWrites=2;f.now=start+D+1000;
  f.child=Object.values(f.ledger.standingDelegationBudget.envelopes)[1].scope;
  assert.equal(assess(f).reason,'PARENT_CUMULATIVE_BUDGET_EXHAUSTED');
});
test('27 child rotations retained with spent claims, no deletion',()=>{
  const f=fixture(27);for(let i=0;i<27;i++)spend(f,i,'used-'+i,'github-read');
  f.child=Object.values(f.ledger.standingDelegationBudget.envelopes)[26].scope;
  f.now=f.child.notBefore+1000;
  const r=assess(f);assert.equal(r.status,'PARENT_BUDGET_SOURCE_ELIGIBLE');
  assert.equal(r.retainedChildren,27);assert.equal(r.operations,28);
});
test('child cap fails independently of parent cap',()=>{
  const f=fixture();spend(f,0,'one');spend(f,0,'two');
  assert.equal(assess(f).reason,'CHILD_BUDGET_EXHAUSTED');
});
test('cross-child duplicate write fingerprint denied after reopen',()=>{
  const f=fixture(2);spend(f,0,'one');f.child=Object.values(f.ledger.standingDelegationBudget.envelopes)[1].scope;
  f.now=f.child.notBefore+1000;
  f.effect={...f.ledger.standingDelegationBudget.envelopes[child(0).digest].claims[0],effectId:'new-id'};
  assert.equal(assess(structuredClone(f)).reason,'PARENT_REPLAY');
});
test('cross-child duplicate effect ID denied even for different wire',()=>{
  const f=fixture(2);spend(f,0,'used');f.child=Object.values(f.ledger.standingDelegationBudget.envelopes)[1].scope;
  f.effect={...f.effect,effectId:'used'};f.now=f.child.notBefore+1000;
  assert.equal(assess(f).reason,'PARENT_REPLAY');
});
test('orphan child with no authenticated parent link denied',()=>{
  const f=fixture();delete f.childLinks[f.child.digest];
  assert.equal(assess(f).reason,'PARENT_HISTORY_OR_LINK_INVALID');
});
test('forged wrong parent digest rejected',()=>{
  const f=fixture();f.childLinks[f.child.digest].parentDigest=h('different-parent');
  assert.equal(assess(f).reason,'PARENT_HISTORY_OR_LINK_INVALID');
});
test('untrusted child issuer link shape rejected',()=>{
  const f=fixture();f.childLinks[f.child.digest].issuerKeyDigest='owner-comment';
  assert.equal(assess(f).reason,'PARENT_HISTORY_OR_LINK_INVALID');
});
test('explicit parent revocation denies',()=>{
  const f=fixture();f.revokedParentDigests=[f.parent.digest];
  assert.equal(assess(f).reason,'PARENT_REVOKED_OR_UNVERIFIED_REVOCATION');
});
test('parent expiry denies even when child is supplied',()=>{
  const f=fixture();f.now=f.parent.expiresAt;
  assert.equal(assess(f).reason,'PARENT_INVALID_OR_EXPIRED');
});
test('backward clock below historical spent claim denies',()=>{
  const f=fixture();spend(f,0,'one');f.now=start+1;
  assert.equal(assess(f).reason,'PARENT_CLOCK_REGRESSION');
});
test('missing historical claim or changed durable counter denies',()=>{
  const f=fixture();spend(f,0,'one');f.ledger.standingDelegationBudget.envelopes[f.child.digest].claims=[];
  assert.equal(assess(f).reason,'PARENT_HISTORY_COUNTER_MISMATCH');
});
test('historical unknown or duplicate post is never refunded',()=>{
  const f=fixture(2);spend(f,0,'one');spend(f,1,'one');
  assert.equal(assess(f).reason,'PARENT_HISTORY_REPLAY_OR_CORRUPTION');
});
test('exceeds bounded history without forgetting claims',()=>{
  const f=fixture(64);const c=child(64,f.parent);
  f.child=c;f.childLinks[c.digest]=link(c,f.parent);f.now=c.notBefore+1000;
  assert.equal(assess(f).reason,'PARENT_HISTORY_FULL');
});
test('child cannot extend beyond parent or exceed 14 days',()=>{
  const f=fixture();f.child.expiresAt=f.parent.expiresAt+1;
  assert.equal(assess(f).reason,'PARENT_HISTORY_OR_LINK_INVALID');
});
test('reject accessors rather than reading hostile parent properties',()=>{
  const f=fixture();Object.defineProperty(f.parent,'digest',{get(){throw Error('unexpected getter');}});
  assert.equal(assess(f).reason,'PARENT_INVALID_OR_EXPIRED');
});
