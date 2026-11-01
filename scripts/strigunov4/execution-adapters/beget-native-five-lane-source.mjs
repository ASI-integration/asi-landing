/** Strict source-only composition for one native five-lane publisher transaction.
 * The caller MUST be the signed host-runtime under its existing state.execute
 * lease. This is not an issuer, provider budget, authority token or writer.
 */
import {OWNER_LANES} from './owner-lanes.mjs';
import {inspectStandingTransaction} from './state.mjs';
import {planNativeOwnerLane} from './owner-lane-native-bridge.mjs';
import {inspectSourceIntake,proposeSourceWork} from '../source-work-intake.mjs';
import {compileSourcePublisherHandoff,nativeDevelopmentPath} from '../source-publisher-handoff.mjs';
import {inspectTaskIntake as inspectValue} from '../../global-dispatcher/task-intake.mjs';

const blocked=reason=>Object.freeze({
  schema:'asi.beget-native-five-lane-source.v1',status:'BLOCKED',
  authorized:false,reason,task:null
});
const sha40=/^[a-f0-9]{40}$/;
const supportedFile=/\.(?:mjs|js|json|py)$/;
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const laneSnapshot=t=>({id:t.id,sha:t.baseSha,repo:t.repo,
  branch:t.branch,kind:'github-publisher',stage:t.stage,
  changes:t.files.map(f=>({path:f.path,beforeSha256:f.beforeSha256}))});

/** Source-binding integration: prepares a candidate ONLY, never publishes it.
 * signedCatalog must originate from the native signed loader, and that loader
 * must be revalidated before/after the (possibly paid) model callback.
 * Caller-supplied callbacks are NOT an independent proof of host authorization.
 */
export async function prepareNativeFiveLaneSource({
  signedCatalog,store,ledger,transaction,nowMs,goalGraph,assessment,assessments,history=[],
  produce,revalidate
}={}) {
  try {
    if(typeof revalidate!=='function'||typeof produce!=='function'||
      !Number.isSafeInteger(nowMs)||nowMs<0||
      !Array.isArray(signedCatalog)||signedCatalog.length!==OWNER_LANES.length)
      return blocked('SIGNED_NATIVE_FIVE_LANE_CATALOG_REQUIRED');
    if(new Set(signedCatalog.map(t=>t.id)).size!==5||
      new Set(signedCatalog.map(t=>t.branch)).size!==5||
      !signedCatalog.every(t=>t&&t.kind==='source-proposal'&&
        t.stage==='S4-G2'&&sha40.test(t.baseSha||'')&&
        t.repo==='ASI-integration/asi-landing'&&
        typeof t.objective==='string'&&t.objective.length>0&&
        t.objective.length<=2400&&Array.isArray(t.files)&&
        t.files.length>=1&&t.files.length<=3&&
        t.files.every(f=>typeof f?.path==='string'&&supportedFile.test(f.path)&&
          nativeDevelopmentPath(f.path))&&
        OWNER_LANES.some(l=>l.id===t.laneId&&l.branch===t.branch&&
          l.repository===t.repo)))
      return blocked('SIGNED_SOURCE_SCOPE_INVALID');
    // Authentication belongs to the native host. A false/unknown readback
    // cannot be treated as an authorized snapshot.
    if(await revalidate()!==true)return blocked('SIGNED_HOST_REVALIDATION_REQUIRED');
    const pinned=structuredClone(signedCatalog);
    const candidates=pinned.map(laneSnapshot);
    const plan=await planNativeOwnerLane({
      store,ledger,transaction,signedCatalog:candidates,nowMs
    });
    if(plan.kind!=='CANDIDATE')return blocked('NATIVE_LANE_'+plan.reason);
    const task=pinned.find(t=>t.id===plan.candidate.taskId &&
      t.baseSha===plan.candidate.taskSha&&
      t.branch===plan.candidate.branch&&t.laneId===plan.candidate.laneId);
    if(!task)return blocked('NATIVE_LANE_SOURCE_MISMATCH');
    const intake=inspectSourceIntake({task,admittedTasks:pinned});
    if(intake.status!=='SOURCE_CANDIDATE')
      return blocked('SIGNED_SOURCE_INTAKE_DENIED');
    // In native mode the assessment must be selected from the same signed
    // catalog-bound map AFTER the fixed lane has been chosen.
    const decision=assessments===undefined?assessment:
      Object.hasOwn(assessments,task.id)?assessments[task.id]:null;
    const triage=inspectValue({product:'strigunov4',
      task:{id:task.id,paths:task.files.map(f=>f.path)},
      goalGraph,assessment:decision,history});
    if(triage.status!=='ACCEPTED')return blocked('NATIVE_SEMANTIC_'+triage.status);
    const value=await proposeSourceWork({task,admittedTasks:pinned,produce});
    if(value.status!=='PROPOSAL_PREPARED')
      return blocked('MODEL_PROPOSAL_'+(value.reason||'UNVERIFIED'));
    // A long-running model must not outlive the native lock/transaction.
    // Recheck the same private lease AFTER the network await.
    const lease=inspectStandingTransaction(transaction);
    if(lease.phase!=='admission'||lease.kind!=='github-publisher'||
       lease.root!==store.root||lease.ledger!==ledger)
      return blocked('NATIVE_TRANSACTION_CHANGED_AFTER_MODEL');
    if(await revalidate()!==true||!same(pinned,signedCatalog))
      return blocked('SIGNED_CATALOG_CHANGED_AFTER_MODEL');
    const handoff=compileSourcePublisherHandoff({task,admittedTasks:pinned,proposal:value});
    if(handoff.status!=='SOURCE_PREPARER_CANDIDATE')
      return blocked('PUBLISHER_HANDOFF_'+handoff.reason);
    if(handoff.task.laneId!==task.laneId||
      handoff.task.sha!==task.baseSha)
      return blocked('PUBLISHER_TASK_IDENTITY_CHANGED');
    return Object.freeze({
      schema:'asi.beget-native-five-lane-source.v1',
      status:'SOURCE_PREPARER_CANDIDATE',authorized:false,
      reason:'NATIVE_SIGNED_PUBLISHER_RESERVATION_AND_REVIEW_REQUIRED',
      task:handoff.task,sourceBinding:handoff.sourceBinding,
      proposalDigest:handoff.proposalDigest,laneId:task.laneId,
      intentKey:triage.intentKey
    });
  }catch{return blocked('NATIVE_SOURCE_INTEGRATION_UNVERIFIED');}
}
