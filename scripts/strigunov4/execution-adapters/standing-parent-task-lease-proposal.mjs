/**
 * P0 #551 Worker B: source-only task/phase binding contract, NOT authority.
 *
 * Host must source `lease` exclusively from inspectStandingTransaction() inside
 * the SAME state.execute callback, and selectedTask from its native frozen task.
 * This proposal CANNOT authenticate either object or establish lock ownership.
 * Host must independently verify signatures, scope, protected-path inventory,
 * revocation, expiry and cumulative budget, then reserve/fsync through the
 * EXISTING Publisher journal before any effect. Never attach this to transport.
 */
const HEX64=/^[a-f0-9]{64}$/;
const HEX40=/^[a-f0-9]{40}$/;
const ID=/^[a-z0-9][a-z0-9-]{0,95}$/;
const STAGE='S4-G2';
const CLASSES=new Set(['stage4-source-maintenance','stage4-source-test']);
const WRITES=new Set(['create-tree','create-commit','create-branch','create-draft-pr']);
const READS=new Set(['github-read','github-compiled-read']);
const PHASES=new Set(['admission','preflight','started','postflight']);
const deny=reason=>Object.freeze({status:'PARENT_TASK_BINDING_DENIED',reason,authorized:false});
function capture(value,fields){
  try {
  if(!value||typeof value!=='object'||Array.isArray(value)||
     ![Object.prototype,null].includes(Object.getPrototypeOf(value)))return null;
  const out=Object.create(null);
  for(const key of fields){
    const d=Object.getOwnPropertyDescriptor(value,key);
    if(!d||!Object.hasOwn(d,'value'))return null;
    out[key]=d.value;
  }
  return Object.freeze(out);
  } catch { return null; }
}
function classes(value){
  try {
  if(!Array.isArray(value)||value.length<1||value.length>2)return null;
  const out=[];
  for(let i=0;i<value.length;i++){
    const d=Object.getOwnPropertyDescriptor(value,String(i));
    if(!d||!Object.hasOwn(d,'value')||!CLASSES.has(d.value)||out.includes(d.value))return null;
    out.push(d.value);
  }
  return Object.freeze(out);
  } catch { return null; }
}
const parentFields=['digest','repo','environment','target','action','stage','approvedRoutineClasses'];
const childFields=['digest','parentDigest','repo','environment','target','action','stage','approvedRoutineClasses'];
const effectFields=['taskId','taskSha','transactionId','stage','phase','kind','routineClass','requestSha256'];
const leaseFields=['transactionId','phase','kind','root','ledger','taskId','taskSha'];
const taskFields=['id','sha','stage','repo'];
const same=(a,b,keys)=>keys.every(k=>a[k]===b[k]);
const h64=v=>typeof v==='string'&&HEX64.test(v);
const h40=v=>typeof v==='string'&&HEX40.test(v);
const ident=v=>typeof v==='string'&&ID.test(v);

/** Capture the immutable source fields BEFORE async trust reads / queue delay. */
export function captureParentTaskLeaseProposal({parent,child,effect,lease,selectedTask=null,baseSha}={}){
  try {
  const p=capture(parent,parentFields),c=capture(child,childFields);
  const e=capture(effect,effectFields),l=capture(lease,leaseFields);
  const t=selectedTask===null?null:capture(selectedTask,taskFields);
  if(!p||!c||!e||!l||(selectedTask!==null&&!t))return deny('INPUT_NOT_PLAIN_DATA');
  const pc=classes(p.approvedRoutineClasses),cc=classes(c.approvedRoutineClasses);
  if(!h64(p.digest)||!h64(c.digest)||c.parentDigest!==p.digest||
     !pc||!cc||!cc.every(x=>pc.includes(x))||!cc.includes(e.routineClass)||
     p.stage!==STAGE||c.stage!==p.stage||e.stage!==p.stage||
     p.repo!=='ASI-integration/asi-landing'||p.environment!=='beget-staging'||
     p.target!=='pqukibofpo'||p.action!=='source'||
     !same(p,c,['repo','environment','target','action']))return deny('PARENT_CHILD_STAGE_OR_CLASS_SCOPE');
  if(!ident(e.taskId)||!h40(e.taskSha)||!h64(e.requestSha256)||
     !PHASES.has(e.phase)||!READS.has(e.kind)&&!WRITES.has(e.kind)||
     typeof e.transactionId!=='string'||e.transactionId.length<8||e.transactionId.length>80)
    return deny('EFFECT_SCOPE');
  if(l.transactionId!==e.transactionId||l.kind!=='github-publisher'||
     l.phase!==e.phase||typeof l.root!=='string'||!l.root.startsWith('/')||
     !l.ledger||typeof l.ledger!=='object'||
     l.ledger.mode!=='FAILED_LOCKED'||l.ledger.reason!=='IN_FLIGHT_OR_CRASHED')
    return deny('NATIVE_LEASE_CONTEXT_MISMATCH');
  const write=WRITES.has(e.kind);
  if(write&&e.phase!=='started')return deny('WRITE_BEFORE_STARTED');
  if(e.phase==='admission'){
    if(t||l.taskId!==null||l.taskSha!==null||!h40(baseSha)||
       e.taskId!==`admission-${e.transactionId}`||e.taskSha!==baseSha||write)
      return deny('PRETASK_ADMISSION_NOT_BOUND');
  } else if(!t||t.stage!==STAGE||t.repo!==p.repo||
            l.taskId!==t.id||l.taskSha!==t.sha||
            e.taskId!==t.id||e.taskSha!==t.sha)
    return deny('SELECTED_TASK_MISMATCH');
  // This closure stores copied primitive fields, never original mutable args.
  // The journal reference is compared by identity; only the native host can
  // prove that it is the actual lock owner's armed ledger.
  return Object.freeze({status:'PARENT_TASK_SOURCE_SNAPSHOT',authorized:false,
    assessAfter({lease:afterLease,selectedTask:afterTask=null,effect:afterEffect}={}){
      try {
      const a=capture(afterLease,leaseFields),e2=capture(afterEffect,effectFields);
      const t2=afterTask===null?null:capture(afterTask,taskFields);
      if(!a||!e2||(afterTask!==null&&!t2))return deny('POST_AWAIT_INPUT_INVALID');
      if(!same(e,e2,effectFields)||!same(l,a,leaseFields)||
         a.ledger.mode!=='FAILED_LOCKED'||a.ledger.reason!=='IN_FLIGHT_OR_CRASHED'||
         (t===null?t2!==null:!t2||!same(t,t2,taskFields)))
        return deny('POST_AWAIT_LEASE_OR_TASK_CHANGED');
      return Object.freeze({status:'PARENT_TASK_SOURCE_ELIGIBLE',authorized:false,
        stage:p.stage,transactionId:e.transactionId,taskId:e.taskId,
        phase:e.phase,kind:e.kind,routineClass:e.routineClass});
      } catch { return deny('POST_AWAIT_INPUT_INVALID'); }
    }
  });
  } catch { return deny('INPUT_NOT_PLAIN_DATA'); }
}
