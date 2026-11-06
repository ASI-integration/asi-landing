/**
 * Five-worker planning facade for the existing ASI Global Dispatcher.
 * Plans at most five source-only tasks through the EXISTING durable
 * routing journal and lock. No second engine, executor, writer, service,
 * process, credential, paid call or publication permission.
 *
 * Calls to dispatcher.plan are SERIAL: reservations must be durable
 * before independent isolated preparation can be admitted by the host.
 */
const id=/^[a-z][a-z0-9-]{0,79}$/;
const sha=/^[a-f0-9]{40}$/;
const validPath=p=>typeof p==='string'&&p.length>=1&&p.length<=256&&
  !p.startsWith('/')&&!p.includes('\\')&&
  p.split('/').every(x=>x&&x!=='.'&&x!=='..'&&x.toLowerCase()!=='.git');
const validPaths=paths=>Array.isArray(paths)&&paths.length>=1&&paths.length<=3&&
  paths.every(validPath)&&new Set(paths).size===paths.length;
const blocked=(status,slots,reason)=>Object.freeze({
  status,slots:Object.freeze([...slots]),executable:false,authority:null,
  publisherConcurrency:1,reason
});

export async function planFiveWorkerWave({dispatcher,snapshots,maxWorkers=5}={}){
  if(!dispatcher||typeof dispatcher.plan!=='function'||
     !Number.isSafeInteger(maxWorkers)||maxWorkers<1||maxWorkers>5||
     !snapshots||typeof snapshots!=='object'||Array.isArray(snapshots))
    throw Error('FIVE_WORKER_PLANNING_CONFIGURATION');
  const slots=[],seen=new Set();
  for(let index=0;index<maxWorkers;index++){
    let result;
    try{result=await dispatcher.plan(snapshots);}
    catch{return blocked('FAILED_LOCKED',slots,'ROUTING_PLAN_UNVERIFIED');}
    if(!result||!['READY','WAITING','BLOCKED','FAILED_LOCKED','ACCEPTED'].includes(result.status))
      return blocked('FAILED_LOCKED',slots,'ROUTING_RESULT_UNVERIFIED');
    if(result.selected===null){
      if(result.status==='FAILED_LOCKED')
        return blocked('FAILED_LOCKED',slots,'ROUTING_FAILED_LOCKED');
      return blocked(slots.length?'PARTIAL':'IDLE',slots,
        'NO_MORE_INDEPENDENT_DURABLY_ADMITTED_WORK');
    }
    const s=result.selected;
    if(result.status!=='READY'||s?.executable!==false||s?.authority!==null||
       typeof s.product!=='string'||!id.test(s.product)||
       typeof s.task?.id!=='string'||!id.test(s.task.id)||
       typeof s.repository!=='string'||typeof s.head!=='string'||
       !sha.test(s.head)||
       !validPaths(s.task?.paths))
      return blocked('FAILED_LOCKED',slots,'ROUTING_SELECTION_UNVERIFIED');
    const key=s.product+':'+s.task.id;
    if(seen.has(key))return blocked('FAILED_LOCKED',slots,'DUPLICATE_DURABLE_RESERVATION');
    seen.add(key);
    // An assignment is NOT an authorization. The host must apply a
    // task-exact signed admission before running any worker slot.
    slots.push(Object.freeze({slot:index+1,product:s.product,
      repository:s.repository,head:s.head,
      task:Object.freeze({id:s.task.id,stage:s.task.stage,
        operation:s.task.operation,tool:s.task.tool,
        paths:Object.freeze([...s.task.paths])}),
      executable:false,authority:null}));
  }
  return blocked('PLANNED',slots,'AWAIT_INDEPENDENT_TASK_EXACT_EXECUTION_ADMISSION');
}
