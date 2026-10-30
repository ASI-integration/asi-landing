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
import {createHash} from 'node:crypto';
const SHA = v => createHash('sha256').update(v).digest('hex');
const WIRE_ROUTE=/^[A-Za-z0-9_/?=&:%.-]{1,512}$/;
const WRITE_ROUTES=Object.freeze({'create-tree':'git/trees','create-commit':'git/commits',
  'create-branch':'git/refs','create-draft-pr':'pulls'});
const YEAR_MS=365*86400000, CHILD_MS=14*86400000;
const HEX64=/^[a-f0-9]{64}$/;
const HEX40=/^[a-f0-9]{40}$/;
const ID=/^[a-z0-9][a-z0-9-]{0,95}$/;
const STAGE='S4-G2';
const CLASSES=new Set(['stage4-source-maintenance','stage4-source-test']);
const WRITES=new Set(['create-tree','create-commit','create-branch','create-draft-pr']);
const READS=new Set(['github-read']);
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
// Capture bounds and policy identity as well as stage/classes: changing any
// of them during awaits must invalidate the advisory result. Source-only values
// remain untrusted until the existing protected verifier authenticates them.
const parentFields=['digest','repo','environment','target','action','stage','approvedRoutineClasses',
  'securityDigest','policyDigest','notBefore','expiresAt','paidApiUsd','maxOperations','maxRequests','maxWrites'];
const childFields=['digest','parentDigest','repo','environment','target','action','stage','approvedRoutineClasses',
  'securityDigest','policyDigest','notBefore','expiresAt','paidApiUsd','maxOperations','maxRequests','maxWrites'];
const effectFields=['taskId','taskSha','transactionId','stage','phase','kind','routineClass',
  'headSha','method','route','payloadSha256','requestSha256'];
const leaseFields=['transactionId','phase','kind','root','ledger','taskId','taskSha'];
const taskFields=['id','sha','stage','repo'];
const same=(a,b,keys)=>keys.every(k=>a[k]===b[k]);
const h64=v=>typeof v==='string'&&HEX64.test(v);
const h40=v=>typeof v==='string'&&HEX40.test(v);
const ident=v=>typeof v==='string'&&ID.test(v);
const sameClasses=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&
  a.length===b.length&&a.every((v,i)=>v===b[i]);
const windowOK=(x,max)=>Number.isSafeInteger(x.notBefore)&&Number.isSafeInteger(x.expiresAt)&&
  x.notBefore>=0&&x.expiresAt>x.notBefore&&x.expiresAt-x.notBefore<=max;
const capsOK=x=>Number.isSafeInteger(x.maxOperations)&&x.maxOperations>0&&x.maxOperations<=256&&
  Number.isSafeInteger(x.maxRequests)&&x.maxRequests>0&&x.maxRequests<=256&&
  Number.isSafeInteger(x.maxWrites)&&x.maxWrites>0&&x.maxWrites<=64&&
  x.maxWrites<=x.maxRequests&&x.maxWrites<=x.maxOperations;
function readProtocolOf(effect){
  if(!effect||typeof effect!=='object')return {invalid:true};
  const d=Object.getOwnPropertyDescriptor(effect,'readProtocol');
  return d&&!Object.hasOwn(d,'value')?{invalid:true}:{invalid:false,value:d?.value};
}
function validWire(e,readProtocol){
  if(!h40(e.headSha)||!h64(e.payloadSha256)||!h64(e.requestSha256)||
     typeof e.route!=='string'||!WIRE_ROUTE.test(e.route)||
     e.route.startsWith('/')||e.route.includes('..'))return false;
  const read=READS.has(e.kind),compiled=read&&readProtocol==='compiled-threads';
  if(compiled){if(e.method!=='POST'||e.route!=='graphql')return false;}
  else if(readProtocol!==undefined||e.method!==(read?'GET':'POST')||
          (read?e.payloadSha256!==SHA(''):WRITE_ROUTES[e.kind]!==e.route))return false;
  return e.requestSha256===SHA(JSON.stringify({method:e.method,route:e.route,
    payloadSha256:e.payloadSha256}));
}

