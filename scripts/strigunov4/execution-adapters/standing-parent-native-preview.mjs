/**
 * Stage-6 source-only bridge to the EXISTING Publisher state.execute transaction.
 * This is NOT a signing or authorization mechanism. A source eligibility result
 * must never enter provider requestAdmission(), reserve(), or protected release.
 * No host reads, network, keys, fsync, credentials, or independent worker.
 */
import {inspectStandingTransaction} from './state.mjs';
import {assessParentBudgetProposal} from './standing-parent-budget-proposal.mjs';
import {inspectSignedParentChildSource} from './standing-parent-signature-source.mjs';

const WRITES=new Set(['create-tree','create-commit','create-branch','create-draft-pr']);
const deny=reason=>Object.freeze({status:'PARENT_NATIVE_PREVIEW_BLOCKED',reason,authorized:false});

/**
 * Only an actual transaction minted inside state.execute can reach the model.
 * Uses the transaction's own ledger object, never a caller-provided fake ledger.
 * Still requires separately authenticated parent+child signatures and revocation
 * before this can be considered by any future protected native admission.
 */
export function inspectParentCandidateInNativeTransaction({
  store,transaction,parent,child,childLinks,effect,now,revokedParentDigests,
  admissionBaseSha
}={}){
  try{
    if(!store||typeof store.file!=='function'||typeof store.root!=='string'||
       !effect||typeof effect!=='object'||!Number.isSafeInteger(now)||now<0)
      return deny('NATIVE_PREVIEW_CONTEXT');
    const write=WRITES.has(effect.kind);
    const before=inspectStandingTransaction(transaction,{write});
    // Admission happens before a selected task exists. Its only allowed
    // reservation is a GET tied to the independently pinned protected base
    // and this transaction's private ID, exactly as native reserve() requires.
    // A caller-supplied base is NOT itself a trust root or an authorization.
    const admission=before.phase==='admission';
    const admissionBound=admission&&!write&&effect.kind==='github-read'&&
      effect.method==='GET'&&/^[a-f0-9]{40}$/.test(admissionBaseSha??'')&&
      effect.taskId===`admission-${before.transactionId}`&&
      effect.taskSha===admissionBaseSha&&effect.headSha===admissionBaseSha&&
      before.taskId===null&&before.taskSha===null;
    const selectedBound=!admission&&
      ['preflight','started','postflight'].includes(before.phase)&&
      before.taskId===effect.taskId&&before.taskSha===effect.taskSha;
    if(before.root!==store.root||(!admissionBound&&!selectedBound)||
       !before.ledger||before.kind!=='github-publisher'||
       before.ledger.mode!=='FAILED_LOCKED'||
       before.ledger.reason!=='IN_FLIGHT_OR_CRASHED')
      return deny('NATIVE_PREVIEW_TASK_OR_LOCK');
    const decision=assessParentBudgetProposal({
      parent,child,childLinks,ledger:before.ledger,effect,now,revokedParentDigests
    });
    if(decision.status!=='PARENT_BUDGET_SOURCE_ELIGIBLE'||decision.authorized!==false)
      return deny('PARENT_SOURCE_NOT_ELIGIBLE');
    const after=inspectStandingTransaction(transaction,{write});
    if(after.ledger!==before.ledger||after.root!==before.root||
       after.transactionId!==before.transactionId||after.phase!==before.phase||
       after.taskId!==before.taskId||after.taskSha!==before.taskSha)
      return deny('NATIVE_PREVIEW_TRANSACTION_CHANGED');
    // No reservation or permission is returned; source-only eligibility.
    return Object.freeze({status:'PARENT_NATIVE_SOURCE_ELIGIBLE',authorized:false,
      transactionId:before.transactionId,
      taskId:admission?effect.taskId:before.taskId,
      taskSha:admission?effect.taskSha:before.taskSha,phase:before.phase,
      parentDigest:decision.parentDigest,childDigest:decision.childDigest,
      retainedChildren:decision.retainedChildren,
      cumulativeOperationsIfReserved:decision.operations,
      cumulativeRequestsIfReserved:decision.requests,
      cumulativeWritesIfReserved:decision.writes});
  }catch{
    return deny('NATIVE_PREVIEW_UNTRUSTED_TRANSACTION');
  }
}

/**
 * Source-only signed variant. Authenticates both exact payload signatures
 * against CALLER-SUPPLIED keys/context, then uses real state.execute task/root
 * identity and existing parent history model. Cannot confer a native permit.
 * A future protected-base caller must independently read and pin trust keys
 * and revocation floor before passing any result into an actual admission.
 */
