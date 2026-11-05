/**
 * Optional, source-only staging seam for the EXISTING Universal Engine.
 * No subprocess, secrets, model transport, host service, ledger, or Publisher
 * is created. The signed WD host must independently bind every admission to
 * its existing durable lock and each workspace to native isolation.
 *
 * Phase 1: SERIAL admission through a host-supplied verified native port.
 * Phase 2: up to FIVE independent preparations concurrently.
 * Publication/review/receipts remain in the existing single native Publisher.
 * A thrown or ambiguous preparation is UNKNOWN, never retried here.
 */
const ID=/^[a-z][a-z0-9-]{0,79}$/;
const H40=/^[a-f0-9]{40}$/;
const H64=/^[a-f0-9]{64}$/;
const must=(b,s)=>{if(!b)throw Error(s);};
const freeze=x=>Object.freeze(x);
function identity(slot){
  must(slot && Number.isSafeInteger(slot.slot)&&slot.slot>=1&&slot.slot<=5&&
    ID.test(slot.product||'')&&H40.test(slot.head||'')&&
    typeof slot.repository==='string'&&/^[\w.-]+\/[\w.-]+$/.test(slot.repository)&&
    slot.executable===false&&slot.authority===null&&
    slot.task&&ID.test(slot.task.id||'')&&
    typeof slot.task.stage==='string'&&typeof slot.task.operation==='string'&&
    typeof slot.task.tool==='string'&&Array.isArray(slot.task.paths)&&
    slot.task.paths.length>=1&&slot.task.paths.length<=3&&
    slot.task.paths.every(p=>typeof p==='string'&&p.length<=256&&
      !p.startsWith('/')&&!p.includes('\\')&&
      p.split('/').every(part=>part&&part!=='.'&&part!=='..')),
    'FIVE_WORKER_SLOT_INVALID');
  return freeze({slot:slot.slot,product:slot.product,repository:slot.repository,
    head:slot.head,taskId:slot.task.id,stage:slot.task.stage,
    operation:slot.task.operation,tool:slot.task.tool,
    paths:freeze([...slot.task.paths])});
}
const result=(id,status,reason)=>freeze({slot:id.slot,product:id.product,
  taskId:id.taskId,status,reason});

/** Phase-1 admission is serial; no callback from a planner is itself authority. */
export async function prepareAdmittedFiveWorkerWave({wave,admit,prepare}={}){
  must(wave&&['PLANNED','PARTIAL'].includes(wave.status)&&
    wave.executable===false&&wave.authority===null&&
    wave.publisherConcurrency===1&&Array.isArray(wave.slots)&&
    wave.slots.length>=1&&wave.slots.length<=5,
    'FIVE_WORKER_WAVE_INVALID');
  const ids=wave.slots.map(identity);
  must(ids.every((x,i)=>x.slot===i+1)&&
    new Set(ids.map(x=>x.product+':'+x.taskId)).size===ids.length,
    'FIVE_WORKER_SLOT_COLLISION');
  if(typeof admit!=='function'||typeof prepare!=='function')
    return freeze({status:'BLOCKED',reason:'SIGNED_HOST_PORTS_REQUIRED',
      publisherReady:false,results:freeze([])});
  const admitted=[],blocked=[],workspaceKeys=new Set();
  // Native admission must persist each claim under the one existing ledger.
  for(const id of ids){
    let a;
    try{a=await admit(id);}
    catch{blocked.push(result(id,'UNKNOWN','ADMISSION_OUTCOME_UNKNOWN_NO_REPLAY'));continue;}
    if(a?.verified!==true||a.taskId!==id.taskId||a.product!==id.product||
       a.head!==id.head||!ID.test(a.workspaceKey||'')||
       workspaceKeys.has(a.workspaceKey)){
      blocked.push(result(id,'BLOCKED','TASK_EXACT_NATIVE_ADMISSION_MISSING'));continue;
    }
    workspaceKeys.add(a.workspaceKey);
    admitted.push(freeze({id,workspaceKey:a.workspaceKey,token:a.token}));
  }
  // Callback executes only on host-admitted isolated workspaces; the native
  // host still has to enforce sandbox isolation and paid provider budgets.
  const prepared=await Promise.all(admitted.map(async ({id,workspaceKey,token})=>{
    try{
      const proof=await prepare(id,freeze({workspaceKey,token}));
      if(proof?.status!=='PREPARED'||proof.taskId!==id.taskId||
         proof.product!==id.product||proof.head!==id.head||
         proof.workspaceKey!==workspaceKey||!H64.test(proof.artifactSha256||''))
        return result(id,'UNKNOWN','PREPARATION_PROOF_UNVERIFIED_NO_REPLAY');
      return freeze({...result(id,'PREPARED','ISOLATED_SOURCE_CANDIDATE'),
        artifactSha256:proof.artifactSha256});
    }catch{return result(id,'UNKNOWN','PREPARATION_OUTCOME_UNKNOWN_NO_REPLAY');}
  }));
  const results=freeze([...blocked,...prepared].sort((a,b)=>a.slot-b.slot));
  return freeze({status:results.every(x=>x.status==='PREPARED')?'PREPARED':'PARTIAL',
    publisherReady:false,results});
}
