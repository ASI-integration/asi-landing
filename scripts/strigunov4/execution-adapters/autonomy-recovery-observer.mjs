/**
 * Read-only, source-level interpretation of EXISTING Engine receipts, systemd
 * identity and per-lane heartbeats. The input must come from an authorized
 * independently verified host observer. This module does not read protected
 * files, gain privileges, run systemctl, restart the unit, publish or grant
 * work. All conclusions remain unverified until the host evidence is attested.
 */
import {createHash} from 'node:crypto';
import {OWNER_LANES} from './owner-lanes.mjs';

const H40=/^[a-f0-9]{40}$/;
const H64=/^[a-f0-9]{64}$/;
const INV=/^[a-f0-9]{32}$/;
const ID=/^[a-z0-9][a-z0-9-]{0,95}$/;
const UNIT='asi-strigunov-agent.service';
const digest=s=>createHash('sha256').update(s).digest('hex');
const plain=o=>o!==null && typeof o==='object'&&!Array.isArray(o)&&
  (Object.getPrototypeOf(o)===Object.prototype||Object.getPrototypeOf(o)===null)&&
  Reflect.ownKeys(o).every(k=>typeof k==='string'&&
    Object.hasOwn(Object.getOwnPropertyDescriptor(o,k),'value'));
const uint=n=>Number.isSafeInteger(n)&&n>=0;
const instance=o=>plain(o)&&o.unit===UNIT&&o.active===true&&
  uint(o.pid)&&o.pid>0&&INV.test(o.invocationId)&&uint(o.nRestarts);
const fail=reason=>Object.freeze({schema:'asi.autonomy-recovery-observer.v1',
  status:'BLOCKED',reason,verified:false,liveAuthority:false,
  physicalAcceptance:false,receipts:[],restartObserved:false});

function receiptIdentity(receipt) {
  if(!plain(receipt)||!ID.test(receipt.id)||!H40.test(receipt.sha)||
    receipt.kind!=='github-publisher'||receipt.status!=='PASS'||
    !uint(receipt.pr)||receipt.pr===0||!H64.test(receipt.reportSha256)||
    typeof receipt.report!=='string'||!/^[-a-z0-9_]+[-a-z0-9_.]*\.txt$/.test(receipt.report)||
    receipt.report.includes('..'))return null;
  return [receipt.id,receipt.sha,receipt.pr,receipt.report,receipt.reportSha256];
}
function validate(o) {
  if(!plain(o)||!instance(o.systemd)||!plain(o.digests)||
    !H64.test(o.digests.receipts)||!H64.test(o.digests.budget)||
    !H64.test(o.digests.routing)||!Array.isArray(o.receipts)||
    o.receipts.length>10000)return false;
  if(!plain(o.reports)||Reflect.ownKeys(o.reports).length>10000)return false;
  const seen=new Set(),names=new Set();
  for(const r of o.receipts){
    const identity=receiptIdentity(r);
    if(!identity||seen.has(r.id)||names.has(r.report))return false;
    seen.add(r.id);names.add(r.report);
  }
  return true;
}
function payload(r,reports) {
  const raw=reports[r.report];
  if(typeof raw!=='string'||Buffer.byteLength(raw)>200000||
    digest(raw)!==r.reportSha256)return null;
  try {
    const v=JSON.parse(raw);
    if(!plain(v)||!plain(v.result)||v.task!==r.id||v.sha!==r.sha||
      v.kind!==r.kind||v.pr!==r.pr||v.result.artifactType!=='GITHUB_PR_VERIFIED'||
      v.result.pr!==r.pr||!H40.test(v.result.head)||
      typeof v.result.taskBinding!=='string'||!H64.test(v.result.taskBinding))return null;
    return Object.freeze({taskId:r.id,pr:r.pr,head:v.result.head,reportSha256:r.reportSha256});
  }catch{return null;}
}
/** Compare before+after trusted file bytes AFTER a separately authorized restart. */
export function inspectEngineRestart({before,after,reportBytes}={}) {
  try {
    if(!validate(before)||!validate(after)||!plain(reportBytes))
      return fail('AUTHENTICATED_INPUT_SCHEMA_UNVERIFIED');
    if(before.receipts.length!==after.receipts.length||before.receipts.length<2)
      return fail('TWO_TERMINAL_RECEIPTS_MISSING_OR_CHANGED');
    const a=before.receipts.map(receiptIdentity);
    const b=after.receipts.map(receiptIdentity);
    if(JSON.stringify(a)!==JSON.stringify(b))
      return fail('RECEIPT_IDENTITY_OR_REPLAY_CHANGED');
    if(Object.keys(before.digests).length!==3||Object.keys(after.digests).length!==3||
      Object.keys(before.digests).some(k=>!['receipts','budget','routing'].includes(k))||
      Object.keys(after.digests).some(k=>!['receipts','budget','routing'].includes(k))||
      ['receipts','budget','routing'].some(k=>before.digests[k]!==after.digests[k]))
      return fail('PERSISTENT_RECEIPT_BUDGET_OR_ROUTING_CHANGED');
    const receipts=after.receipts.map(r=>payload(r,reportBytes));
    if(receipts.some(r=>!r))return fail('REPORT_HASH_OR_TASK_BINDING_UNVERIFIED');
    if(after.systemd.nRestarts<before.systemd.nRestarts)
      return fail('SYSTEMD_RESTART_COUNTER_REGRESSED');
    const changed=before.systemd.pid!==after.systemd.pid&&
      before.systemd.invocationId!==after.systemd.invocationId;
    if(!changed)return Object.freeze({schema:'asi.autonomy-recovery-observer.v1',
      status:'RESTART_NOT_OBSERVED',reason:'CONTROLLED_RESTART_NOT_EVIDENCED',
      verified:false,liveAuthority:false,physicalAcceptance:false,
      receipts:Object.freeze(receipts),restartObserved:false});
    return Object.freeze({schema:'asi.autonomy-recovery-observer.v1',
      status:'SOURCE_INTEGRITY_READY',reason:'REQUIRES_INDEPENDENT_HOST_ATTESTATION',
      verified:false,liveAuthority:false,physicalAcceptance:false,
      receipts:Object.freeze(receipts),restartObserved:true});
  } catch {return fail('UNREADABLE_OR_HOSTILE_EVIDENCE');}
}
const unknown=(lane,reason,status='UNKNOWN')=>Object.freeze({
  id:lane.id,branch:lane.branch,status,reason,currentTask:null,lastHeartbeat:null
});
/**
 * The existing owner dashboard may display observed records, but must not
 * label them physically VERIFIED without a separate approved native observer.
 */
