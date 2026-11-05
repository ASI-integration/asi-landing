/**
 * Source-only bridge to the ONE existing native Publisher.
 * It does NOT instantiate a Publisher, acquire credentials, publish to GitHub,
 * or create a receipt/ledger. The authenticated WD host supplies every port.
 * Each publication call MUST use its existing state.execute transaction.
 */
const ID=/^[a-z][a-z0-9-]{0,79}$/;
const SHA40=/^[a-f0-9]{40}$/;
const SHA64=/^[a-f0-9]{64}$/;
const REPO=/^[\w.-]+\/[\w.-]+$/;
const must=(ok,code)=>{if(!ok)throw Error(code);};
const wrap=x=>Object.freeze(x);
const summary=(r,status,reason,proof)=>wrap({
  taskId:r.taskId,product:r.product,repository:r.repository,baseSha:r.baseSha,
  status,reason,...(proof?{pr:proof.pr,head:proof.head}:{})
});
async function bounded(port,ms){
  const ctrl=new AbortController();
  let timer;
  try{
    return await Promise.race([
      Promise.resolve().then(()=>port(ctrl.signal)),
      new Promise((_,reject)=>{timer=setTimeout(()=>{
        ctrl.abort();reject(Error('NATIVE_PUBLISH_DEADLINE'));
      },ms);})
    ]);
  }finally{clearTimeout(timer);}
}
const isTimeout=e=>e?.message==='NATIVE_PUBLISH_DEADLINE';

/** Read-only inputs are untrusted until verified by the NATIVE host ports.
 * publishOne is the EXISTING serialized Publisher effect, not another writer.
 */
export async function handoffToSingleNativePublisher({
  preparation,verifyPrepared,publishOne,verifyReceipt,timeoutMs=60000
}={}){
  must(preparation&&['PREPARED','PARTIAL'].includes(preparation.status)&&
    preparation.publisherReady===false&&Array.isArray(preparation.results)&&
    preparation.results.length>=1&&preparation.results.length<=5&&
    Number.isSafeInteger(timeoutMs)&&timeoutMs>=1&&timeoutMs<=180000,
    'PUBLISH_HANDOFF_INPUT_INVALID');
  const prepared=preparation.results.filter(x=>x?.status==='PREPARED');
  const keys=new Set();
  for(const item of prepared){
    must(ID.test(item.taskId||'')&&ID.test(item.product||'')&&
      REPO.test(item.repository||'')&&SHA40.test(item.baseSha||'')&&
      SHA64.test(item.artifactSha256||'')&&
      !keys.has(item.product+':'+item.taskId),
      'PUBLISH_HANDOFF_TASK_INVALID');
    keys.add(item.product+':'+item.taskId);
  }
  if(typeof verifyPrepared!=='function'||typeof publishOne!=='function'||
     typeof verifyReceipt!=='function'){
    return wrap({status:'BLOCKED',reason:'NATIVE_PUBLISHER_PORTS_REQUIRED',
      authorized:false,receiptCount:0,results:wrap([])});
  }
  const results=[];
  // NEVER Promise.all here. The native Publisher owns the single writer/lock.
  for(const item of prepared){
    const task=wrap({taskId:item.taskId,product:item.product,
      repository:item.repository,baseSha:item.baseSha,
      artifactSha256:item.artifactSha256});
    let admitted=false;
    try{admitted=await bounded(signal=>verifyPrepared(task,wrap({signal})),timeoutMs)===true;}
    catch(error){
      results.push(summary(task,'UNKNOWN',isTimeout(error)?
        'NATIVE_PREPARED_READBACK_TIMEOUT_NO_REPLAY':'NATIVE_PREPARED_READBACK_UNKNOWN_NO_REPLAY'));
      continue;
    }
    if(!admitted){
      results.push(summary(task,'BLOCKED','NATIVE_PREPARED_READBACK_DENIED'));
      continue;
    }
    let published;
    try{published=await bounded(signal=>publishOne(task,wrap({signal})),timeoutMs);}
    catch(error){
      results.push(summary(task,'UNKNOWN',isTimeout(error)?
        'NATIVE_PUBLICATION_TIMEOUT_NO_REPLAY':'NATIVE_PUBLICATION_UNKNOWN_NO_REPLAY'));
      continue;
    }
    if(published?.status==='PENDING_CI'){
      results.push(summary(task,'PENDING','AWAIT_EXISTING_PUBLISHER_CI_RECEIPT'));
      continue;
    }
    if(published?.status!=='PUBLISHED'||published.taskId!==task.taskId||
       published.product!==task.product||published.repository!==task.repository||
       published.baseSha!==task.baseSha||!Number.isSafeInteger(published.pr)||
       published.pr<1||!SHA40.test(published.head||'')){
      results.push(summary(task,'UNKNOWN','NATIVE_PUBLICATION_OUTCOME_UNVERIFIED_NO_REPLAY'));
      continue;
    }
    let receipt;
    try{
      receipt=await bounded(signal=>verifyReceipt(task,wrap({
        pr:published.pr,head:published.head,signal
      })),timeoutMs);
    }catch(error){
      results.push(summary(task,'UNKNOWN',isTimeout(error)?
        'NATIVE_RECEIPT_READBACK_TIMEOUT_NO_REPLAY':'NATIVE_RECEIPT_READBACK_UNKNOWN_NO_REPLAY'));
      continue;
    }
    if(receipt?.status!=='VERIFIED'||receipt.taskId!==task.taskId||
       receipt.product!==task.product||receipt.repository!==task.repository||
       receipt.baseSha!==task.baseSha||receipt.pr!==published.pr||
       receipt.head!==published.head){
      results.push(summary(task,'UNKNOWN','NATIVE_RECEIPT_UNVERIFIED_NO_REPLAY'));
      continue;
    }
    results.push(summary(task,'VERIFIED','NATIVE_PUBLISHER_RECEIPT_CONFIRMED',published));
  }
  const receiptCount=results.filter(x=>x.status==='VERIFIED').length;
  return wrap({status:prepared.length===0?'IDLE':receiptCount===prepared.length?'VERIFIED':'PARTIAL',
    authorized:false,receiptCount,results:wrap(results)});
}
