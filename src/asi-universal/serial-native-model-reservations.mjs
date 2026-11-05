/**
 * Serializes ONLY paid-request claims for the existing native WD ledger.
 * Once a claim is durably accepted, the model transport may run in parallel.
 * No second budget, lock, queue service, model provider or execution grant.
 * The signed host MUST pass its existing reserveNativeModelRequest-bound port.
 */
const ID=/^[a-z0-9][a-z0-9-]{0,79}$/;
const SHA40=/^[0-9a-f]{40}$/;
const SHA64=/^[0-9a-f]{64}$/;
const MODEL=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,100}$/;
const fail=code=>Error(code);

export function serializeNativeModelReservations(nativeReserve){
  if(typeof nativeReserve!=='function')throw fail('NATIVE_RESERVATION_PORT_REQUIRED');
  let tail=Promise.resolve(),poisoned=false;
  const seen=new Set();
  return function reserveModel(request){
    if(!request||typeof request!=='object'||Array.isArray(request)||
       typeof request.taskId!=='string'||!ID.test(request.taskId)||
       typeof request.baseSha!=='string'||!SHA40.test(request.baseSha)||
       typeof request.model!=='string'||!MODEL.test(request.model)||
       !Number.isSafeInteger(request.maxOutputTokens)||request.maxOutputTokens<1||
       request.maxOutputTokens>8192||typeof request.pathDigest!=='string'||
       !SHA64.test(request.pathDigest))
      return Promise.reject(fail('NATIVE_MODEL_RESERVATION_INPUT_INVALID'));
    const pinned=Object.freeze({taskId:request.taskId,baseSha:request.baseSha,
      model:request.model,maxOutputTokens:request.maxOutputTokens,
      pathDigest:request.pathDigest});
    const key=pinned.taskId+':'+pinned.model+':'+pinned.pathDigest;
    // A duplicate may mean an earlier paid request is UNKNOWN. Never call
    // the native port again with the same task/model/input fingerprint.
    if(seen.has(key))return Promise.reject(fail('NATIVE_MODEL_CLAIM_DUPLICATE_NO_REPLAY'));
    seen.add(key);
    const job=tail.then(async()=>{
      if(poisoned)throw fail('NATIVE_MODEL_LEDGER_UNCERTAIN_FAILED_LOCKED');
      let result;
      try{result=await nativeReserve(pinned);}
      catch{
        poisoned=true;
        throw fail('NATIVE_MODEL_RESERVATION_OUTCOME_UNKNOWN_NO_REPLAY');
      }
      if(result?.authorized!==true||result.taskId!==pinned.taskId||
         result.baseSha!==pinned.baseSha||result.model!==pinned.model||
         result.pathDigest!==pinned.pathDigest||
         result.maxOutputTokens!==pinned.maxOutputTokens||
         typeof result.operationId!=='string'||!ID.test(result.operationId)){
        poisoned=true;
        throw fail('NATIVE_MODEL_RESERVATION_READBACK_UNVERIFIED');
      }
      return Object.freeze({authorized:true,...pinned,operationId:result.operationId});
    });
    tail=job.then(()=>{},()=>{});
    return job;
  };
}
