/**
 * One-cycle coordinator for the EXISTING ASI-WD-Local Engine.
 * Plan -> serial host-admission -> up to five independent preparations ->
 * one native GitHub writer -> durable PR receipts. All real effects are host
 * ports wired to the existing signed runtime; this module issues no grant.
 */
import {planFiveWorkerWave} from './five-worker-wave.mjs';
import {prepareAdmittedFiveWorkerWave} from './five-worker-preparation.mjs';
import {publishPreparedFiveWorkerWave} from './native-five-worker-publisher.mjs';

const freeze=Object.freeze;
export async function runNativeFiveWorkerCycle({dispatcher,snapshots,hostPorts,
  maxWorkers=5}={}){
  const plan=await planFiveWorkerWave({dispatcher,snapshots,maxWorkers});
  if(!['PLANNED','PARTIAL'].includes(plan.status))return freeze({
    status:'WAITING',phase:'PLAN',reason:plan.reason,plan,
    prepared:null,published:null,verifiedReceipts:0});
  if(!hostPorts||typeof hostPorts!=='object')return freeze({
    status:'BLOCKED',phase:'ADMISSION',reason:'NATIVE_HOST_PORTS_REQUIRED',
    plan,prepared:null,published:null,verifiedReceipts:0});
  const prepared=await prepareAdmittedFiveWorkerWave({wave:plan,
    admit:hostPorts.admit,verifyAdmission:hostPorts.verifyAdmission,
    prepare:hostPorts.prepare});
  if(prepared.status==='BLOCKED')return freeze({
    status:'BLOCKED',phase:'ADMISSION',reason:prepared.reason,
    plan,prepared,published:null,verifiedReceipts:0});
  const published=await publishPreparedFiveWorkerWave({wave:prepared,
    authorizePublication:hostPorts.authorizePublication,
    publishDraft:hostPorts.publishDraft,
    verifyDraft:hostPorts.verifyDraft,
    appendReceipt:hostPorts.appendReceipt,
    readReceipt:hostPorts.readReceipt});
  return freeze({status:published.status==='RECEIPTS_VERIFIED'?
      'WAVE_RECEIPTS_VERIFIED':'PARTIAL',phase:'PUBLISH',
    plan,prepared,published,
    verifiedReceipts:published.results.filter(x=>x.status==='RECEIPT_VERIFIED').length});
}
