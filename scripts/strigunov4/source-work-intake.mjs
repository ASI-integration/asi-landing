/**
 * ASI Step 3: source-only intake from an approved task catalog to a proposed
 * code delta. No direct GitHub port, network request, secret, shell, timer,
 * model provider, scheduler, runtime admission or write side effects.
 *
 * The existing protected host must independently authenticate the signed
 * catalog, lease, provider, source base and allowed paths. A successful
 * candidate here NEVER authorizes Publisher, protected merge or deployment.
 */
import {createHash} from 'node:crypto';

const REPO='ASI-integration/asi-landing';
const SHA40=/^[a-f0-9]{40}$/;
const SHA64=/^[a-f0-9]{64}$/;
const ID=/^[a-z0-9][a-z0-9-]{0,79}$/;
const MAX_FILES=3, MAX_BYTES=128*1024, MAX_TASK_BYTES=240*1024;
const SUFFIX=/\.(?:mjs|js|ts|tsx|json|py)$/;
const LANES=Object.freeze([
  ['engine','asi/beget-one-engine-20261028'],
  ['ru-auth','feat/ru-unified-auth-20261029'],
  ['p0-integration','asi/standing-delegation-551'],
  ['p0-trust','asi/p0-trusted-evidence-worker-20261029'],
  ['p0-atomic-budget','asi/p0-atomic-budget-worker-20261029'],
]);
export const SOURCE_LANES=Object.freeze(LANES.map(([id,branch])=>Object.freeze({id,branch,repository:REPO})));
const sum=x=>createHash('sha256').update(x).digest('hex');
const refuse=reason=>Object.freeze({schema:'asi.source-intake-result.v1',
  status:'BLOCKED',reason,authorized:false,candidate:null});
// Own fields only, no accessor, Symbol or prototype injection.
const data=(x,required)=>{
  if(x===null||typeof x!=='object'||Array.isArray(x))return false;
  try{
    const proto=Object.getPrototypeOf(x);
    if(proto!==Object.prototype&&proto!==null)return false;
    if(!Reflect.ownKeys(x).every(k=>typeof k==='string'&&
      Object.hasOwn(Object.getOwnPropertyDescriptor(x,k),'value')))return false;
    return required.every(k=>Object.hasOwn(x,k));
  }catch{return false;}
};
const safePath=p=>{
  if(typeof p!=='string'||p.length>180||!SUFFIX.test(p)||
    !/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(p))return false;
  const segments=p.split('/');
  return segments.every(s=>s!=='.'&&s!=='..'&&s.toLowerCase()!=='.git');
};
const dense=(items,min,max)=>{
  if(!Array.isArray(items)||Object.getPrototypeOf(items)!==Array.prototype||
    items.length<min||items.length>max)return false;
  const keys=Reflect.ownKeys(items);
  if(keys.length!==items.length+1)return false;
  for(let i=0;i<items.length;i++){
    const desc=Object.getOwnPropertyDescriptor(items,String(i));
    if(!desc||!Object.hasOwn(desc,'value')||!desc.enumerable)return false;
  }
  return true;
};
const exactScope=(items)=>{
  if(!dense(items,1,MAX_FILES))return false;
  const names=new Set();
  for(const c of items){
    if(!data(c,['path','beforeSha256'])||!safePath(c.path)||
      (c.beforeSha256!==null&&!SHA64.test(c.beforeSha256))||names.has(c.path))return false;
    for(const old of names)if(old.startsWith(c.path+'/')||c.path.startsWith(old+'/'))return false;
    names.add(c.path);
  }
  return true;
};
const acceptableTask=(t)=>{
  if(!data(t,['id','laneId','repo','branch','baseSha','stage','kind','files'])||
    !ID.test(t.id)||!SHA40.test(t.baseSha)||t.repo!==REPO||
    t.stage!=='S4-G2'||t.kind!=='source-proposal'||!exactScope(t.files))return false;
  return LANES.some(([id,branch])=>t.laneId===id&&t.branch===branch);
};
const matching=(a,b)=>{
  if(!acceptableTask(a)||!acceptableTask(b))return false;
  return a.id===b.id&&a.laneId===b.laneId&&a.repo===b.repo&&a.branch===b.branch&&
    a.baseSha===b.baseSha&&a.stage===b.stage&&a.kind===b.kind&&
    JSON.stringify(a.files)===JSON.stringify(b.files);
};
/** Validate exact work-order identity only; this never verifies a signature. */
export function inspectSourceIntake({task,admittedTasks}={}){
  if(!acceptableTask(task))return refuse('TASK_SCHEMA_OR_FIXED_LANE_INVALID');
  if(!dense(admittedTasks,1,20)||
    !admittedTasks.every(acceptableTask)||new Set(admittedTasks.map(t=>t.id)).size!==admittedTasks.length)
    return refuse('SIGNED_TASK_SOURCE_NOT_VERIFIED');
  const hits=admittedTasks.filter(t=>t.id===task.id);
  if(hits.length!==1||!matching(task,hits[0]))return refuse('TASK_NOT_IN_EXACT_ADMITTED_CATALOG');
  const taskBinding=sum(JSON.stringify({
    id:task.id,laneId:task.laneId,repo:task.repo,branch:task.branch,
    baseSha:task.baseSha,stage:task.stage,files:task.files
  }));
  return Object.freeze({schema:'asi.source-intake-result.v1',status:'SOURCE_CANDIDATE',
    reason:'REQUIRES_NATIVE_SIGNED_ADMISSION',authorized:false,taskBinding,
    candidate:Object.freeze({id:task.id,laneId:task.laneId,baseSha:task.baseSha,
      branch:task.branch,paths:Object.freeze(task.files.map(c=>c.path))})});
}
/**
 * One opaque provider invocation for proposed source bytes. No model/vendor
 * is selected here; an independently admitted isolated host owns the port.
 * Caller-provided producer is never a verified service or a signed lease.
 */
