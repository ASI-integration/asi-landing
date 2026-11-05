/**
 * Product-neutral source handoff for the ONE EXISTING ASI Publisher.
 * Plans ONLY; never calls GitHub, consumes model credit, runs code, grants
 * authority, creates ledgers or publishes. An authenticated native-host reader
 * must read the prepared source bytes/provenance from original workspace.
 */
import {createHash} from 'node:crypto';

const ID=/^[a-z][a-z0-9-]{0,79}$/;
const SHA40=/^[a-f0-9]{40}$/;
const SHA64=/^[a-f0-9]{64}$/;
const REPO=/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const PATH=/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*\.(?:mjs|js|json|py)$/;
const hash=x=>createHash('sha256').update(x).digest('hex');
const item=(slot,taskId,status,reason)=>Object.freeze({slot,taskId,status,reason});
const fail=(reason,blocked=[])=>Object.freeze({
  schema:'asi.five-worker-publisher-handoff.v1',status:'BLOCKED',reason,
  authorized:false,publishAllowed:false,publisherConcurrency:1,
  ready:Object.freeze([]),blocked:Object.freeze(blocked)
});

/**
 * The host-supplied readPrepared must operate under trusted task-exact
 * native ledger and workspace provenance. Its output is checked here for
 * consistency, not elevated to authorization.
 * A partial batch may expose other independently proven candidates.
 */
export async function compileFiveWorkerPublisherHandoff({wave,preparation,readPrepared}={}){
  if(!wave||!['PLANNED','PARTIAL'].includes(wave.status)||
     wave.executable!==false||wave.authority!==null||
     wave.publisherConcurrency!==1||!Array.isArray(wave.slots)||
     wave.slots.length<1||wave.slots.length>5||
     !preparation||!['PREPARED','PARTIAL'].includes(preparation.status)||
     preparation.publisherReady!==false||!Array.isArray(preparation.results)||
     preparation.results.length!==wave.slots.length||
     typeof readPrepared!=='function')return fail('TRUSTED_PREPARATION_INPUT_REQUIRED');

  const results=new Map();
  for(const r of preparation.results){
    if(!r||!Number.isSafeInteger(r.slot)||r.slot<1||r.slot>5||
       !ID.test(r.taskId||'')||results.has(r.slot)||
       !['PREPARED','BLOCKED','UNKNOWN'].includes(r.status))
      return fail('PREPARATION_RESULT_IDENTITY_UNVERIFIED');
    results.set(r.slot,r);
  }
  const seen=new Set(),ready=[],blocked=[];
  for(let index=0;index<wave.slots.length;index++){
    const s=wave.slots[index],r=results.get(index+1);
    if(!s||s.slot!==index+1||!r||r.taskId!==s.task?.id||
       !ID.test(s.product||'')||!ID.test(s.task.id||'')||
       !REPO.test(s.repository||'')||!SHA40.test(s.head||'')||
       s.executable!==false||s.authority!==null||
       !Array.isArray(s.task.paths)||s.task.paths.length<1||
       s.task.paths.length>3||s.task.paths.some(p=>!PATH.test(p))||
       new Set(s.task.paths).size!==s.task.paths.length||
       seen.has(s.product+':'+s.task.id))
      return fail('SIGNED_TASK_SCOPE_MISMATCH');
    seen.add(s.product+':'+s.task.id);
    if(r.status!=='PREPARED'){
      blocked.push(item(s.slot,s.task.id,r.status,'PREPARATION_NOT_VERIFIED'));
      continue;
    }
    if(r.product!==s.product||r.repository!==s.repository||r.baseSha!==s.head){
      blocked.push(item(s.slot,s.task.id,'BLOCKED','PREPARATION_RESULT_SCOPE_CHANGED'));
      continue;
    }
    if(!SHA64.test(r.artifactSha256||'')){
      blocked.push(item(s.slot,s.task.id,'BLOCKED','SOURCE_ARTIFACT_DIGEST_UNVERIFIED'));
      continue;
    }
    let proof;
    try{proof=await readPrepared(Object.freeze({
      slot:s.slot,taskId:s.task.id,product:s.product,
      repository:s.repository,baseSha:s.head,artifactSha256:r.artifactSha256,
      paths:Object.freeze([...s.task.paths])
    }));}
    catch{
      blocked.push(item(s.slot,s.task.id,'UNKNOWN','SOURCE_READBACK_UNKNOWN_NO_REPLAY'));
      continue;
    }
    if(!proof||proof.taskId!==s.task.id||proof.product!==s.product||
       proof.repository!==s.repository||proof.baseSha!==s.head||
       proof.artifactSha256!==r.artifactSha256||
       !Array.isArray(proof.changes)||proof.changes.length!==s.task.paths.length){
      blocked.push(item(s.slot,s.task.id,'BLOCKED','SOURCE_READBACK_IDENTITY_UNVERIFIED'));
      continue;
    }
    const changes=[];
    for(let n=0;n<proof.changes.length;n++){
      const c=proof.changes[n];
      if(!c||c.path!==s.task.paths[n]||typeof c.content!=='string'||
         c.content.length>128000||!SHA64.test(c.afterSha256||'')||
         hash(c.content)!==c.afterSha256||
         !(c.beforeSha256===null||SHA64.test(c.beforeSha256))){
        changes.length=0;break;
      }
      changes.push(Object.freeze({path:c.path,beforeSha256:c.beforeSha256,
        afterSha256:c.afterSha256,content:c.content}));
    }
    if(changes.length!==s.task.paths.length){
      blocked.push(item(s.slot,s.task.id,'BLOCKED','SOURCE_BYTES_OR_SCOPE_UNVERIFIED'));
      continue;
    }
    const computed=hash(JSON.stringify({taskId:s.task.id,product:s.product,
      repository:s.repository,baseSha:s.head,changes}));
    if(computed!==r.artifactSha256){
      blocked.push(item(s.slot,s.task.id,'BLOCKED','SOURCE_ARTIFACT_DIGEST_MISMATCH'));
      continue;
    }
    // NOT a native publisher task: only the signed host may compile it
    // to its existing authenticated task catalog.
    ready.push(Object.freeze({slot:s.slot,taskId:s.task.id,product:s.product,
      repository:s.repository,baseSha:s.head,
      artifactSha256:r.artifactSha256,
      changes:Object.freeze(changes),authorized:false,publishAllowed:false}));
  }
  return Object.freeze({schema:'asi.five-worker-publisher-handoff.v1',
    status:ready.length?'CANDIDATES_READY':'BLOCKED',
    reason:'REQUIRES_NATIVE_SIGNED_PUBLISHER_ADMISSION',
    authorized:false,publishAllowed:false,publisherConcurrency:1,
    ready:Object.freeze(ready),blocked:Object.freeze(blocked)});
}
