import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {initializeState,inspectStandingTransaction} from './state.mjs';
import {inspectParentCandidateInNativeTransaction as inspect,inspectSignedParentInNativeTransaction as inspectSigned} from './standing-parent-native-preview.mjs';

const sha=v=>createHash('sha256').update(v).digest('hex');
const now=1793340000000,day=86400000;
const task=()=>({id:'native-preview-task',sha:'a'.repeat(40),stage:'S4-G2',
  repo:'ASI-integration/asi-landing',branch:'asi/engine-task/native-preview-task',pr:null});
function data(){
  const parent={schema:'asi.standing-parent.proposal.v1',
    digest:sha('source-only-parent'),securityDigest:sha('source-only-security'),
    policyDigest:sha('source-only-policy'),repo:'ASI-integration/asi-landing',
    environment:'beget-staging',target:'pqukibofpo',action:'source',
    paidApiUsd:0,notBefore:now-1000,expiresAt:now+365*day-1000,
    maxOperations:256,maxRequests:256,maxWrites:64};
  const child={...parent,schema:undefined,paidApiUsd:undefined,
    digest:sha('source-only-child'),notBefore:now-1000,expiresAt:now+14*day-1000,
    maxOperations:2,maxRequests:2,maxWrites:2};
  const link={childDigest:child.digest,parentDigest:parent.digest,
    issuerKeyDigest:sha('inert-fixture-issuer'),notBefore:child.notBefore,
    expiresAt:child.expiresAt,repo:child.repo,environment:child.environment,
    target:child.target,action:child.action,securityDigest:child.securityDigest,
    policyDigest:child.policyDigest};
  const method='GET',route='pulls/552',payloadSha256=sha('');
  const effect={effectId:'native-preview-1',taskId:task().id,taskSha:task().sha,
    headSha:task().sha,kind:'github-read',method,route,payloadSha256,
    requestSha256:sha(JSON.stringify({method,route,payloadSha256}))};
  return {parent,child,childLinks:{[child.digest]:link},effect};
}
async function fixture(t,check){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'asi-native-parent-preview-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const store=await initializeState(root);
  let calls=0;
  const github={verifyTask:async(verified,{transaction})=>{
    const lease=inspectStandingTransaction(transaction);
    if(!lease.ledger.standingDelegationBudget)
      lease.ledger.standingDelegationBudget={version:1,envelopes:{}};
    await check({store,transaction,lease,task:verified,calls:calls++});
    return {synthetic:'SOURCE_PREVIEW_ONLY',sha:verified.sha};
  }};
  const result=await store.execute('github-publisher',task(),github,
    async()=>({status:'WAITING'}));
  return {result,store,calls};
}

test('native state.execute task selection binds the source-only parent proposal',async t=>{
  const bound=data();
  const {result,calls,store}=await fixture(t,async({store,transaction,lease,task})=>{
    const prior=JSON.stringify(lease.ledger.standingDelegationBudget);
    const r=inspect({store,transaction,...bound,now});
    assert.equal(r.status,'PARENT_NATIVE_SOURCE_ELIGIBLE');
    assert.equal(r.authorized,false);
    assert.equal(r.taskId,task.id);
    assert.equal(r.taskSha,task.sha);
    assert.equal(r.phase,lease.phase);
    assert.equal(r.transactionId,lease.transactionId);
    assert.deepEqual(JSON.stringify(lease.ledger.standingDelegationBudget),prior);
  });
  assert.equal(calls,2);
  assert.equal(result.mode,'WAITING');
  assert.equal((await fs.stat(store.file('autopilot-ledger.json'))).isFile(),true);
});

test('forged or revoked parent cannot mint a native task preview or mutate journal',async t=>{
  const valid=data();
  const {result}=await fixture(t,async({store,transaction,lease})=>{
    const before=JSON.stringify(lease.ledger.standingDelegationBudget);
    assert.equal(inspect({store,transaction:{},...valid,now}).authorized,false);
    assert.equal(inspect({store:{...store,root:'/tmp/different-root'},transaction,...valid,now}).authorized,false);
    const revoked=inspect({store,transaction,...valid,now,
      revokedParentDigests:[valid.parent.digest]});
    assert.equal(revoked.status,'PARENT_NATIVE_PREVIEW_BLOCKED');
    assert.equal(revoked.authorized,false);
    const changed={...valid,effect:{...valid.effect,taskSha:'b'.repeat(40)}};
    assert.equal(inspect({store,transaction,...changed,now}).authorized,false);
    assert.equal(JSON.stringify(lease.ledger.standingDelegationBudget),before);
  });
  assert.equal(result.mode,'WAITING');
});

