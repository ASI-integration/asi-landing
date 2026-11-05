/** Composition of existing five-lane handoff and ONE native Publisher port.
 * Source-only. No authority, credential, daemon, second ledger or automatic retry.
 * All external operations require host-supplied existing signed native ports.
 */
import {compileFiveWorkerPublisherHandoff} from './five-worker-publisher-handoff.mjs';
import {handoffToSingleNativePublisher} from './five-worker-publisher-bridge.mjs';

export async function runUniversalFiveWorkerHandoff({
  wave,preparation,readPrepared,verifyPrepared,publishOne,verifyReceipt,
  timeoutMs=60000
}={}){
  const handoff=await compileFiveWorkerPublisherHandoff({wave,preparation,readPrepared});
  if(handoff.status!=='CANDIDATES_READY'){
    return Object.freeze({status:'BLOCKED',reason:handoff.reason,authorized:false,
      publisherConcurrency:1,receiptCount:0,results:Object.freeze([]),
      blocked:handoff.blocked});
  }
  // This exact transformed subset contains no authority. Each candidate still
  // needs genuine native readback, publication and terminal receipt.
  const candidates=handoff.ready.map(x=>Object.freeze({
    status:'PREPARED',taskId:x.taskId,product:x.product,
    repository:x.repository,baseSha:x.baseSha,artifactSha256:x.artifactSha256
  }));
  const next=await handoffToSingleNativePublisher({
    preparation:Object.freeze({status:'PREPARED',publisherReady:false,
      results:Object.freeze(candidates)}),
    verifyPrepared,publishOne,verifyReceipt,timeoutMs
  });
  const receiptCount=next.receiptCount??0;
  const partial=handoff.blocked.length>0||next.status!=='VERIFIED';
  return Object.freeze({
    status:partial?'PARTIAL':'VERIFIED',
    reason:partial?'AWAIT_NATIVE_RECEIPTS_OR_RECONCILIATION':'ALL_NATIVE_RECEIPTS_CONFIRMED',
    authorized:false,publisherConcurrency:1,receiptCount,
    results:next.results??Object.freeze([]),
    blocked:handoff.blocked
  });
}
