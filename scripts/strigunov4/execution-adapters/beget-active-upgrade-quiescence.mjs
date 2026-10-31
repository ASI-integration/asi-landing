/**
 * Read-only native state continuity witness for the ONE existing Engine.
 * All snapshots must be independently authenticated by a service-UID/root
 * observer. No signer, new durable ledger, root action, stop or install port.
 * Every output remains authorized:false and readyForStop:false.
 */
import {createHash} from 'node:crypto';
const HEX40=/^[a-f0-9]{40}$/, HEX64=/^[a-f0-9]{64}$/;
const ID=/^[a-z0-9][a-z0-9-]{0,95}$/;
const hash=s=>createHash('sha256').update(s).digest('hex');
const own=o=>o!==null&&typeof o==='object'&&!Array.isArray(o)&&
  (Object.getPrototypeOf(o)===Object.prototype||Object.getPrototypeOf(o)===null)&&
  Reflect.ownKeys(o).every(k=>typeof k==='string'&&
    Object.hasOwn(Object.getOwnPropertyDescriptor(o,k),'value'));
const uint=n=>Number.isSafeInteger(n)&&n>=0;
const denied=reason=>Object.freeze({
  schema:'asi.beget-active-upgrade-quiescence.v1',status:'BLOCKED',reason,
  authorized:false,installable:false,readyForStop:false
});
const dense=a=>Array.isArray(a)&&a.length<=10000&&
  Reflect.ownKeys(a).length===a.length+1&&a.every((_,i)=>
    Object.hasOwn(Object.getOwnPropertyDescriptor(a,String(i))||{},'value'));
function decode(item){
  if(!own(item)||typeof item.bytes!=='string'||!HEX64.test(item.sha256)||
     Buffer.byteLength(item.bytes)>500000||hash(item.bytes)!==item.sha256)return null;
  try {const x=JSON.parse(item.bytes);return own(x)?x:null;}catch{return null;}
}
function single(s){
  if(!own(s)||!own(s.instance)||s.instance.host!=='pqukibofpo'||
    s.instance.unit!=='asi-strigunov-agent.service'||
    s.instance.active!==true||s.instance.enabled!==true||
    !Number.isSafeInteger(s.instance.pid)||s.instance.pid<=0||
    typeof s.instance.invocationId!=='string'||
    !/^[a-f0-9]{32}$/.test(s.instance.invocationId)||
    !uint(s.instance.nRestarts)||!HEX64.test(s.instance.manifestSha256)||
    !HEX40.test(s.instance.sourceSha)||!uint(s.capturedAtMs)||
    s.executionLockPresent!==false||!own(s.files)||
    !HEX64.test(s.files.routingSha256)||!dense(s.publications)||
    !dense(s.reports))return denied('HOST_OR_NATIVE_LOCK_UNVERIFIED');
  const ledger=decode(s.files.ledger),receipts=decode(s.files.receipts),
    heartbeat=decode(s.files.heartbeat),budget=decode(s.files.apiBudget);
  if(!ledger||!receipts||!heartbeat||!budget)
    return denied('DURABLE_STATE_BYTES_UNVERIFIED');
  if(ledger.schemaVersion!=='asi.execution-adapters.v1'||
     ledger.mode!=='IDLE'||Object.hasOwn(ledger,'reason')||
     !own(ledger.jobs)||receipts.version!==1||!dense(receipts.completed)||
     !['WAITING','REPORT_READY'].includes(heartbeat.mode))
    return denied('UNKNOWN_OR_IN_FLIGHT_ENGINE_STATE');
  const jobs=Object.entries(ledger.jobs),seen=new Set(),reports=new Set();
  for(const [id,job] of jobs){
    if(!ID.test(id)||!own(job)||job.mode!=='PUBLISHED'||
       job.kind!=='github-publisher'||!HEX40.test(job.sha)||
       !HEX64.test(job.reportSha256)||typeof job.report!=='string')
      return denied('UNSETTLED_OR_CORRUPT_JOB');
    seen.add(id);
  }
  for(const r of receipts.completed){
    if(!own(r)||!ID.test(r.id)||!HEX40.test(r.sha)||
       r.status!=='PASS'||r.kind!=='github-publisher'||
       !HEX64.test(r.reportSha256)||typeof r.report!=='string'||
       !seen.has(r.id)||reports.has(r.report))
      return denied('UNSETTLED_OR_UNKNOWN_RECEIPT');
    const job=ledger.jobs[r.id];
    if(job.sha!==r.sha||job.pr!==r.pr||job.report!==r.report||
       job.reportSha256!==r.reportSha256)
      return denied('RECEIPT_LEDGER_MISMATCH');
    reports.add(r.report);
  }
  if(jobs.length!==receipts.completed.length||s.reports.length!==reports.size)
    return denied('REPORT_SET_INCOMPLETE');
  const uniqueReports=new Set();
  for(const r of s.reports){
    if(!own(r)||typeof r.name!=='string'||!reports.has(r.name)||
       uniqueReports.has(r.name)||typeof r.bytes!=='string'||
       !HEX64.test(r.sha256)||hash(r.bytes)!==r.sha256||
       receipts.completed.find(t=>t.report===r.name)?.reportSha256!==r.sha256)
      return denied('REPORT_HASH_OR_IDENTITY_CHANGED');
    uniqueReports.add(r.name);
  }
  // A WAITING/INTENT journal may contain a remote GitHub action with no
  // confirmed result. Never count it as safely settled before upgrade.
  if(s.publications.length!==jobs.length)
    return denied('PUBLICATION_JOURNAL_INCOMPLETE');
  const pubs=new Set();
  for(const p of s.publications){
    if(!own(p)||!ID.test(p.taskId)||pubs.has(p.taskId)||
       p.name!=='publication-'+p.taskId+'.json'||!seen.has(p.taskId))
      return denied('PUBLICATION_FILE_IDENTITY');
    const v=decode(p),r=receipts.completed.find(t=>t.id===p.taskId);
    if(!v||v.version!==1||v.phase!=='VERIFIED'||!r||
       v.kind!==r.kind||v.baseSha!==r.sha||
       !HEX64.test(v.taskBinding))
      return denied('REMOTE_PUBLICATION_OUTCOME_UNKNOWN');
    pubs.add(p.taskId);
  }
  if(!uint(budget.requests)||!uint(budget.mutations))
    return denied('CUMULATIVE_BUDGET_INVALID');
  return Object.freeze({schema:'asi.beget-active-upgrade-quiescence.v1',
    status:'SOURCE_QUIESCENCE_CANDIDATE',authorized:false,installable:false,
    readyForStop:false,pid:s.instance.pid,invocationId:s.instance.invocationId,
    receipts:receipts.completed.length,
    digests:Object.freeze({
      ledger:s.files.ledger.sha256,receipts:s.files.receipts.sha256,
      heartbeat:s.files.heartbeat.sha256,budget:s.files.apiBudget.sha256,
      routing:s.files.routingSha256,
      publications:hash(JSON.stringify(s.publications.map(p=>[p.name,p.sha256]))),
      reports:hash(JSON.stringify(s.reports.map(p=>[p.name,p.sha256])))
    })});
}
/**
 * Two consistent native snapshots still don't prove that nothing will start
 * afterward. A future signed root operator MUST hold the existing execution
 * lock and independently verify remote Publisher actions before any stop.
 */
