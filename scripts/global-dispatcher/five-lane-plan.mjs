/** Read-only universal five-lane planning for the EXISTING ASI Engine.
 * No execution, authorization, model calls, side effects or second worker.
 */
export const UNIVERSAL_LANES=Object.freeze(['planner','builder','tester','reviewer','integrator']);
const ID=/^[a-z][a-z0-9-]{0,79}$/;
const SHA=/^[a-f0-9]{40}$/;
const must=(ok,code)=>{if(!ok)throw Error(code);};
const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const unique=a=>new Set(a).size===a.length;

/** Work-order/receipt/claim inputs must be independently authenticated upstream.
 * A claim without a verified receipt remains UNKNOWN and is not replayed.
 * Native state.execute and the single Publisher serialize all external effects.
 */
export function planUniversalFiveLanes({workOrders,receipts=[],claims=[],maxParallel=5}={}){
  must(Array.isArray(workOrders)&&workOrders.length<=100&&
    Array.isArray(receipts)&&receipts.length<=1000&&
    Array.isArray(claims)&&claims.length<=1000&&
    Number.isSafeInteger(maxParallel)&&maxParallel>=1&&maxParallel<=5,
    'UNIVERSAL_PLAN_INPUT_INVALID');
  const orders=new Map();
  for(const t of workOrders){
    must(record(t)&&ID.test(t.id)&&ID.test(t.product)&&SHA.test(t.baseSha)&&
      UNIVERSAL_LANES.includes(t.lane)&&['READY','BLOCKED'].includes(t.status)&&
      Array.isArray(t.dependsOn)&&t.dependsOn.length<=20&&
      t.dependsOn.every(x=>typeof x==='string'&&ID.test(x))&&
      unique(t.dependsOn)&&!t.dependsOn.includes(t.id)&&
      Number.isSafeInteger(t.priority)&&t.priority>=0&&t.priority<=100&&
      !orders.has(t.id),'UNIVERSAL_WORK_ORDER_INVALID');
    orders.set(t.id,{...t,dependsOn:[...t.dependsOn]});
  }
  for(const t of orders.values()){
    must(t.dependsOn.every(id=>orders.has(id)&&
      orders.get(id).product===t.product),'UNIVERSAL_DEPENDENCY_OUTSIDE_PRODUCT');
  }
  // A cyclic dependency would remain WAITING forever; reject it at admission.
  const visiting=new Set(),visited=new Set();
  const check=id=>{
    if(visited.has(id))return;
    must(!visiting.has(id),'UNIVERSAL_DEPENDENCY_CYCLE');
    visiting.add(id);
    for(const dep of orders.get(id).dependsOn)check(dep);
    visiting.delete(id);
    visited.add(id);
  };
  for(const id of orders.keys())check(id);
  const verified=new Set();
  for(const r of receipts){
    must(record(r)&&ID.test(r.taskId)&&ID.test(r.product)&&
      r.status==='VERIFIED'&&SHA.test(r.baseSha),'UNIVERSAL_RECEIPT_INVALID');
    const t=orders.get(r.taskId);
    must(t&&t.product===r.product&&t.baseSha===r.baseSha&&
      !verified.has(r.taskId),'UNIVERSAL_RECEIPT_NOT_BOUND');
    verified.add(r.taskId);
  }
  const reserved=new Set();
  for(const c of claims){
    must(record(c)&&ID.test(c.taskId)&&ID.test(c.product)&&
      SHA.test(c.baseSha)&&['RESERVED','UNKNOWN','FAILED_LOCKED'].includes(c.status),
      'UNIVERSAL_CLAIM_INVALID');
    const t=orders.get(c.taskId);
    must(t&&t.product===c.product&&t.baseSha===c.baseSha&&
      !reserved.has(c.taskId),'UNIVERSAL_CLAIM_NOT_BOUND');
    reserved.add(c.taskId);
  }
  const available=[...orders.values()]
    .filter(t=>t.status==='READY'&&!verified.has(t.id)&&!reserved.has(t.id)&&
      t.dependsOn.every(id=>verified.has(id)))
    .sort((a,b)=>b.priority-a.priority||a.product.localeCompare(b.product)||a.id.localeCompare(b.id));
  const selected=[],busy=new Set();
  for(const t of available){
    if(selected.length===maxParallel)break;
    if(busy.has(t.lane))continue;
    busy.add(t.lane);
    selected.push(Object.freeze({taskId:t.id,product:t.product,lane:t.lane,baseSha:t.baseSha}));
  }
  const blocked=[...orders.values()].filter(t=>t.status==='BLOCKED'||
    reserved.has(t.id)&&!verified.has(t.id)).map(t=>Object.freeze({
      taskId:t.id,product:t.product,
      reason:reserved.has(t.id)&&!verified.has(t.id)?'PRESERVED_CLAIM_NO_REPLAY':'SOURCE_BLOCKED'
    }));
  return Object.freeze({schema:'asi.universal-five-lane-plan.v1',
    status:selected.length?'READY':'WAITING',authorized:false,execute:false,
    selected:Object.freeze(selected),blocked:Object.freeze(blocked),
    verifiedCount:verified.size,modelCalls:0,externalWrites:0});
}
