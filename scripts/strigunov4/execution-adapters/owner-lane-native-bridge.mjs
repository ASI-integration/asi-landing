/**
 * Five owner lanes, bound to the SAME existing Engine execute() transaction.
 *
 * This is a source-only selection bridge, not a host authority issuer,
 * dispatcher, scheduler, token, provider, writer, or new journal. The only
 * durable lane state is the property already present in the Engine ledger.
 * Never infer admission from five named branches or a caller's snapshot.
 */
import {OWNER_LANES} from './owner-lanes.mjs';
import {planCooperativeOwnerLane} from './owner-lane-planner.mjs';

const BLOCKED = reason => Object.freeze({
  schema:'asi.beget-native-five-lane-bridge.v1',kind:'BLOCKED',reason,
  authority:'NONE_SOURCE_ONLY',candidate:null,lanes:[],
});

export async function planNativeOwnerLane({store,ledger,transaction,signedCatalog,nowMs}={}) {
  // Only state.execute() can mint this WeakMap-backed native token; it verifies
  // the original on-disk lock inode on each inspection.
  let lease;
  try { const {inspectStandingTransaction}=await import('./state.mjs');
    lease=inspectStandingTransaction(transaction);
  } catch {return BLOCKED('NATIVE_ENGINE_TRANSACTION_UNVERIFIED');}
  if(lease.kind!=='github-publisher' || lease.phase!=='admission' ||
     lease.root!==store?.root || lease.ledger!==ledger ||
     ledger?.mode!=='FAILED_LOCKED' || ledger?.reason!=='IN_FLIGHT_OR_CRASHED')
    return BLOCKED('NATIVE_ENGINE_TRANSACTION_MISMATCH');
  if(!Array.isArray(signedCatalog) || signedCatalog.length===0)
    return BLOCKED('SIGNED_CATALOG_MISSING');
  // The host must supply the catalog from its EXISTING signed loader; no
  // untrusted Issue, PR, control-plane label or environment can add a lane.
  // This bridge cannot independently authenticate the catalog or return an
  // authority token. A caller must revalidate signed host policy before use.
  const durable=ledger.ownerLaneJournal;
  if(!durable || typeof durable!=='object' || Array.isArray(durable))
    return BLOCKED('OWNER_LANE_JOURNAL_NOT_INITIALIZED');
  let plan;
  try {
    plan=planCooperativeOwnerLane({
      laneDefinitions:OWNER_LANES.map(({id,repository,branch})=>({id,repository,branch})),
      admittedCatalog:structuredClone(signedCatalog),
      journal:structuredClone(durable),
      nowMs
    });
  }catch{return BLOCKED('OWNER_LANE_SNAPSHOT_UNVERIFIED');}
  if(plan.kind!=='CANDIDATE')return Object.freeze({
    schema:'asi.beget-native-five-lane-bridge.v1',kind:plan.kind,
    reason:plan.reason,lanes:plan.lanes,candidate:null,authority:'NONE_SOURCE_ONLY'
  });
  const matches=signedCatalog.filter(t=>t.id===plan.candidate.taskId &&
    t.sha===plan.candidate.taskSha && t.branch===plan.candidate.branch &&
    t.repo===plan.candidate.repository);
  if(matches.length!==1)return BLOCKED('NATIVE_CANDIDATE_NOT_EXACTLY_ADMITTED');
  return Object.freeze({schema:'asi.beget-native-five-lane-bridge.v1',
    kind:'CANDIDATE',reason:'REQUIRES_FRESH_SIGNED_POLICY_AND_PUBLISHER_ADMISSION',
    lanes:plan.lanes,candidate:plan.candidate,authority:'NONE_SOURCE_ONLY'});
}


/** Fail closed an UNKNOWN source-model outcome WITHOUT consuming or deleting
 * an existing paid reservation. Source-only proposal; the original native
 * Publisher transaction must verify and fsync the exact resulting ledger.
 * The blocked lane cannot run again automatically; independent lanes remain
 * eligible under the same signed catalog and cumulative budgets.
 */
export function proposeUncertainModelLaneQuarantine({
  ledger,signedCatalog,failedTaskId,failedLaneId,model,baseSha
}={}){
  const deny=reason=>Object.freeze({status:'DENIED',reason,authorized:false});
  try {
    const previous=ledger?.nativeFiveLaneTask;
    if(!ledger||ledger.mode!=='FAILED_LOCKED'||ledger.reason!=='IN_FLIGHT_OR_CRASHED'||
      (previous!==undefined&&(previous?.status!=='DONE'||
        previous.task?.id===failedTaskId))||
      !Array.isArray(signedCatalog)||signedCatalog.length!==5||
      typeof failedTaskId!=='string'||typeof failedLaneId!=='string'||
      typeof model!=='string'||typeof baseSha!=='string')
      return deny('UNVERIFIED_NATIVE_MODEL_TRANSACTION');
    const task=signedCatalog.filter(x=>x.id===failedTaskId&&
      x.laneId===failedLaneId&&x.baseSha===baseSha&&
      x.stage==='S4-G2'&&x.repo==='ASI-integration/asi-landing');
    if(task.length!==1)return deny('UNKNOWN_MODEL_TASK_NOT_IN_SIGNED_CATALOG');
    const journal=ledger.ownerLaneJournal;
    const prior=journal?.lanes?.[failedLaneId];
    if(journal?.schema!=='asi.beget-owner-lane-journal.v1'||
      journal.engineMode!=='IDLE'||!prior||
      prior.mode!=='READY'||prior.taskId!==failedTaskId||
      prior.taskSha!==baseSha||prior.retries!==0||
      prior.nextEligibleAtMs!==0)
      return deny('NATIVE_LANE_NOT_READY_FOR_QUARANTINE');
    const budget=ledger.modelReservationBudget;
    const claims=budget?.claims;
    if(budget?.version!==1||!Array.isArray(claims)||
      claims.length===0||claims.length>256||
      claims.some(c=>typeof c?.taskId!=='string'||
        typeof c?.model!=='string'||typeof c?.pathDigest!=='string'||
        !/^[a-f0-9]{64}$/.test(c.pathDigest))||
      !claims.some(c=>c.taskId===failedTaskId&&
        c.model===model&&c.baseSha===baseSha))
      return deny('NO_REAL_PRIOR_SIGNED_MODEL_RESERVATION');
    const updated=structuredClone(journal);
    updated.lanes[failedLaneId].mode='BLOCKED';
    return Object.freeze({status:'MODEL_UNKNOWN_LANE_QUARANTINE_SOURCE_ONLY',
      authorized:false,reason:'PAID_MODEL_OUTCOME_UNVERIFIED_NO_REPLAY',
      taskId:failedTaskId,laneId:failedLaneId,
      nextJournal:updated});
  }catch{return deny('MODEL_QUARANTINE_INPUT_UNREADABLE');}
}
