import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash, generateKeyPairSync, sign} from 'node:crypto';
import {initializeState, inspectStandingTransaction} from './state.mjs';
import {createStandingPublisherBudget} from './standing-budget.mjs';
import {inspectSignedParentInNativeTransaction} from './standing-parent-native-preview.mjs';

const sha = x => createHash('sha256').update(x).digest('hex');
const D = 86400000, N = 1793400000000;
const baseSha = 'a'.repeat(40), at = N + 1000;
const owner = generateKeyPairSync('ed25519');
const verifier = generateKeyPairSync('ed25519');
const signed = (payload, key) => {
  const bytes = JSON.stringify(payload);
  return {payload:bytes, signature:sign(null, Buffer.from(bytes), key.privateKey).toString('base64')};
};
const pub = key => key.publicKey.export({type:'spki', format:'pem'});
const fingerprint = key => sha(key.publicKey.export({type:'spki', format:'der'}));
const common = {repo:'ASI-integration/asi-landing', environment:'beget-staging',
  target:'pqukibofpo', action:'source', stage:'S4-G2', baseSha,
  approvedRoutineClasses:['stage4-source-maintenance'],
  securityDigest:sha('admission-security'), policyDigest:sha('admission-policy'), paidApiUsd:0};
const parent = {...common, schema:'asi.standing-parent.proposal.v1',
  notBefore:N, expiresAt:N+365*D, maxOperations:3, maxRequests:3, maxWrites:1};
const signedParent = signed(parent, owner);
const child = {...common, schema:'asi.standing-child.proposal.v1',
  parentDigest:sha(signedParent.payload), notBefore:N, expiresAt:N+14*D,
  maxOperations:2, maxRequests:2, maxWrites:1};
const signedChild = signed(child, verifier);
const childDigest = sha(signedChild.payload);
const expected = {baseSha, securityDigest:common.securityDigest, policyDigest:common.policyDigest,
  ownerKeySha256:fingerprint(owner), verifierKeySha256:fingerprint(verifier)};
const envelope = {schema:'asi.release-envelope.proposal.v1',
  repo:common.repo, environment:common.environment, target:common.target,
  action:common.action, envelopeDigest:childDigest,
  securityDigest:common.securityDigest, policyDigest:common.policyDigest,
  notBefore:child.notBefore, expiresAt:child.expiresAt, paidApiUsd:0,
  maxOperations:child.maxOperations, maxRequests:child.maxRequests, maxWrites:child.maxWrites};

test('signed parent source preview binds first admission GET to native lock and pinned base; reserves once', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'p0wb-signed-admission-'));
  let finalArgs;
  try {
    const store = await initializeState(root);
    let providerCalls = 0;
    const outcome = await store.execute('github-publisher', async ({transaction,ledger}) => {
      const native = inspectStandingTransaction(transaction);
      assert.equal(native.phase,'admission');
      assert.equal(native.taskId,null);
      assert.equal(native.taskSha,null);
      const method='GET',route='pulls/552',payloadSha256=sha('');
      const effect={effectId:'admission-read-1',taskId:`admission-${native.transactionId}`,
        taskSha:baseSha,headSha:baseSha,kind:'github-read',method,route,payloadSha256,
        requestSha256:sha(JSON.stringify({method,route,payloadSha256})),
        envelopeDigest:childDigest,repo:common.repo,environment:common.environment,
        target:common.target,action:common.action};
      finalArgs={store,transaction,effect,now:at,signedParent,signedChild,
        ownerPublicKey:pub(owner),verifierPublicKey:pub(verifier),
        expected,revokedParentDigests:[],revokedChildDigests:[]};
      const preview=inspectSignedParentInNativeTransaction(finalArgs);
      assert.equal(preview.status,'SIGNED_PARENT_NATIVE_SOURCE_ELIGIBLE',JSON.stringify(preview));
      assert.equal(preview.authorized,false);
      assert.equal(preview.transactionId,native.transactionId);
      assert.equal(preview.taskId,effect.taskId);
      assert.equal(preview.taskSha,baseSha);
      assert.equal(preview.retainedChildren,1);
      assert.equal(preview.cumulativeRequestsIfReserved,1);

      const wrongTask=inspectSignedParentInNativeTransaction({...finalArgs,
        effect:{...effect,taskId:'admission-unrelated'}});
      assert.equal(wrongTask.status,'PARENT_NATIVE_PREVIEW_BLOCKED');
      const wrongBase=inspectSignedParentInNativeTransaction({...finalArgs,
        effect:{...effect,headSha:'b'.repeat(40)}});
      assert.equal(wrongBase.status,'PARENT_NATIVE_PREVIEW_BLOCKED');
      const writeMethod='POST',writeRoute='git/trees',writePayload=sha('{}');
      const write=inspectSignedParentInNativeTransaction({...finalArgs,
        effect:{...effect,kind:'create-tree',method:writeMethod,route:writeRoute,
          payloadSha256:writePayload,
          requestSha256:sha(JSON.stringify({method:writeMethod,route:writeRoute,payloadSha256:writePayload}))}});
      assert.equal(write.status,'PARENT_NATIVE_PREVIEW_BLOCKED');

      const nativeBudget=createStandingPublisherBudget({store,ledger,transaction,
        admissionBaseSha:baseSha,clock:()=>at});
      const reservation=await nativeBudget.reserve({envelope,effect});
      assert.equal(reservation.status,'RESERVED',JSON.stringify(reservation));
      return null;
    },{},async()=>{providerCalls++;throw new Error('PROVIDER_ACTION_FORBIDDEN');});
    assert.equal(outcome.mode,'WAITING');
    assert.equal(providerCalls,0);
    const saved=JSON.parse(await fs.readFile(store.file('autopilot-ledger.json'),'utf8'));
    assert.equal(saved.standingDelegationBudget.envelopes[childDigest].claims.length,1);
    assert.equal(saved.standingDelegationBudget.envelopes[childDigest].claims[0].taskSha,baseSha);
    const afterClose=inspectSignedParentInNativeTransaction(finalArgs);
    assert.equal(afterClose.status,'PARENT_NATIVE_PREVIEW_BLOCKED');
    console.log('P0WB_SIGNED_ADMISSION='+JSON.stringify({preTaskGet:1,
      durableClaims:1,wrongTask:'BLOCKED',wrongBase:'BLOCKED',write:'BLOCKED',
      closedTransaction:'BLOCKED',liveEffects:providerCalls,authorized:false}));
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