test('outside the existing state.execute callback, native proposal cannot be replayed',()=>{
  const valid=data();
  const r=inspect({store:{root:'/tmp/forged',file:()=>'/tmp/forged'},transaction:{},
    ...valid,now});
  assert.equal(r.status,'PARENT_NATIVE_PREVIEW_BLOCKED');
  assert.equal(r.authorized,false);
});

function signedInput(){
  const d=data();
  const owner=generateKeyPairSync('ed25519');
  const verifier=generateKeyPairSync('ed25519');
  const fingerprint=k=>sha(k.export({type:'spki',format:'der'}));
  const signed=(payload,key)=>{const raw=JSON.stringify(payload);
    return {payload:raw,signature:sign(null,Buffer.from(raw),key).toString('base64')};};
  const parent={...d.parent,baseSha:task().sha,stage:'S4-G2',
    approvedRoutineClasses:['stage4-source-maintenance','stage4-source-test']};
  delete parent.digest;
  const signedParent=signed(parent,owner.privateKey);
  const child={...d.child,baseSha:task().sha,stage:'S4-G2',
    approvedRoutineClasses:['stage4-source-maintenance'],
    schema:'asi.standing-child.proposal.v1',paidApiUsd:0,parentDigest:sha(signedParent.payload)};
  delete child.digest;
  const signedChild=signed(child,verifier.privateKey);
  const ownerPublicKey=owner.publicKey.export({type:'spki',format:'pem'});
  const verifierPublicKey=verifier.publicKey.export({type:'spki',format:'pem'});
  const expected={baseSha:task().sha,securityDigest:parent.securityDigest,
    policyDigest:parent.policyDigest,ownerKeySha256:fingerprint(owner.publicKey),
    verifierKeySha256:fingerprint(verifier.publicKey)};
  return {signedParent,signedChild,ownerPublicKey,verifierPublicKey,expected,
    effect:d.effect,now,revokedParentDigests:[],revokedChildDigests:[]};
}

test('both signed source payloads bind to real state.execute lease, still no permit',async t=>{
  const args=signedInput();
  const {result,calls}=await fixture(t,async({store,transaction,lease})=>{
    const before=JSON.stringify(lease.ledger.standingDelegationBudget);
    const outcome=inspectSigned({store,transaction,...args});
    assert.equal(outcome.status,'SIGNED_PARENT_NATIVE_SOURCE_ELIGIBLE',JSON.stringify(outcome));
    assert.equal(outcome.authorized,false);
    assert.equal(outcome.transactionId,lease.transactionId);
    assert.equal(outcome.taskId,args.effect.taskId);
    assert.equal(JSON.stringify(lease.ledger.standingDelegationBudget),before);
  });
  assert.equal(result.mode,'WAITING');
  assert.equal(calls,2);
});
test('signed source cannot reuse forged lease, signer or revoked parent',async t=>{
  const args=signedInput();
  const {result}=await fixture(t,async({store,transaction,lease})=>{
    const before=JSON.stringify(lease.ledger.standingDelegationBudget);
    for(const wrong of [
      {transaction:{}},
      {expected:{...args.expected,ownerKeySha256:sha('imposter')}},
      {revokedParentDigests:[sha(args.signedParent.payload)]},
      {signedChild:{...args.signedChild,payload:args.signedChild.payload+' '}},
      {effect:{...args.effect,taskSha:'b'.repeat(40)}},
      {store:{...store,root:'/tmp/imposter'}},
      {now:now+14*day},
    ]) {
      const out=inspectSigned({store,transaction,...args,...wrong});
      assert.equal(out.authorized,false);
      assert.notEqual(out.status,'SIGNED_PARENT_NATIVE_SOURCE_ELIGIBLE');
    }
    assert.equal(JSON.stringify(lease.ledger.standingDelegationBudget),before);
  });
  assert.equal(result.mode,'WAITING');
});
