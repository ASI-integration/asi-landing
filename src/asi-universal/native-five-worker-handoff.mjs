/**
 * Source-only bridge into the EXISTING WD Publisher and durable receipts.
 * Preparing five workers may overlap; publishing remains serialized under the
 * host's original signed native transaction. This module grants NO authority,
 * creates no Engine/ledger/service, makes no API calls without supplied ports.
 * Unknown external outcomes are NEVER retried here.
 */
const ID=/^[a-z][a-z0-9-]{0,79}$/;
const SHA40=/^[a-f0-9]{40}$/;
const SHA64=/^[a-f0-9]{64}$/;
const REPO=/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const blocked=(reason,results=[])=>Object.freeze({status:'BLOCKED',reason,
  publisherConcurrency:1,publisherReady:false,results:Object.freeze(results)});
const finish=(item,status,reason,extra={})=>Object.freeze({
  slot:item.slot,taskId:item.taskId,product:item.product,
  repository:item.repository,baseSha:item.baseSha,
  artifactSha256:item.artifactSha256,status,reason,...extra});
const valid=item=>item&&Number.isSafeInteger(item.slot)&&item.slot>=1&&item.slot<=5&&
  typeof item.taskId==='string'&&ID.test(item.taskId)&&
  typeof item.product==='string'&&ID.test(item.product)&&
  typeof item.repository==='string'&&REPO.test(item.repository)&&
  typeof item.baseSha==='string'&&SHA40.test(item.baseSha)&&
  item.status==='PREPARED'&&typeof item.artifactSha256==='string'&&
  SHA64.test(item.artifactSha256);
const exactReceipt=(receipt,item,pr)=>receipt&&receipt.status==='PASS'&&
  receipt.taskId===item.taskId&&receipt.product===item.product&&
  receipt.repository===item.repository&&receipt.baseSha===item.baseSha&&
  receipt.artifactSha256===item.artifactSha256&&
  Number.isSafeInteger(receipt.pr)&&receipt.pr>0&&
  (!pr||receipt.pr===pr.number);
const exactPr=(pr,item)=>pr&&pr.draft===true&&
  Number.isSafeInteger(pr.number)&&pr.number>0&&
  pr.repository===item.repository&&pr.baseSha===item.baseSha&&
  pr.taskId===item.taskId&&typeof pr.headSha==='string'&&SHA40.test(pr.headSha)&&
  typeof pr.url==='string'&&
  pr.url==='https://github.com/'+item.repository+'/pull/'+pr.number;

/**
 * The host MUST wire these ports to its existing signed admit/publisher and
 * disk-backed journal. No callback here independently authenticates a task.
 * Results from a model alone are NEVER interpreted as publication evidence.
 */
