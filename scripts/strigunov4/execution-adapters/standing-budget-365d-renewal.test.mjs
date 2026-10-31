import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {initializeState,inspectStandingTransaction} from './state.mjs';
import {createStandingPublisherBudget} from './standing-budget.mjs';
import {inspectSignedParentInNativeTransaction} from './standing-parent-native-preview.mjs';
import {inspectSignedParentChildSource} from './standing-parent-signature-source.mjs';

const sha=x=>createHash('sha256').update(x).digest('hex');
const D=86400000,N=1793400000000,SHA40='a'.repeat(40);
const owner=generateKeyPairSync('ed25519'),verifier=generateKeyPairSync('ed25519');
const signed=(payload,key)=>{const text=JSON.stringify(payload);return {payload:text,signature:sign(null,Buffer.from(text),key.privateKey).toString('base64')};};
const publicPem=k=>k.publicKey.export({type:'spki',format:'pem'});
const fingerprint=k=>sha(k.publicKey.export({type:'spki',format:'der'}));
const common={repo:'ASI-integration/asi-landing',environment:'beget-staging',target:'pqukibofpo',
 action:'source',stage:'S4-G2',baseSha:SHA40,approvedRoutineClasses:['stage4-source-maintenance'],
 securityDigest:sha('p0wb-year-security'),policyDigest:sha('p0wb-year-policy'),paidApiUsd:0};
const parent={...common,schema:'asi.standing-parent.proposal.v1',notBefore:N,
 expiresAt:N+365*D,maxOperations:40,maxRequests:40,maxWrites:1};
const signedParent=signed(parent,owner),parentDigest=sha(signedParent.payload);
const expected={baseSha:SHA40,securityDigest:common.securityDigest,
 policyDigest:common.policyDigest,ownerKeySha256:fingerprint(owner),
 verifierKeySha256:fingerprint(verifier)};
const ownerPublicKey=publicPem(owner),verifierPublicKey=publicPem(verifier);
const kids=Array.from({length:27},(_,i)=>{
 const notBefore=N+i*14*D,expiresAt=Math.min(N+(i+1)*14*D,parent.expiresAt);
 const body={...common,schema:'asi.standing-child.proposal.v1',parentDigest,
  notBefore,expiresAt,maxOperations:2,maxRequests:2,maxWrites:1};
 const wrapped=signed(body,verifier);
 return {body,wrapped,digest:sha(wrapped.payload),at:notBefore+1000};
});
const task=i=>({id:`renewal-task-${i}`,sha:SHA40,repo:common.repo,stage:'S4-G2',
 pr:null,branch:`source-only/renewal-${i}`});
const envelope=k=>({schema:'asi.release-envelope.proposal.v1',repo:common.repo,
 environment:common.environment,target:common.target,action:common.action,
 envelopeDigest:k.digest,securityDigest:common.securityDigest,policyDigest:common.policyDigest,
 notBefore:k.body.notBefore,expiresAt:k.body.expiresAt,paidApiUsd:0,
 maxOperations:2,maxRequests:2,maxWrites:1});
function effect(i,k){
 const method='GET',route='pulls/552',payloadSha256=sha('');
 return {effectId:`renewal-read-${i}`,taskId:`renewal-task-${i}`,taskSha:SHA40,
 headSha:SHA40,kind:'github-read',method,route,payloadSha256,
 requestSha256:sha(JSON.stringify({method,route,payloadSha256})),
 envelopeDigest:k.digest,repo:common.repo,environment:common.environment,
 target:common.target,action:common.action};
}

test('365-day parent retains and validates 27 consecutive signed child renewals, no external effects',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'p0wb-365-renewal-'));
 try{
  const store=await initializeState(root);
  let decisions=0;
  for(let i=0;i<kids.length;i++){
   const k=kids[i],e=effect(i,k);
   const history=Object.fromEntries(kids.slice(0,i).map(old=>[old.digest,old.wrapped]));
   let verificationCount=0;
   const result=await store.execute('github-publisher',task(i),{
    async verifyTask(_task,{transaction}){
     if(verificationCount++===0){
      const args={store,transaction,effect:e,now:k.at,
       signedParent,signedChild:k.wrapped,ownerPublicKey,verifierPublicKey,
       expected,historicalSignedChildren:history,
       revokedParentDigests:[],revokedChildDigests:[]};
      const decision=inspectSignedParentInNativeTransaction(args);
      assert.equal(decision.status,'SIGNED_PARENT_NATIVE_SOURCE_ELIGIBLE',JSON.stringify({i,decision}));
      assert.equal(decision.authorized,false);
      assert.equal(decision.retainedChildren,i+1);
      assert.equal(decision.cumulativeRequestsIfReserved,i+1);
      decisions++;
      if(i===0){
       const ledger=inspectStandingTransaction(transaction).ledger;
       // Explicit/corrupt keys are not equivalent to a truly absent history.
       for(const corrupt of [undefined,null,{version:999,envelopes:{}}]){
        ledger.standingDelegationBudget=corrupt;
        const refusal=inspectSignedParentInNativeTransaction(args);
        assert.equal(refusal.reason,'NATIVE_SIGNED_HISTORY_UNAVAILABLE');
       }
       delete ledger.standingDelegationBudget;
       const extraneous=inspectSignedParentInNativeTransaction({
        ...args,historicalSignedChildren:{['b'.repeat(64)]:k.wrapped}});
       assert.equal(extraneous.reason,'NATIVE_SIGNED_HISTORY_UNVERIFIED');
      }
      if(i===26){
       const missing=inspectSignedParentInNativeTransaction({...args,historicalSignedChildren:{}});
       assert.equal(missing.reason,'NATIVE_SIGNED_HISTORY_UNVERIFIED');
       const revoked=inspectSignedParentInNativeTransaction({...args,revokedChildDigests:[kids[0].digest]});
       assert.equal(revoked.reason,'NATIVE_SIGNED_HISTORY_UNVERIFIED');
      }
     }
     return {sourceOnly:true};
    }
   },async({transaction})=>{
    const {ledger}=inspectStandingTransaction(transaction);
    const budget=createStandingPublisherBudget({store,ledger,transaction,clock:()=>k.at});
    const reservation=await budget.reserve({envelope:envelope(k),effect:e});
    assert.equal(reservation.status,'RESERVED',JSON.stringify({i,reservation}));
    return {status:'WAITING',reason:'NO_PROVIDER_CALL'};
   });
   assert.equal(result.mode,'WAITING');
  }
  const ledger=JSON.parse(await fs.readFile(store.file('autopilot-ledger.json'),'utf8'));
  const entries=Object.entries(ledger.standingDelegationBudget.envelopes);
  assert.equal(entries.length,27);
  assert.equal(entries.reduce((sum,[,e])=>sum+e.claims.length,0),27);
  assert.equal(new Set(entries.map(([digest])=>digest)).size,27);
  assert.equal(decisions,27);
  const expired=inspectSignedParentChildSource({signedParent,signedChild:kids[26].wrapped,
   ownerPublicKey,verifierPublicKey,expected,now:parent.expiresAt,
   revokedParentDigests:[],revokedChildDigests:[]});
  assert.equal(expired.status,'SIGNED_PARENT_CHILD_SOURCE_BLOCKED');
  console.log('P0WB_365_RENEWAL_PROOF='+JSON.stringify({days:365,children:27,
   durableClaims:27,currentRevocationNegative:'BLOCKED',missingHistoryNegative:'BLOCKED',
   parentExpiry:'BLOCKED',externalEffects:0,authorized:false}));
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
