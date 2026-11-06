/**
 * Pure, product-neutral routing adapter for the EXISTING ASI Global Dispatcher.
 * Registration describes a bounded work catalog; no credentials, executors,
 * queues, models, publication ports, or authorization are created here.
 * The native host must attest the snapshot and individually admit each task.
 */
import {createHash} from 'node:crypto';
const SHA=x=>createHash('sha256').update(x).digest('hex');
const ID=/^[a-z][a-z0-9-]{0,79}$/;
const SHA40=/^[a-f0-9]{40}$/;
const SHA64=/^[a-f0-9]{64}$/;
const REPO=/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const allowedPath=x=>typeof x==='string'&&x.length<=256&&x.length>0&&
  !x.startsWith('/')&&!x.includes('\\')&&
  x.split('/').every(s=>s&&s!=='.'&&s!=='..'&&s.toLowerCase()!=='.git');
const must=(condition,code)=>{if(!condition)throw Error(code);};

export function createUniversalProductRoute({id,repository,head,contractHash,
  stage,workOrders,maxPlansPerStage=5}={}){
  must(typeof id==='string'&&ID.test(id)&&typeof repository==='string'&&REPO.test(repository)&&
    typeof head==='string'&&SHA40.test(head)&&
    typeof contractHash==='string'&&SHA64.test(contractHash)&&typeof stage==='string'&&stage.length>0&&stage.length<=80&&
    Number.isSafeInteger(maxPlansPerStage)&&maxPlansPerStage>=1&&maxPlansPerStage<=10&&
    Array.isArray(workOrders)&&workOrders.length>=1&&workOrders.length<=10,
    'PRODUCT_ROUTE_CONTRACT_INVALID');
  const seen=new Set();
  const approved=workOrders.map(w=>{
    must(w&&typeof w.id==='string'&&ID.test(w.id)&&!seen.has(w.id)&&
      w.operation==='prepare-source'&&w.tool==='existing-runner-bridge'&&
      Number.isSafeInteger(w.priority)&&w.priority>=0&&w.priority<=100&&
      Array.isArray(w.paths)&&w.paths.length>=1&&w.paths.length<=3&&
      w.paths.every(allowedPath)&&new Set(w.paths).size===w.paths.length,
      'PRODUCT_ROUTE_WORK_ORDER_INVALID');
    seen.add(w.id);
    return Object.freeze({id:w.id,operation:w.operation,tool:w.tool,
      priority:w.priority,paths:Object.freeze([...w.paths])});
  });
  Object.freeze(approved);
  // Bind the owner's external contract pin to the EXACT product work catalog.
  // A different catalog under the same external hash cannot be silently
  // accepted by the existing durable Global Dispatcher after restart.
  const pinnedContractHash=SHA(JSON.stringify({id,repository,head,stage,
    externalContractHash:contractHash,maxPlansPerStage,workOrders:approved}));
  return Object.freeze({
    id,contractHash:pinnedContractHash,
    contract:Object.freeze({execution:'disabled',maxAttemptsPerTask:1,maxPlansPerStage}),
    evaluate(snapshot){
      const same=snapshot&&snapshot.product===id&&
        snapshot.contractHash===pinnedContractHash&&
        snapshot.repository===repository&&snapshot.head===head&&
        snapshot.status==='READY';
      return Object.freeze({
        status:same?'READY':'BLOCKED',nextAction:same?
          'Await independent task-specific signed host admission':
          'Product snapshot is not at its exact approved repository, base, or status',
        stage,head,repository,acceptedStages:Object.freeze([]),terminal:Object.freeze([]),
        candidates:same?approved:Object.freeze([])
      });
    }
  });
}