/** Capture the immutable source fields BEFORE async trust reads / queue delay. */
export function captureParentTaskLeaseProposal({parent,child,effect,lease,selectedTask=null,baseSha}={}){
  try {
  const p=capture(parent,parentFields),c=capture(child,childFields);
  const e=capture(effect,effectFields),l=capture(lease,leaseFields);
  const protocol=readProtocolOf(effect);
  const t=selectedTask===null?null:capture(selectedTask,taskFields);
  if(!p||!c||!e||!l||protocol.invalid||(selectedTask!==null&&!t))
    return deny('INPUT_NOT_PLAIN_DATA');
  const pc=classes(p.approvedRoutineClasses),cc=classes(c.approvedRoutineClasses);
  if(!h64(p.digest)||!h64(c.digest)||c.parentDigest!==p.digest||
     !pc||!cc||!cc.every(x=>pc.includes(x))||!cc.includes(e.routineClass)||
     p.stage!==STAGE||c.stage!==p.stage||e.stage!==p.stage||
     p.repo!=='ASI-integration/asi-landing'||p.environment!=='beget-staging'||
     p.target!=='pqukibofpo'||p.action!=='source'||
     !h64(p.securityDigest)||!h64(p.policyDigest)||p.paidApiUsd!==0||c.paidApiUsd!==0||
     !same(p,c,['repo','environment','target','action','securityDigest','policyDigest'])||
     !windowOK(p,YEAR_MS)||!windowOK(c,CHILD_MS)||
     c.notBefore<p.notBefore||c.expiresAt>p.expiresAt||!capsOK(p)||!capsOK(c)||
     c.maxOperations>p.maxOperations||c.maxRequests>p.maxRequests||c.maxWrites>p.maxWrites)
    return deny('PARENT_CHILD_STAGE_OR_CLASS_SCOPE');
  if(!ident(e.taskId)||!h40(e.taskSha)||!h64(e.requestSha256)||
     !PHASES.has(e.phase)||(!READS.has(e.kind)&&!WRITES.has(e.kind))||
     !validWire(e,protocol.value)||
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
  // The native protected-base SHA must match the task anchor even before
  // STARTED. This pure check does not authenticate the host-supplied SHA.
  if(!h40(baseSha)||baseSha!==e.taskSha)return deny('TASK_BASE_SHA_MISMATCH');
  // This closure stores copied primitive fields, never original mutable args.
  // The journal reference is compared by identity; only the native host can
  // prove that it is the actual lock owner's armed ledger.
  return Object.freeze({status:'PARENT_TASK_SOURCE_SNAPSHOT',authorized:false,
    assessAfter({lease:afterLease,selectedTask:afterTask=null,effect:afterEffect,baseSha:afterBaseSha}={}){
      try {
      const a=capture(afterLease,leaseFields),e2=capture(afterEffect,effectFields);
      const p2=capture(parent,parentFields),c2=capture(child,childFields);
      const protocol2=readProtocolOf(afterEffect);
      const t2=afterTask===null?null:capture(afterTask,taskFields);
      if(!a||!e2||!p2||!c2||protocol2.invalid||(afterTask!==null&&!t2))
        return deny('POST_AWAIT_INPUT_INVALID');
      if(!same(p,p2,parentFields.filter(k=>k!=='approvedRoutineClasses'))||
         !same(c,c2,childFields.filter(k=>k!=='approvedRoutineClasses'))||
         !sameClasses(pc,classes(p2.approvedRoutineClasses))||
         !sameClasses(cc,classes(c2.approvedRoutineClasses)))
        return deny('POST_AWAIT_PARENT_CHILD_CHANGED');
      if(!same(e,e2,effectFields)||protocol.value!==protocol2.value||
         !validWire(e2,protocol2.value)||!same(l,a,leaseFields)||
         a.ledger.mode!=='FAILED_LOCKED'||a.ledger.reason!=='IN_FLIGHT_OR_CRASHED'||
         (t===null?t2!==null:!t2||!same(t,t2,taskFields)))
        return deny('POST_AWAIT_LEASE_OR_TASK_CHANGED');
      // Re-read from authenticated native task/base evidence AFTER awaits.
      // Missing or shifted base SHA is not a valid continuation token.
      if(afterBaseSha!==baseSha)return deny('POST_AWAIT_BASE_SHA_CHANGED');
      return Object.freeze({status:'PARENT_TASK_SOURCE_ELIGIBLE',authorized:false,
        stage:p.stage,transactionId:e.transactionId,taskId:e.taskId,
        phase:e.phase,kind:e.kind,routineClass:e.routineClass});
      } catch { return deny('POST_AWAIT_INPUT_INVALID'); }
    }
  });
  } catch { return deny('INPUT_NOT_PLAIN_DATA'); }
}