export function projectObservedFiveLanes({systemd,catalog,heartbeats,nowMs}={}) {
  const blocked=reason=>Object.freeze({schema:'asi.autonomy-five-lanes.v1',
    observedOnly:true,verified:false,liveAuthority:false,
    lanes:Object.freeze(OWNER_LANES.map(l=>unknown(l,reason)))});
  try {
    if(!instance(systemd)||!uint(nowMs)||!Array.isArray(catalog)||
      !plain(heartbeats)||catalog.length>20||
      new Set(catalog.map(t=>t?.id)).size!==catalog.length)
      return blocked('HOST_INSTANCE_OR_INPUT_UNVERIFIED');
    const lanes=OWNER_LANES.map(lane=>{
      const matches=catalog.filter(t=>plain(t)&&t.repo===lane.repository&&
        t.branch===lane.branch);
      if(matches.length===0)return unknown(lane,'NOT_IN_SIGNED_CATALOG','BLOCKED');
      if(matches.length!==1||!ID.test(matches[0].id)||!H40.test(matches[0].sha))
        return unknown(lane,'CATALOG_IDENTITY_INVALID');
      const t=matches[0],h=heartbeats[lane.id];
      if(!plain(h)||!uint(h.atMs)||h.atMs>nowMs||
        nowMs-h.atMs>15*60*1000||h.pid!==systemd.pid||
        h.invocationId!==systemd.invocationId||h.taskId!==t.id||h.taskSha!==t.sha)
        return unknown(lane,'NATIVE_HEARTBEAT_MISSING_STALE_OR_FOREIGN');
      if(!['RUNNING','IDLE','BLOCKED'].includes(h.mode))
        return unknown(lane,'NATIVE_HEARTBEAT_MODE_INVALID');
      return Object.freeze({id:lane.id,branch:lane.branch,
        status:h.mode==='RUNNING'?'OBSERVED_RUNNING':h.mode==='IDLE'?'OBSERVED_IDLE':'BLOCKED',
        reason:'NEEDS_INDEPENDENT_NATIVE_WITNESS',
        currentTask:h.mode==='RUNNING'?t.id:null,lastHeartbeat:h.atMs});
    });
    return Object.freeze({schema:'asi.autonomy-five-lanes.v1',
      observedOnly:true,verified:false,liveAuthority:false,lanes:Object.freeze(lanes)});
  }catch{return blocked('UNREADABLE_OR_HOSTILE_EVIDENCE');}
}
