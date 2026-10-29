/** Disabled diagnostic composition. Never a transport admission capability.
 * Provider snapshots here are proposal evidence, not authenticated authority.
 * Live adoption still requires metering the provider reader's own bootstrap GETs.
 */
import path from 'node:path';
import {inspectStandingTransaction,atomicJson,digest,must,LIVE_ROOT} from './state.mjs';
import {ENGINE_ROOT,verifySignedPayload} from './host-authority.mjs';
import {createStandingPublisherBudget} from './standing-budget.mjs';
import {readProtectedStandingTrustSnapshot} from '../../agent-os/release-envelope-trust-roots.mjs';
import {inspectAuthenticatedProviderSnapshot,assessRepositoryReleaseEnvelopeProposal} from '../../agent-os/check-demo-release.mjs';
const blocked=reason=>Object.freeze({status:'BLOCKED',reason,authorized:false});
const h64=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const writes={'git/trees':'create-tree','git/commits':'create-commit','git/refs':'create-branch',pulls:'create-draft-pr'};
function dataCopy(value,depth=0){
  must(depth<20,'STANDING_CONTEXT_DEPTH');
  if(value===null||['string','boolean','number'].includes(typeof value))return value;
  must(value&&typeof value==='object'&&(Array.isArray(value)||[Object.prototype,null].includes(Object.getPrototypeOf(value))),'STANDING_CONTEXT_DATA');
  const out=Array.isArray(value)?[]:{};
  for(const [k,d] of Object.entries(Object.getOwnPropertyDescriptors(value))){
    if(Array.isArray(value)&&k==='length')continue;
    must(Object.hasOwn(d,'value')&&k!=='__proto__','STANDING_CONTEXT_DATA');out[k]=dataCopy(d.value,depth+1);
  }return out;
}
const below=(root,parent)=>root===parent||root.startsWith(parent+path.sep);
/** Isolated preview only. Never attach reserve() to transport: its result is NOT true. */
export function createStandingRequestPreview({store,transaction,signedEnvelope,signedEvidence,
  request,comparison,providerObservation,providerExpected,expectedTrust,clock=Date.now,protectedReader,
  isolatedPreview=false}={}) {
  const initial=inspectStandingTransaction(transaction);
  must(isolatedPreview===true&&path.isAbsolute(initial.root)&&
    !below(path.resolve(initial.root),LIVE_ROOT)&&!below(path.resolve(initial.root),ENGINE_ROOT),
  'STANDING_ISOLATED_PREVIEW_REQUIRED');
  const declaredRoot=store&&Object.getOwnPropertyDescriptor(store,'root');
  must(declaredRoot&&Object.hasOwn(declaredRoot,'value')&&declaredRoot.value===initial.root&&
    initial.kind==='github-publisher','STANDING_STORE_MISMATCH');
  // Signed strings, comparison and proposal context are copied before asynchronous work.
  const input=dataCopy({signedEnvelope,signedEvidence,request,comparison,providerObservation,providerExpected,expectedTrust});
  // Journal paths come only from the authenticated state lease, never a caller facade.
  const boundStore=Object.freeze({root:initial.root,file(name){
    must(['execution.lock','autopilot-ledger.json'].includes(name),'STANDING_STATE_PATH');
    return path.join(initial.root,'state',name);
  }});
  const ledger=initial.ledger,budget=createStandingPublisherBudget({store:boundStore,ledger,clock});
  let ordinal=0,poisoned=false,busy=false;
  return Object.freeze({
    // Explicit hard stop: no proposal result can activate the optional live transport hook.
    beforeRequest:async()=>false,
    async reserve(descriptor) {
      if(poisoned||busy)return blocked('STANDING_PREVIEW_LOCKED');
      busy=true;
      try {
        const {method,route,payloadSha256,requestSha256}=descriptor||{};
        must(['GET','POST'].includes(method)&&typeof route==='string'&&
          /^[A-Za-z0-9_/?=&:%.-]+$/.test(route)&&h64(payloadSha256)&&h64(requestSha256)&&
          requestSha256===digest(JSON.stringify({method,route,payloadSha256})), 'STANDING_REQUEST_IDENTITY');
        const write=method==='POST';must(!write||writes[route],'STANDING_REQUEST_OPERATION');
        const lease=inspectStandingTransaction(transaction,{write});
        must(lease.root===boundStore.root&&lease.ledger===ledger,'STANDING_STORE_MISMATCH');
        if(lease.taskId)must(lease.taskId===input.request.taskId&&lease.taskSha===input.request.baseSha,'STANDING_TASK_EVIDENCE');
        const prior=ledger.standingRevocationCheckpoint;
        // No implicit empty history initialization: operator-seeded floor must already exist.
        must(prior&&Number.isSafeInteger(prior.sequence)&&h64(prior.manifestDigest)&&
          Array.isArray(prior.revokedEnvelopeDigests),'STANDING_REVOCATION_HISTORY_REQUIRED');
        const trust=await readProtectedStandingTrustSnapshot({expected:{...input.expectedTrust,
          minRevocationSequence:prior.sequence,minRevocationManifestDigest:prior.manifestDigest,
          priorRevokedEnvelopeDigests:prior.revokedEnvelopeDigests},now:clock(),clock,protectedReader});
        must(trust.status==='PROTECTED_TRUST_VERIFIED','STANDING_TRUST_BLOCKED');
        inspectStandingTransaction(transaction,{write});
        const envelope=verifySignedPayload(input.signedEnvelope,trust.issuerPublicKey);
        const envelopeDigest=digest(input.signedEnvelope.payload);
        must(envelopeDigest===trust.envelopeDigest&&envelope.verifierKeySha256===trust.verifierKeySha256,
          'STANDING_SIGNATURE_BINDING');
        const observation=input.providerObservation;
        must(observation?.status==='PROVIDER_EVIDENCE_VERIFIED'&&observation.authorized===false&&
          JSON.stringify(observation.snapshot?.expected)===JSON.stringify(input.providerExpected)&&
          observation.snapshot?.expected?.headSha===input.request.headSha&&
          observation.snapshot?.expected?.baseSha===input.request.baseSha&&
          observation.receipt?.observedAt===observation.snapshot.now&&
          clock()>=observation.snapshot.now&&clock()-observation.snapshot.now<=60000&&
          inspectAuthenticatedProviderSnapshot({...observation.snapshot,expected:input.providerExpected,now:clock()}).status==='PROVIDER_EVIDENCE_VERIFIED',
          'STANDING_PROVIDER_PROPOSAL_BLOCKED');
        must(assessRepositoryReleaseEnvelopeProposal({signedEnvelope:input.signedEnvelope,
          signedEvidence:input.signedEvidence,trustedPublicKey:trust.issuerPublicKey,
          verifierPublicKey:trust.verifierPublicKey,request:input.request,now:clock()},
        input.comparison).status==='PROPOSAL_ELIGIBLE','STANDING_REPOSITORY_PROPOSAL_BLOCKED');
        const current=inspectStandingTransaction(transaction,{write});
        must(current.phase===lease.phase&&current.taskId===lease.taskId&&current.taskSha===lease.taskSha,
          'STANDING_PHASE_CHANGED');
        const taskId=lease.taskId||`admission-${lease.transactionId}`;
        const taskSha=lease.taskSha||input.request.baseSha;
        const kind=write?writes[route]:'github-read';
        // Writes bind exact wire identity across transactions; reads also bind phase/ordinal.
        const effectId=digest(JSON.stringify({envelopeDigest,method,route,payloadSha256,
          ...(write?{}:{transactionId:lease.transactionId,phase:lease.phase,ordinal:ordinal++})}));
        const binding={taskId,taskSha,candidateSha:input.request.headSha,method,route,payloadSha256,
          requestSha256,envelopeDigest,phase:lease.phase};
        const bindings=ledger.standingRequestBindings||{};
        must(!Object.hasOwn(bindings,effectId),'STANDING_REQUEST_REPLAY');
        must(Object.keys(bindings).length<256,'STANDING_REQUEST_HISTORY_FULL');
        const nextBindings={...bindings,[effectId]:binding};
        // Same existing journal, same execute lock. If the subsequent budget commit
        // fails, this binding remains an irreversible intent and the transaction fails.
        await atomicJson(boundStore.file('autopilot-ledger.json'),{...ledger,
          standingRevocationCheckpoint:trust.revocationCheckpoint,standingRequestBindings:nextBindings});
        ledger.standingRevocationCheckpoint=trust.revocationCheckpoint;
        ledger.standingRequestBindings=nextBindings;
        inspectStandingTransaction(transaction,{write});
        const result=await budget.reserve({envelope:{...envelope,envelopeDigest},effect:{effectId,
          taskId,headSha:taskSha,kind,envelopeDigest,repo:envelope.repo,environment:envelope.environment,
          target:envelope.target,action:envelope.action}});
        inspectStandingTransaction(transaction,{write});
        must(result.status==='RESERVED','STANDING_BUDGET_BLOCKED');
        must(Number.isSafeInteger(clock())&&clock()>=envelope.notBefore&&clock()<envelope.expiresAt,'STANDING_EXPIRED_AFTER_RESERVATION');
        const finalTrust=await readProtectedStandingTrustSnapshot({expected:{...input.expectedTrust,
          minRevocationSequence:trust.revocationCheckpoint.sequence,
          minRevocationManifestDigest:trust.revocationCheckpoint.manifestDigest,
          priorRevokedEnvelopeDigests:trust.revocationCheckpoint.revokedEnvelopeDigests},now:clock(),clock,protectedReader});
        const finalLease=inspectStandingTransaction(transaction,{write});
        must(finalLease.phase===lease.phase&&finalLease.taskId===lease.taskId&&finalLease.taskSha===lease.taskSha,'STANDING_PHASE_CHANGED');
        must(finalTrust.status==='PROTECTED_TRUST_VERIFIED'&&
          finalTrust.revocationManifestDigest===trust.revocationManifestDigest&&
          clock()>=envelope.notBefore&&clock()<envelope.expiresAt,'STANDING_CHANGED_AFTER_RESERVATION');
        return Object.freeze({status:'RESERVED_PREVIEW',authorized:false,effectId,taskId,taskSha,
          requestSha256,requests:result.requests,writes:result.writes});
      } catch {poisoned=true;return blocked('STANDING_PREVIEW_REJECTED');}
      finally {busy=false;}
    },
  });
}