export function inspectSignedParentInNativeTransaction({
  store,transaction,effect,now,signedParent,signedChild,ownerPublicKey,
  verifierPublicKey,expected,revokedParentDigests,revokedChildDigests,
  historicalSignedChildren
}={}){
  try{
    const evidence=inspectSignedParentChildSource({
      signedParent,signedChild,ownerPublicKey,verifierPublicKey,expected,
      now,revokedParentDigests,revokedChildDigests
    });
    if(evidence.status!=='SIGNED_PARENT_CHILD_SOURCE_VERIFIED'||evidence.authorized!==false)
      return deny('NATIVE_SIGNED_SOURCE_UNVERIFIED');
    // Historical claims are durable in the EXISTING Publisher ledger. Never
    // trust caller-supplied child links: independently verify each original
    // signed child at its FIRST recorded reservation time, using today's
    // revocations, exact pinned public keys and the same signed parent.
    // This cannot itself establish journal authenticity or grant authority.
    const native=inspectStandingTransaction(transaction);
    // The first durable child starts with an IDLE ledger containing no
    // standingDelegationBudget key. Accept only that exact *absent* case as
    // zero history; explicit null/undefined or malformed journal fails closed.
    // No new ledger is written here: reserve() still owns the sole fsynced
    // initialization under the same native lock.
    const ledger=native?.ledger;
    const hasBudget=!!ledger&&Object.hasOwn(ledger,'standingDelegationBudget');
    const budget=hasBudget?ledger.standingDelegationBudget:null;
    if(hasBudget&&(!budget||budget.version!==1))
      return deny('NATIVE_SIGNED_HISTORY_UNAVAILABLE');
    const envelopes=hasBudget?budget.envelopes:Object.create(null);
    if(!envelopes||typeof envelopes!=='object'||Array.isArray(envelopes)||
       ![Object.prototype,null].includes(Object.getPrototypeOf(envelopes)))
      return deny('NATIVE_SIGNED_HISTORY_UNAVAILABLE');
    const entries=Object.entries(envelopes);
    if(entries.length>64)return deny('NATIVE_SIGNED_HISTORY_LIMIT');
    const old=entries.filter(([digest])=>digest!==evidence.child.digest);
    const history=historicalSignedChildren===undefined
      ? Object.create(null):historicalSignedChildren;
    if(!history||typeof history!=='object'||Array.isArray(history)||
       ![Object.prototype,null].includes(Object.getPrototypeOf(history))||
       Reflect.ownKeys(history).length!==old.length)
      return deny('NATIVE_SIGNED_HISTORY_UNVERIFIED');
    const childLinks=Object.create(null);
    childLinks[evidence.child.digest]=evidence.childLink;
    for(const [digest,entry] of old){
      const descriptor=Object.getOwnPropertyDescriptor(history,digest);
      const at=entry?.claims?.[0]?.reservedAt;
      if(!descriptor||!Object.hasOwn(descriptor,'value')||
         !Number.isSafeInteger(at)||at<0)
        return deny('NATIVE_SIGNED_HISTORY_UNVERIFIED');
      const historical=inspectSignedParentChildSource({
        signedParent,signedChild:descriptor.value,ownerPublicKey,
        verifierPublicKey,expected,now:at,revokedParentDigests,
        revokedChildDigests
      });
      if(historical.status!=='SIGNED_PARENT_CHILD_SOURCE_VERIFIED'||
         historical.authorized!==false||
         historical.child.digest!==digest||
         historical.parent.digest!==evidence.parent.digest)
        return deny('NATIVE_SIGNED_HISTORY_UNVERIFIED');
      childLinks[digest]=historical.childLink;
    }
    const proposal=inspectParentCandidateInNativeTransaction({
      store,transaction,parent:evidence.parent,child:evidence.child,
      childLinks,effect,now,revokedParentDigests,
      admissionBaseSha:evidence.baseSha
    });
    if(proposal.status!=='PARENT_NATIVE_SOURCE_ELIGIBLE'||proposal.authorized!==false||
       proposal.parentDigest!==evidence.parent.digest||
       proposal.childDigest!==evidence.child.digest)
      return deny('NATIVE_SIGNED_SOURCE_NOT_BOUND');
    return Object.freeze({...proposal,status:'SIGNED_PARENT_NATIVE_SOURCE_ELIGIBLE',
      authorized:false,ownerKeySha256:evidence.ownerKeySha256,
      verifierKeySha256:evidence.verifierKeySha256});
  }catch{return deny('NATIVE_SIGNED_SOURCE_UNTRUSTED');}
}