export async function proposeSourceWork({task,admittedTasks,produce}={}){
  const admission=inspectSourceIntake({task,admittedTasks});
  if(admission.status!=='SOURCE_CANDIDATE')return admission;
  if(typeof produce!=='function')return refuse('SOURCE_PRODUCER_NOT_CONFIGURED');
  let output;
  try{
    // Never allow producer access to authority files, secrets or host APIs.
    output=await produce(Object.freeze({id:task.id,laneId:task.laneId,
      baseSha:task.baseSha,repository:REPO,branch:task.branch,
      paths:Object.freeze(task.files.map(x=>x.path))}));
  }catch{return refuse('PRODUCER_FAILED_OR_UNKNOWN');}
  if(!data(output,['status','changes'])||output.status!=='PROPOSED'||
    !dense(output.changes,task.files.length,task.files.length))
    return refuse('PRODUCER_OUTPUT_NOT_VERIFIED');
  const proposed=[];let total=0;
  for(let i=0;i<task.files.length;i++){
    const source=task.files[i],c=output.changes[i];
    if(!data(c,['path','beforeSha256','content'])||c.path!==source.path||
      c.beforeSha256!==source.beforeSha256||typeof c.content!=='string')
      return refuse('PRODUCER_ESCAPED_TASK_SCOPE');
    const bytes=Buffer.byteLength(c.content,'utf8');
    total+=bytes;
    if(bytes<1||bytes>MAX_BYTES||total>MAX_TASK_BYTES||c.content.includes('\0'))
      return refuse('PRODUCER_BYTES_OUT_OF_BOUNDS');
    proposed.push(Object.freeze({path:c.path,beforeSha256:c.beforeSha256,
      content:c.content,afterSha256:sum(c.content)}));
  }
  const changeDigest=sum(JSON.stringify(proposed.map(({path,beforeSha256,afterSha256})=>
    ({path,beforeSha256,afterSha256}))));
  return Object.freeze({schema:'asi.source-intake-result.v1',
    status:'PROPOSAL_PREPARED',reason:'NEEDS_PROTECTED_PREPARER_TEST_CI_REVIEW_AND_SIGNED_PUBLISHER',
    authorized:false,taskBinding:admission.taskBinding,
    candidate:Object.freeze({id:task.id,laneId:task.laneId,baseSha:task.baseSha,
      branch:task.branch,changeDigest,
      changes:Object.freeze(proposed)})});
}
