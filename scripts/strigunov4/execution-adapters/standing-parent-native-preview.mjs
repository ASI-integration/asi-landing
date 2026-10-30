/**
 * Stage-6 source-only bridge to the EXISTING Publisher state.execute transaction.
 * This is NOT a signing or authorization mechanism. A source eligibility result
 * must never enter provider requestAdmission(), reserve(), or protected release.
 * No host reads, network, keys, fsync, credentials, or independent worker.
 */
import {inspectStandingTransaction} from './state.mjs';
import {assessParentBudgetProposal} from './standing-parent-budget-proposal.mjs';

const WRITES=new Set(['create-tree','create-commit','create-branch','create-draft-pr']);
const deny=reason=>Object.freeze({status:'PARENT_NATIVE_PREVIEW_BLOCKED',reason,authorized:false});

/**
 * Only an actual transaction minted inside state.execute can reach the model.
 * Uses the transaction's own ledger object, never a caller-provided fake ledger.
 * Still requires separately authenticated parent+child signatures and revocation
 * before this can be considered by any future protected native admission.
 */
export function inspectParentCandidateInNativeTransaction({
  store,transaction,parent,child,childLinks,effect,now,revokedParentDigests
}={}){
  try{
    if(!store||typeof store.file!=='function'||typeof store.root!=='string'||
       !effect||typeof effect!=='object'||!Number.isSafeInteger(now)||now<0)
      return deny('NATIVE_PREVIEW_CONTEXT');
    const write=WRITES.has(effect.kind);
    const before=inspectStandingTransaction(transaction,{
      write,taskId:effect.taskId,taskSha:effect.taskSha
    });
    if(before.root!==store.root||before.phase==='admission'||
       !before.ledger||before.taskId!==effect.taskId||
       before.taskSha!==effect.taskSha||
       before.kind!=='github-publisher'||
       before.ledger.mode!=='FAILED_LOCKED'||
       before.ledger.reason!=='IN_FLIGHT_OR_CRASHED')
      return deny('NATIVE_PREVIEW_TASK_OR_LOCK');
    const decision=assessParentBudgetProposal({
      parent,child,childLinks,ledger:before.ledger,effect,now,revokedParentDigests
    });
    if(decision.status!=='PARENT_BUDGET_SOURCE_ELIGIBLE'||decision.authorized!==false)
      return deny('PARENT_SOURCE_NOT_ELIGIBLE');
    const after=inspectStandingTransaction(transaction,{
      write,taskId:effect.taskId,taskSha:effect.taskSha
    });
    if(after.ledger!==before.ledger||after.root!==before.root||
       after.transactionId!==before.transactionId||after.phase!==before.phase||
       after.taskId!==before.taskId||after.taskSha!==before.taskSha)
      return deny('NATIVE_PREVIEW_TRANSACTION_CHANGED');
    // No reservation or permission is returned; source-only eligibility.
    return Object.freeze({status:'PARENT_NATIVE_SOURCE_ELIGIBLE',authorized:false,
      transactionId:before.transactionId,taskId:before.taskId,
      taskSha:before.taskSha,phase:before.phase,
      parentDigest:decision.parentDigest,childDigest:decision.childDigest,
      retainedChildren:decision.retainedChildren,
      cumulativeOperationsIfReserved:decision.operations,
      cumulativeRequestsIfReserved:decision.requests,
      cumulativeWritesIfReserved:decision.writes});
  }catch{
    return deny('NATIVE_PREVIEW_UNTRUSTED_TRANSACTION');
  }
}