export function inspectUpgradeQuiescence({before,after,nowMs}={}){
  try{
    if(!uint(nowMs))return denied('CLOCK_INVALID');
    const a=single(before),b=single(after);
    if(a.status!=='SOURCE_QUIESCENCE_CANDIDATE')return a;
    if(b.status!=='SOURCE_QUIESCENCE_CANDIDATE')return b;
    if(after.capturedAtMs<=before.capturedAtMs||
      after.capturedAtMs-before.capturedAtMs<1000||
      after.capturedAtMs-before.capturedAtMs>60000||
      after.capturedAtMs>nowMs||nowMs-after.capturedAtMs>60000)
      return denied('NATIVE_CAPTURE_FRESHNESS_INVALID');
    for(const key of ['pid','invocationId'])
      if(a[key]!==b[key])return denied('PROCESS_CHANGED_BETWEEN_CAPTURES');
    for(const key of ['nRestarts','manifestSha256','sourceSha'])
      if(before.instance[key]!==after.instance[key])
        return denied('GENERATION_CHANGED_BETWEEN_CAPTURES');
    if(JSON.stringify(a.digests)!==JSON.stringify(b.digests))
      return denied('DURABLE_STATE_MOVED_DURING_CAPTURE');
    return Object.freeze({schema:'asi.beget-active-upgrade-quiescence.v1',
      status:'SOURCE_QUIESCENCE_CANDIDATE',
      reason:'NATIVE_LOCK_AND_REMOTE_RECONCILIATION_STILL_REQUIRED',
      authorized:false,installable:false,readyForStop:false,
      observedInvocationId:a.invocationId,
      observedManifestSha256:before.instance.manifestSha256,
      stateDigests:a.digests,receiptCount:a.receipts});
  }catch{return denied('UNREADABLE_OR_HOSTILE_SNAPSHOT');}
}
