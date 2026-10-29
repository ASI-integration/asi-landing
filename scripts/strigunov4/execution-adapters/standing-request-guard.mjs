/** Disabled diagnostic composition. Never a transport admission capability.
 * Provider snapshots here are proposal evidence, not authenticated authority.
 * Bootstrap GETs use the same durable budget; no result enables live effects.
 */
import path from 'node:path';
import {inspectStandingTransaction,atomicJson,digest,must,LIVE_ROOT} from './state.mjs';
import {ENGINE_ROOT,BEGET,verifySignedPayload,AUTHORITY_DIR,rootOwned} from './host-authority.mjs';
import {isCompiledGitHubRead} from './github-readonly.mjs';
import {inspectPublisherLifecycleEvidence} from './github-publisher.mjs';
import {createStandingPublisherBudget} from './standing-budget.mjs';
import {readProtectedStandingTrustSnapshot} from '../../agent-os/release-envelope-trust-roots.mjs';
import {readAuthenticatedProviderSnapshot,inspectAuthenticatedProviderSnapshot,assessRepositoryReleaseEnvelopeProposal,assessPublisherReleaseEnvelopeProposal,readAndAssessProtectedGateProposal} from '../../agent-os/check-demo-release.mjs';
const gateReceipts=new WeakMap(),admissionReceipts=new WeakMap();
export function inspectStandingAdmissionReceipt(receipt,request){
  const check=admissionReceipts.get(receipt);must(check,'STANDING_ADMISSION_UNTRUSTED');
  return check(request);
}
const blocked=reason=>Object.freeze({status:'BLOCKED',reason,authorized:false});
const h64=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const providerFields=['repository','number','baseSha','headSha','independentReviewerId'];
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
// Pure path check only: the genuine execute lease is checked before this predicate.
export function isIsolatedStandingPreviewRoot(root){
  if(typeof root!=='string'||!path.isAbsolute(root))return false;
  const resolved=path.resolve(root);
  return ![LIVE_ROOT,ENGINE_ROOT,BEGET.root,BEGET.runtime].some(parent=>below(resolved,path.resolve(parent)));
}
/** Isolated preview only. Never attach reserve() to transport: its result is NOT true. */
export function createStandingRequestPreview({store,transaction,signedEnvelope,signedEvidence,
  request,comparison,providerObservation,providerExpected,expectedTrust,clock=Date.now,protectedReader,
  isolatedPreview=false,publisherPhases=false,expectedAdoptionDigest=null}={}) {
  const initial=inspectStandingTransaction(transaction);
  must(expectedAdoptionDigest===null||h64(expectedAdoptionDigest),'STANDING_ADOPTION_PIN');
  must(typeof publisherPhases==='boolean','STANDING_PHASE_MODE');
  must(isolatedPreview===true&&isIsolatedStandingPreviewRoot(initial.root),
  'STANDING_ISOLATED_PREVIEW_REQUIRED');
  const declaredRoot=store&&Object.getOwnPropertyDescriptor(store,'root');
  must(declaredRoot&&Object.hasOwn(declaredRoot,'value')&&declaredRoot.value===initial.root&&
    initial.kind==='github-publisher','STANDING_STORE_MISMATCH');
  // Signed strings, comparison and proposal context are copied before asynchronous work.
  const input=dataCopy({signedEnvelope,signedEvidence,request,comparison,providerObservation:providerObservation??null,providerExpected:providerExpected??null,expectedTrust});
  // Journal paths come only from the authenticated state lease, never a caller facade.
  const boundStore=Object.freeze({root:initial.root,file(name){
    must(['execution.lock','autopilot-ledger.json'].includes(name),'STANDING_STATE_PATH');
    return path.join(initial.root,'state',name);
  }});
  // Observe every budget/trust clock read through one transaction-scoped floor.
  // A post-fsync rollback cannot revive expired or stale evidence; spent claims
  // remain durable when this throws and the preview becomes permanently blocked.
  const sourceClock=clock;let clockHighWater=-1;
  clock=()=>{
    const at=sourceClock();
    must(Number.isSafeInteger(at)&&at>=0&&at>=clockHighWater,'STANDING_CLOCK_REGRESSION');
    clockHighWater=at;return at;
  };
  const ledger=initial.ledger,budget=createStandingPublisherBudget({store:boundStore,ledger,clock});
  let ordinal=0,poisoned=false,bootstrapActive=false,pending=0,providerAttempted=false,authenticatedObservation;
  let tail=Promise.resolve(),phaseChanging=false,localPhase=null,exactPhase=null,phaseProvider=null;
  const admissionPhase={phase:'ADMISSION_READ',signedEvidence:input.signedEvidence,request:input.request,comparison:input.comparison};
  if(publisherPhases){
    must(input.request.headSha===null,'STANDING_PREPUBLICATION_HEAD');
    must(input.providerExpected&&Object.keys(input.providerExpected).length===1&&
      Number.isSafeInteger(input.providerExpected.independentReviewerId)&&input.providerExpected.independentReviewerId>0,
    'STANDING_REVIEWER_PIN_REQUIRED');
  }
  const bootstrapRoutes=new Set(!publisherPhases&&input.providerExpected?[`pulls/${input.providerExpected.number}`]:[]);
  for(let page=1;!publisherPhases&&input.providerExpected&&page<=3;page++){
    bootstrapRoutes.add(`pulls/${input.providerExpected.number}/reviews?per_page=100&page=${page}`);
    for(const [id,event,sha] of [[311380800,'pull_request',input.providerExpected.headSha],
      [390653294,'pull_request_target',input.providerExpected.baseSha]])
      bootstrapRoutes.add(`actions/workflows/${id}/runs?event=${event}&head_sha=${sha}&per_page=100&page=${page}`);
  }
  function verifyObservation(observation,at){
    const observedClock=at===undefined?clock:()=>at;
    must(observation?.status==='PROVIDER_EVIDENCE_VERIFIED'&&observation.authorized===false&&
      observation.snapshot?.expected&&Object.keys(observation.snapshot.expected).length===providerFields.length&&
      Object.keys(input.providerExpected).length===providerFields.length&&
      providerFields.every(key=>Object.hasOwn(observation.snapshot.expected,key)&&Object.hasOwn(input.providerExpected,key)&&
        observation.snapshot.expected[key]===input.providerExpected[key])&&
      observation.snapshot?.expected?.headSha===input.request.headSha&&
      observation.snapshot?.expected?.baseSha===input.request.baseSha&&
      observation.receipt?.observedAt===observation.snapshot.now&&
      observedClock()>=observation.snapshot.now&&observedClock()-observation.snapshot.now<=60000&&
      inspectAuthenticatedProviderSnapshot({...observation.snapshot,expected:input.providerExpected,now:observedClock()}).status==='PROVIDER_EVIDENCE_VERIFIED',
    'STANDING_PROVIDER_PROPOSAL_BLOCKED');
  }
  function assessPhase(phase,trust,descriptor,at=clock()){
    return assessPublisherReleaseEnvelopeProposal({signedEnvelope:input.signedEnvelope,
      signedEvidence:phase.signedEvidence,trustedPublicKey:trust.issuerPublicKey,
      verifierPublicKey:trust.verifierPublicKey,request:phase.request,now:at},
    {phase:phase.phase,transaction,publisherEvidence:phase.publisherEvidence,
      comparison:phase.comparison,descriptor,providerObservation:phase.providerObservation,
      providerExpected:phase.providerExpected});
  }
  async function readTrust(){
    const prior=ledger.standingRevocationCheckpoint;
    must(prior&&Number.isSafeInteger(prior.sequence)&&h64(prior.manifestDigest)&&
      Array.isArray(prior.revokedEnvelopeDigests),'STANDING_REVOCATION_HISTORY_REQUIRED');
    const trust=await readProtectedStandingTrustSnapshot({expected:{...input.expectedTrust,
      minRevocationSequence:prior.sequence,minRevocationManifestDigest:prior.manifestDigest,
      priorRevokedEnvelopeDigests:prior.revokedEnvelopeDigests},now:clock(),clock,protectedReader});
    must(trust.status==='PROTECTED_TRUST_VERIFIED','STANDING_TRUST_BLOCKED');return trust;
  }
  // The bootstrap switch is lexical, never a caller argument to reserve(). It
  // admits only the reader's fixed GET inventory after signed local checks.
  async function reserveInternal(descriptor,bootstrap=false,compiledRead=false,enqueuedLease,readDescriptor){
      try {
        const {method,route,payloadSha256,requestSha256}=descriptor||{};
        must(['GET','POST'].includes(method)&&typeof route==='string'&&
          /^[A-Za-z0-9_/?=&:%.-]+$/.test(route)&&h64(payloadSha256)&&h64(requestSha256)&&
          requestSha256===digest(JSON.stringify({method,route,payloadSha256})), 'STANDING_REQUEST_IDENTITY');
        const write=method==='POST'&&!compiledRead;
        const phase=publisherPhases?(write?localPhase:admissionPhase):null;
        if(publisherPhases)must(phase&&(!write||!exactPhase),'STANDING_LOCAL_PHASE_REQUIRED');
        must(!compiledRead||method==='POST'&&route==='graphql','STANDING_REQUEST_OPERATION');
        must(!write||writes[route],'STANDING_REQUEST_OPERATION');
        must(!descriptor.signal?.aborted,'STANDING_REQUEST_ABORTED');
        if(bootstrap)must(method==='GET'&&payloadSha256===digest('')&&bootstrapRoutes.has(route)&&
          input.providerExpected.repository===input.request.repo&&
          input.providerExpected.baseSha===input.request.baseSha&&
          input.providerExpected.headSha===input.request.headSha,'STANDING_BOOTSTRAP_SCOPE');
        const lease=inspectStandingTransaction(transaction,{write});
        if(enqueuedLease)must(lease.phase===enqueuedLease.phase&&lease.taskId===enqueuedLease.taskId&&
          lease.taskSha===enqueuedLease.taskSha,'STANDING_PHASE_CHANGED');
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
        if(publisherPhases){
          must(assessPhase(phase,trust,readDescriptor||descriptor).status==='PROPOSAL_ELIGIBLE',
            'STANDING_PHASE_PROPOSAL_BLOCKED');
        }else{
          if(!bootstrap)verifyObservation(providerAttempted?authenticatedObservation:input.providerObservation);
          must(assessRepositoryReleaseEnvelopeProposal({signedEnvelope:input.signedEnvelope,
            signedEvidence:input.signedEvidence,trustedPublicKey:trust.issuerPublicKey,
            verifierPublicKey:trust.verifierPublicKey,request:input.request,now:clock()},
          input.comparison).status==='PROPOSAL_ELIGIBLE','STANDING_REPOSITORY_PROPOSAL_BLOCKED');
        }
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
          requestSha256,envelopeDigest,phase:lease.phase,evidencePhase:publisherPhases?phase.phase:bootstrap?'bootstrap':'complete',
          ...(publisherPhases?{headBinding:'ORIGINAL_BASE_BEFORE_PUBLICATION',taskBinding:input.request.taskBinding,artifactDigest:input.request.artifactDigest}:{}),
          operationKind:kind};
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
        const result=await budget.reserve({readDescriptor,envelope:{...envelope,envelopeDigest},effect:{effectId,
          taskId,taskSha,headSha:publisherPhases?input.request.baseSha:input.request.headSha,method,route,payloadSha256,requestSha256,kind,envelopeDigest,repo:envelope.repo,environment:envelope.environment,
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
        // Reservation/trust I/O can cross the evidence freshness boundary.
        const finishedAt=clock(),witness=verifySignedPayload(publisherPhases?phase.signedEvidence:input.signedEvidence,finalTrust.verifierPublicKey);
        must(Number.isSafeInteger(finishedAt)&&Number.isSafeInteger(witness.observedAt)&&
          witness.observedAt>=envelope.notBefore&&witness.observedAt<=finishedAt&&
          finishedAt-witness.observedAt<=60000,'STANDING_EVIDENCE_STALE_AFTER_RESERVATION');
        if(publisherPhases)must(assessPhase(phase,finalTrust,readDescriptor||descriptor).status==='PROPOSAL_ELIGIBLE',
          'STANDING_PHASE_CHANGED_AFTER_RESERVATION');
        else if(!bootstrap)verifyObservation(providerAttempted?authenticatedObservation:input.providerObservation);
        must(!descriptor.signal?.aborted,'STANDING_REQUEST_ABORTED');
        // Evidence/clock callbacks above can invalidate the native selected task.
        // Capture time first, then close the lease boundary without another await
        // or caller callback. A late mismatch poisons this lane, never refunds it.
        const returnedAt=clock();
        must(returnedAt>=envelope.notBefore&&returnedAt<envelope.expiresAt,
          'STANDING_EXPIRED_BEFORE_RETURN');
        must(witness.observedAt<=returnedAt&&returnedAt-witness.observedAt<=60000,
          'STANDING_EVIDENCE_STALE_BEFORE_RETURN');
        if(publisherPhases)must(assessPhase(phase,finalTrust,readDescriptor||descriptor,returnedAt).status==='PROPOSAL_ELIGIBLE',
          'STANDING_PHASE_CHANGED_BEFORE_RETURN');
        else if(!bootstrap)verifyObservation(providerAttempted?authenticatedObservation:input.providerObservation,returnedAt);
        must(!descriptor.signal?.aborted,'STANDING_REQUEST_ABORTED');
        const returnedLease=inspectStandingTransaction(transaction,{write});
        must(returnedLease.phase===lease.phase&&returnedLease.taskId===lease.taskId&&
          returnedLease.taskSha===lease.taskSha,'STANDING_PHASE_CHANGED_BEFORE_RETURN');
        return Object.freeze({status:'RESERVED_PREVIEW',authorized:false,effectId,taskId,taskSha,
          requestSha256,requests:result.requests,writes:result.writes});
      } catch {poisoned=true;return blocked('STANDING_PREVIEW_REJECTED');}
  }
  return Object.freeze({
    // Explicit hard stop: neither bootstrap evidence nor a reservation grants authority.
    beforeRequest:async()=>false,
    reserve(descriptor){
      if(poisoned||bootstrapActive||phaseChanging)return Promise.resolve(blocked('STANDING_PREVIEW_LOCKED'));
      if(pending>=256){poisoned=true;return Promise.resolve(blocked('STANDING_QUEUE_LIMIT'));}
      let captured,compiledRead,enqueuedLease;
      try{
        // Only the actual compiled reader can brand a GraphQL query as a read.
        // Capture that provenance before copying; arbitrary caller flags are ignored.
        compiledRead=isCompiledGitHubRead(descriptor);
        const fields=Object.getOwnPropertyDescriptors(descriptor),copy={};
        for(const key of ['method','route','payloadSha256','requestSha256']){
          must(fields[key]&&Object.hasOwn(fields[key],'value')&&typeof fields[key].value==='string',
            'STANDING_REQUEST_IDENTITY');copy[key]=fields[key].value;
        }
        if(fields.signal){must(Object.hasOwn(fields.signal,'value')&&
          fields.signal.value instanceof AbortSignal,'STANDING_REQUEST_SIGNAL');copy.signal=fields.signal.value;}
        captured=Object.freeze(copy);
        enqueuedLease=inspectStandingTransaction(transaction,{write:copy.method==='POST'&&!compiledRead});
      }catch{poisoned=true;return Promise.resolve(blocked('STANDING_PREVIEW_REJECTED'));}
      pending++;
      const next=tail.then(()=>poisoned?blocked('STANDING_PREVIEW_LOCKED'):
        reserveInternal(captured,false,compiledRead,enqueuedLease,compiledRead?descriptor:undefined));
      // All ports share this single lane; failed/unknown reservations deny queued work.
      tail=next.then(()=>{},()=>{poisoned=true;});
      return next.finally(()=>{pending--;});
    },
    // Records native phase evidence only; never returns the transport's boolean grant.
    async observeLifecycle(event,evidence){
      if(!publisherPhases||poisoned||bootstrapActive||phaseChanging||pending>0)return blocked('STANDING_PREVIEW_LOCKED');
      phaseChanging=true;
      try{
        const native=inspectPublisherLifecycleEvidence(event,transaction),phase=native.phase;
        must(phase==='LOCAL_DELTA_VERIFIED'&&!localPhase&&!exactPhase||
          phase==='EXACT_HEAD_VERIFIED'&&!exactPhase,'STANDING_PHASE_ORDER');
        const supplied=dataCopy(evidence);
        if(phase==='EXACT_HEAD_VERIFIED')must(phaseProvider?.event===native,'STANDING_PHASE_PROVIDER_REQUIRED');
        const candidate={phase,publisherEvidence:native,signedEvidence:supplied.signedEvidence,
          request:phase==='LOCAL_DELTA_VERIFIED'?input.request:{...input.request,headSha:native.headSha,pr:native.pr},
          comparison:phase==='LOCAL_DELTA_VERIFIED'?input.comparison:{...input.comparison,headSha:native.headSha},
          providerObservation:phase==='EXACT_HEAD_VERIFIED'?phaseProvider.observation:null,
          providerExpected:phase==='EXACT_HEAD_VERIFIED'?phaseProvider.expected:null};
        const trust=await readTrust();
        must(assessPhase(candidate,trust).status==='PROPOSAL_ELIGIBLE','STANDING_PHASE_PROPOSAL_BLOCKED');
        // Phase observation advances the same durable revocation floor even
        // before its next metered request; a later old manifest cannot roll back.
        await atomicJson(boundStore.file('autopilot-ledger.json'),{...ledger,standingRevocationCheckpoint:trust.revocationCheckpoint});
        ledger.standingRevocationCheckpoint=trust.revocationCheckpoint;
        const finalTrust=await readTrust();
        must(finalTrust.revocationManifestDigest===trust.revocationManifestDigest&&
          assessPhase(candidate,finalTrust).status==='PROPOSAL_ELIGIBLE','STANDING_PHASE_CHANGED');
        inspectPublisherLifecycleEvidence(native,transaction);
        if(phase==='LOCAL_DELTA_VERIFIED')localPhase=candidate;else exactPhase=candidate;
        return Object.freeze({status:'PROPOSAL_ELIGIBLE',phase,authorized:false});
      }catch{poisoned=true;return blocked('STANDING_PHASE_REJECTED');}
      finally{phaseChanging=false;}
    },
    // PRE_GATE is a separate read-only evidence class. Never require the future
    // final provider token here or promote its result into phaseProvider.
    async readGateProposal({token,fetchImpl,expected,trustedGateContext,signedEvidence,publisherEvidence}={}){
      if(!publisherPhases||poisoned||bootstrapActive||phaseChanging||pending>0||!localPhase||exactPhase)
        return blocked('STANDING_PREVIEW_LOCKED');
      bootstrapActive=true;
      try{
        const lease=inspectStandingTransaction(transaction,{write:true});
        const native=inspectPublisherLifecycleEvidence(localPhase.publisherEvidence,transaction);
        const gateNative=inspectPublisherLifecycleEvidence(publisherEvidence,transaction);
        const pins=dataCopy({expected,trustedGateContext,signedEvidence});
        const e=pins.expected;
        must(gateNative.phase==='PRE_GATE_READY'&&gateNative.taskBinding===native.taskBinding&&
          gateNative.deltaSha256===native.deltaSha256&&gateNative.taskId===native.taskId&&
          gateNative.taskSha===native.taskSha&&gateNative.repo===native.repo&&
          gateNative.branch===native.branch&&gateNative.headSha===e.headSha&&gateNative.pr===e.number,
          'STANDING_GATE_NATIVE_BINDING');
        must(native.phase==='LOCAL_DELTA_VERIFIED'&&native.taskId===input.request.taskId&&
          native.taskSha===input.request.baseSha&&native.taskBinding===input.request.taskBinding&&
          e.repository===input.request.repo&&e.baseSha===input.request.baseSha&&
          e.independentReviewerId===input.providerExpected.independentReviewerId,
        'STANDING_GATE_IDENTITY');
        const prior=ledger.standingRevocationCheckpoint;
        const result=await readAndAssessProtectedGateProposal({signedEnvelope:input.signedEnvelope,
          signedEvidence:pins.signedEvidence,request:{...input.request,headSha:e.headSha,pr:e.number}},
        {expected:e,trustedGateContext:pins.trustedGateContext,
          comparison:{...input.comparison,headSha:e.headSha},
          expectedTrust:{...input.expectedTrust,minRevocationSequence:prior.sequence,
            minRevocationManifestDigest:prior.manifestDigest,priorRevokedEnvelopeDigests:prior.revokedEnvelopeDigests},
          token,fetchImpl,clock,protectedReader,beforeRequest:async descriptor=>{
            inspectPublisherLifecycleEvidence(gateNative,transaction);
            const reserved=await reserveInternal(descriptor,false);
            inspectPublisherLifecycleEvidence(gateNative,transaction);
            return reserved.status==='RESERVED_PREVIEW'&&!descriptor.signal.aborted;
          }});
        must((result.status==='PROPOSAL_ELIGIBLE'||result.status==='WAITING'&&result.reason==='GATE_SOURCE_PENDING'&&result.permittedEffect==='NONE')&&result.phase==='PRE_GATE'&&result.authorized===false,
          'STANDING_GATE_REJECTED');
        // Every GET already persisted its revocation floor with its spent claim.
        // A later different trust generation needs a new explicit observation;
        // never return a checkpoint that was not durably recorded in this lane.
        must(JSON.stringify(result.revocationCheckpoint)===JSON.stringify(ledger.standingRevocationCheckpoint),
          'STANDING_GATE_REVOCATION_CHANGED');
        const at=clock();
        const envelope=JSON.parse(input.signedEnvelope.payload),witness=JSON.parse(pins.signedEvidence.payload);
        must(at>=envelope.notBefore&&at<envelope.expiresAt&&
          Number.isSafeInteger(witness.observedAt)&&witness.observedAt<=at&&at-witness.observedAt<=60000,
          'STANDING_GATE_EXPIRED');
        must(at>=result.providerReceipt.observedAt&&at-result.providerReceipt.observedAt<=60000,
          'STANDING_GATE_STALE');
        const current=inspectStandingTransaction(transaction,{write:true});
        must(!poisoned&&current.phase===lease.phase&&current.taskId===lease.taskId&&
          current.taskSha===lease.taskSha,'STANDING_PHASE_CHANGED');
        inspectPublisherLifecycleEvidence(native,transaction);
        inspectPublisherLifecycleEvidence(gateNative,transaction);
        const receipt=Object.freeze(dataCopy(result));
        if(result.status==='PROPOSAL_ELIGIBLE')gateReceipts.set(receipt,{owner:input,event:gateNative,
          expected:dataCopy(e),revocation:JSON.stringify(ledger.standingRevocationCheckpoint)});
        return receipt;
      }catch{poisoned=true;return blocked('STANDING_GATE_REJECTED');}
      finally{bootstrapActive=false;}
    },
    async readAdoptedSourceAdmission(gateReceipt){
      if(poisoned||bootstrapActive||phaseChanging||pending>0)return blocked('STANDING_PREVIEW_LOCKED');
      bootstrapActive=true;
      try{
        const gate=gateReceipts.get(gateReceipt);
        must(expectedAdoptionDigest&&gate?.owner===input,'STANDING_ADOPTION_CONTEXT');
        inspectPublisherLifecycleEvidence(gate.event,transaction);
        const read=protectedReader||rootOwned;
        const file=path.join(AUTHORITY_DIR,'standing-adoption.json');
        const raw=await read(file,65536),signed=dataCopy(JSON.parse(raw));
        must(digest(signed.payload)===expectedAdoptionDigest,'STANDING_ADOPTION_PIN');
        const trust=await readTrust(),a=verifySignedPayload(signed,trust.issuerPublicKey);
        const envelope=JSON.parse(input.signedEnvelope.payload);
        must(JSON.stringify(a)===signed.payload&&a.schema==='asi.standing-adoption.v1'&&
          a.environment===envelope.environment&&a.target===envelope.target&&
          a.ownerId===207600140&&a.mode==='ROUTINE_SOURCE_ADMISSION_ONLY'&&a.repo===input.request.repo&&
          a.envelopeDigest===trust.envelopeDigest&&a.securityDigest===envelope.securityDigest&&
          a.policyDigest===envelope.policyDigest&&a.appId===envelope.appId&&a.installationId===envelope.installationId&&
          a.issuerKeySha256===trust.issuerKeySha256&&a.verifierKeySha256===trust.verifierKeySha256&&
          Number.isSafeInteger(a.notBefore)&&Number.isSafeInteger(a.expiresAt)&&
          a.notBefore>=envelope.notBefore&&a.expiresAt<=envelope.expiresAt&&
          a.expiresAt>a.notBefore&&a.expiresAt-a.notBefore<=14*86400000,'STANDING_ADOPTION_BINDING');
        must(await read(file,65536)===raw,'STANDING_ADOPTION_CHANGED');
        const finalTrust=await readTrust();
        must(finalTrust.envelopeDigest===trust.envelopeDigest&&finalTrust.issuerKeySha256===trust.issuerKeySha256&&
          finalTrust.verifierKeySha256===trust.verifierKeySha256&&
          JSON.stringify(finalTrust.revocationCheckpoint)===gate.revocation,'STANDING_ADOPTION_TRUST_CHANGED');
        const budgetState=JSON.stringify(ledger.standingDelegationBudget);
        const check=request=>{
          const at=clock();inspectPublisherLifecycleEvidence(gate.event,transaction);
          must(!poisoned&&at>=a.notBefore&&at<a.expiresAt&&
            at>=finalTrust.observedAt&&at<finalTrust.revocationExpiresAt&&
            at>=gateReceipt.providerReceipt.observedAt&&at-gateReceipt.providerReceipt.observedAt<=60000&&
            JSON.stringify(ledger.standingRevocationCheckpoint)===gate.revocation&&
            JSON.stringify(ledger.standingDelegationBudget)===budgetState,'STANDING_ADMISSION_STALE');
          must(request.prNumber===gate.expected.number&&request.headSha===gate.expected.headSha&&
            request.baseSha===gate.expected.baseSha&&
            JSON.stringify(request.changed)===JSON.stringify(input.request.changedPaths),'STANDING_ADMISSION_REQUEST');
          return {status:'STANDING_SOURCE_ADMISSION_VERIFIED',authorized:false,adoptionDigest:expectedAdoptionDigest};
        };
        check({prNumber:gate.expected.number,headSha:gate.expected.headSha,baseSha:gate.expected.baseSha,changed:input.request.changedPaths});
        const receipt=Object.freeze({status:'STANDING_SOURCE_ADMISSION_VERIFIED',authorized:false});
        admissionReceipts.set(receipt,check);return receipt;
      }catch{poisoned=true;return blocked('STANDING_ADOPTION_REJECTED');}
      finally{bootstrapActive=false;}
    },
    async readProvider({token,fetchImpl,publisherEvidence,expected}={}){
      if(poisoned||bootstrapActive||phaseChanging||pending>0)return blocked('STANDING_PREVIEW_LOCKED');
      bootstrapActive=true;providerAttempted=true;authenticatedObservation=undefined;
      try{
        const lease=inspectStandingTransaction(transaction);
        let pinned=input.providerExpected,native;
        if(publisherPhases){
          phaseProvider=null;native=inspectPublisherLifecycleEvidence(publisherEvidence,transaction);
          must(native.phase==='EXACT_HEAD_VERIFIED'&&native.taskId===input.request.taskId&&
            native.taskSha===input.request.baseSha&&native.taskBinding===input.request.taskBinding,
          'STANDING_PHASE_PROVIDER_IDENTITY');
          pinned=dataCopy(expected);
          must(pinned.repository===input.request.repo&&pinned.baseSha===input.request.baseSha&&
            pinned.headSha===native.headSha&&pinned.number===native.pr&&
            pinned.independentReviewerId===input.providerExpected.independentReviewerId,'STANDING_PHASE_PROVIDER_IDENTITY');
        }
        const observation=await readAuthenticatedProviderSnapshot({token,fetchImpl,clock,
          expected:dataCopy(pinned),beforeRequest:async descriptor=>{
            const result=await reserveInternal(descriptor,!publisherPhases);
            return result.status==='RESERVED_PREVIEW'&&!descriptor.signal.aborted;
          }});
        const current=inspectStandingTransaction(transaction);
        must(!poisoned&&current.phase===lease.phase&&current.taskId===lease.taskId&&
          current.taskSha===lease.taskSha,'STANDING_PHASE_CHANGED');
        if(publisherPhases){
          inspectPublisherLifecycleEvidence(native,transaction);
          must(observation.status==='PROVIDER_EVIDENCE_VERIFIED'&&observation.authorized===false&&
            inspectAuthenticatedProviderSnapshot({...observation.snapshot,expected:pinned,now:clock()}).status==='PROVIDER_EVIDENCE_VERIFIED',
          'STANDING_PHASE_PROVIDER_REJECTED');
          phaseProvider={event:native,expected:dataCopy(pinned),observation:dataCopy(observation)};
        }else verifyObservation(observation);
        // No externally supplied snapshot can overwrite the private observed bytes.
        authenticatedObservation=dataCopy(observation);
        return dataCopy(observation);
      }catch{poisoned=true;return blocked('STANDING_PROVIDER_READ_REJECTED');}
      finally{bootstrapActive=false;}
    },
  });
}
