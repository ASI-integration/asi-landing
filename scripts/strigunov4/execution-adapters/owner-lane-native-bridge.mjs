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