export async function publishPreparedFiveWorkerWave({wave,authorizePublication,
  publishDraft,verifyDraft,appendReceipt,readReceipt}={}){
  if(!wave||!['PREPARED','PARTIAL'].includes(wave.status)||
    wave.publisherReady!==false||!Array.isArray(wave.results)||
    wave.results.length<1||wave.results.length>5)
    throw Error('FIVE_WORKER_PUBLISH_WAVE_INVALID');
  if([authorizePublication,publishDraft,verifyDraft,appendReceipt,readReceipt]
    .some(fn=>typeof fn!=='function'))return blocked('NATIVE_PUBLISHER_PORTS_REQUIRED');
  const ready=wave.results.filter(item=>item?.status==='PREPARED');
  if(ready.some(item=>!valid(item))||
     new Set(ready.map(item=>item.taskId)).size!==ready.length||
     new Set(ready.map(item=>item.slot)).size!==ready.length)
    throw Error('FIVE_WORKER_PUBLISH_TASK_SCOPE_INVALID');
  const done=[];
  // Intentional SERIAL publication; the host retains the only GitHub writer.
  for(const item of [...wave.results].sort((a,b)=>a.slot-b.slot)){
    if(item.status!=='PREPARED'){
      done.push(finish(item,'BLOCKED','PREPARATION_NOT_PROVEN_NO_REPLAY'));
      continue;
    }
    // A pre-existing receipt stops any repeat external effect, even if a
    // caller re-invokes this source adapter after a restart.
    let prior;
    try{prior=await readReceipt(item);}catch{
      done.push(finish(item,'UNKNOWN','PREVIOUS_RECEIPT_UNREADABLE_NO_REPLAY'));
      continue;
    }
    if(prior!==null&&prior!==undefined){
      done.push(finish(item,exactReceipt(prior,item)?'ALREADY_RECORDED':'UNKNOWN',
        exactReceipt(prior,item)?'DURABLE_RECEIPT_EXISTS_NO_REPLAY':'PRIOR_OUTCOME_UNVERIFIED_NO_REPLAY',
        exactReceipt(prior,item)?{pr:prior.pr}:{}));
      continue;
    }
    let grant;
    try{grant=await authorizePublication(item);}catch{
      done.push(finish(item,'UNKNOWN','PUBLICATION_ADMISSION_UNKNOWN_NO_REPLAY'));
      continue;
    }
    if(grant?.approved!==true||grant.taskId!==item.taskId||
       grant.artifactSha256!==item.artifactSha256||
       grant.baseSha!==item.baseSha||grant.repository!==item.repository){
      done.push(finish(item,'BLOCKED','SIGNED_PUBLICATION_ADMISSION_REQUIRED'));
      continue;
    }
    const pinned=Object.freeze({slot:item.slot,taskId:item.taskId,
      product:item.product,repository:item.repository,baseSha:item.baseSha,
      artifactSha256:item.artifactSha256});
    let proposed;
    try{proposed=await publishDraft(pinned,grant);}catch{
      done.push(finish(item,'UNKNOWN','PUBLISH_OUTCOME_UNKNOWN_NO_REPLAY'));
      continue;
    }
    if(!exactPr(proposed,item)){
      done.push(finish(item,'UNKNOWN','PUBLISHED_PR_IDENTITY_UNVERIFIED_NO_REPLAY'));
      continue;
    }
    // Must be an independent READ from the existing GitHub reader, not a
    // second copy of the write response.
    let verified=false;
    try{verified=await verifyDraft(pinned,proposed)===true;}catch{}
    if(!verified){
      done.push(finish(item,'UNKNOWN','GITHUB_DRAFT_NOT_VERIFIED_NO_REPLAY'));
      continue;
    }
    const receipt=Object.freeze({status:'PASS',taskId:item.taskId,
      product:item.product,repository:item.repository,baseSha:item.baseSha,
      artifactSha256:item.artifactSha256,pr:proposed.number,headSha:proposed.headSha});
    let persisted=false;
    try{persisted=await appendReceipt(pinned,receipt)===true;}catch{}
    if(!persisted){
      done.push(finish(item,'UNKNOWN','DURABLE_RECEIPT_WRITE_UNKNOWN_NO_REPLAY'));
      continue;
    }
    let readback;
    try{readback=await readReceipt(item);}catch{}
    if(!exactReceipt(readback,item,proposed)||
       readback.headSha!==proposed.headSha){
      done.push(finish(item,'UNKNOWN','DURABLE_RECEIPT_READBACK_UNKNOWN_NO_REPLAY'));
      continue;
    }
    done.push(finish(item,'RECEIPT_VERIFIED','DRAFT_PR_AND_NATIVE_RECEIPT',{
      pr:proposed.number,url:proposed.url,headSha:proposed.headSha}));
  }
  const results=Object.freeze(done);
  return Object.freeze({status:done.every(x=>['RECEIPT_VERIFIED','ALREADY_RECORDED'].includes(x.status))?
      'RECEIPTS_VERIFIED':'PARTIAL',publisherConcurrency:1,
    publisherReady:false,results});
}

/** Call from a fresh host invocation AFTER a restart; this code cannot fake it. */
export async function verifyFiveWorkerAfterRestart({published,readReceipt,verifyRecordedDraft,
  verifyRestartWitness}={}){
  if(!published||!Array.isArray(published.results)||published.results.length<1||
     typeof readReceipt!=='function'||typeof verifyRecordedDraft!=='function'||
     typeof verifyRestartWitness!=='function')
    throw Error('FIVE_WORKER_RECOVERY_PORTS_REQUIRED');
  // The host must witness a real systemd InvocationID/PID change. Re-reading
  // in the same invocation is NOT restart evidence.
  let witness;
  try{witness=await verifyRestartWitness();}catch{}
  if(witness?.verified!==true||typeof witness.previousInvocationId!=='string'||
     typeof witness.currentInvocationId!=='string'||
     witness.previousInvocationId.length<8||witness.currentInvocationId.length<8||
     witness.previousInvocationId===witness.currentInvocationId)
    return blocked('REAL_SERVICE_RESTART_WITNESS_REQUIRED');
  const results=[];
  for(const item of published.results){
    if(!['RECEIPT_VERIFIED','ALREADY_RECORDED'].includes(item.status)){
      results.push(finish(item,'BLOCKED','NO_PRE_RESTART_RECEIPT'));
      continue;
    }
    let receipt=null,remote=false;
    try{
      receipt=await readReceipt(item);
      if(exactReceipt(receipt,item))remote=await verifyRecordedDraft(item,receipt)===true;
    }catch{}
    results.push(finish(item,exactReceipt(receipt,item)&&remote?'RESTART_VERIFIED':'UNKNOWN',
      exactReceipt(receipt,item)&&remote?'DURABLE_RECEIPT_AND_REMOTE_DRAFT':'RESTART_PROOF_UNVERIFIED',
      exactReceipt(receipt,item)&&remote?{pr:receipt.pr}:{}));
  }
  return Object.freeze({status:results.every(x=>x.status==='RESTART_VERIFIED')?
    'RESTART_VERIFIED':'PARTIAL',results:Object.freeze(results)});
}
