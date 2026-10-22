// ASI Strigunov 4 — ISOLATED, SOURCE-ONLY prototype of the state orchestrator.
// Importing this module never runs the Hetzner service, network commands, Codex,
// GitHub writes, migrations, or deploys. External capabilities are injected.
// Single authoritative operation journal; legacy JSON files are READ ONLY.
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {decideQueue, WORK_ORDERS} from './ASI-STRIGUNOV4-MULTIJOB-20261020.mjs';
const SHA=/^[a-f0-9]{40}$/;
const lockName='orchestrator-iteration.lock';
const journalName='orchestrator-state.json';
function must(condition,code){if(!condition)throw Error(code);}
function errCode(error){return error&&typeof error==='object'?error.code:null;}
function failure(code){return {mode:'WAIT_RECONCILIATION',reason:code};}

// A rename protects ONE JSON file from torn writes. It is NOT a transaction
// across receipts.json, heartbeat.json and autopilot-ledger.json. fsync helps
// persist data before rename, but does not guarantee consistency across files.
export async function atomicWriteJson(filename,value){
  const parent=path.dirname(filename);
  const temp=filename+'.'+randomUUID()+'.tmp';
  let fd,created=false;
  try{
    fd=await fs.open(temp,'wx',0o600);created=true;
    await fd.writeFile(JSON.stringify(value,null,2)+'\n','utf8');
    await fd.sync();await fd.close();fd=null;
    await fs.rename(temp,filename);created=false;
    // After rename the new file may be visible even if directory fsync fails.
    // Treat that as uncertain/FAILED_LOCKED; never infer publication or retry.
    // Durability is mandatory; a directory open/sync error is a write failure.
    let d;
    try{d=await fs.open(parent,'r');await d.sync();}
    finally{if(d)await d.close();}
  }catch(e){
    if(fd)await fd.close().catch(()=>{});
    if(created)await fs.unlink(temp).catch(()=>{});
    throw e;
  }
}
async function readBoundedJson(filename,{required=false,maxBytes=800000}={}){
  let st;
  try{st=await fs.lstat(filename);}catch(e){
    if(errCode(e)==='ENOENT'&&!required)return null;
    throw e;
  }
  must(st.isFile()&&!st.isSymbolicLink()&&st.size>=1&&st.size<=maxBytes,
    'JOURNAL_NOT_REGULAR_OR_BOUNDED');
  const contents=await fs.readFile(filename,'utf8');
  must(Buffer.byteLength(contents,'utf8')<=maxBytes,'JOURNAL_TOO_LARGE');
  try{return JSON.parse(contents);}catch{throw Error('JOURNAL_INVALID_JSON');}
}
export async function readLegacyFiles(directory){
  const [receipts,heartbeat,autopilotLedger]=await Promise.all([
    readBoundedJson(path.join(directory,'receipts.json')),
    readBoundedJson(path.join(directory,'heartbeat.json')),
    readBoundedJson(path.join(directory,'autopilot-ledger.json'))
  ]);
  return {receipts:receipts??{version:1,completed:[]},heartbeat,autopilotLedger};
}

// Fail closed. Do not infer physical acceptance from PASS/other agent text.
export function inspectLegacy({receipts,heartbeat,autopilotLedger}={}){
  if(!receipts||receipts.version!==1||!Array.isArray(receipts.completed))
    return {safe:false,reason:'RECEIPTS_INVALID'};
  const seen=new Set();
  for(const r of receipts.completed){
    if(!r||typeof r.id!=='string'||!SHA.test(r.sha||'')||
       typeof r.status!=='string'||!['PASS','FAILED','STALE'].includes(r.status))
      return {safe:false,reason:'RECEIPTS_SCHEMA_UNTRUSTED'};
    const key=r.id+':'+r.sha;
    if(seen.has(key))return {safe:false,reason:'RECEIPTS_DUPLICATE'};
    seen.add(key);
    if(r.status!=='PASS')return {safe:false,reason:'RECEIPT_RECONCILIATION'};
  }
  if(heartbeat!==null&&heartbeat!==undefined){
    if(!heartbeat||typeof heartbeat!=='object'||Array.isArray(heartbeat)||typeof heartbeat.mode!=='string')
      return {safe:false,reason:'HEARTBEAT_INVALID'};
    if(['RUNNING','BLOCKED','FAILED_LOCKED'].includes(heartbeat.mode))
      return {safe:false,reason:'HEARTBEAT_RECONCILIATION'};
    if(!['WAITING','REPORT_READY'].includes(heartbeat.mode))
      return {safe:false,reason:'HEARTBEAT_UNKNOWN'};
  }
  if(autopilotLedger!==null&&autopilotLedger!==undefined){
    // The old one-job ledger must be reconciled to PR/task identity rather
    // than implicitly promoted into an arbitrary new multi-job operation.
    return {safe:false,reason:'LEGACY_AUTOPILOT_LEDGER_RECONCILIATION'};
  }
  return {safe:true,reason:null};
}
async function acquire(directory){
  const filename=path.join(directory,lockName);
  let handle;
  try{handle=await fs.open(filename,'wx',0o600);}catch(e){
    if(errCode(e)==='EEXIST')return null;
    throw e;
  }
  try{await handle.writeFile(JSON.stringify({pid:process.pid,createdAt:new Date().toISOString()})+'\n');
    await handle.sync();}
  catch(e){
    await handle.close().catch(()=>{});
    // No operation has begun: discard a partially written fresh lock. If unlink
    // fails, the remaining lock still blocks later execution (fail closed).
    await fs.unlink(filename).catch(()=>{});
    throw e;
  }
  return {filename,handle};
}
async function release(lock){
  await lock.handle.close();
  await fs.unlink(lock.filename);
}
function existingOp(state){
  if(state===null)return null;
  must(state&&state.version===1&&state.operation&&typeof state.operation==='object',
    'ORCHESTRATOR_STATE_UNKNOWN');
  // Existing anything is a blocker; even PUBLISHED must be reconciled against
  // authoritative GitHub metadata before another job can be admitted.
  return state.operation;
}
function sourceCandidate(queue){
  const ready=queue.jobs?.filter(x=>x.kind==='prepare-source'&&x.status==='SOURCE_PREPARATION_READY')||[];
  must(ready.length<=1,'MULTIPLE_SOURCE_CANDIDATES');
  return ready[0]||null;
}
function validCap(grant,envelope){
  return grant?.approved===true&&grant.job===envelope.job&&grant.mainSha===envelope.mainSha&&
    Array.isArray(grant.paths)&&grant.paths.length===envelope.paths.length&&
    grant.paths.every((x,i)=>x===envelope.paths[i]);
}

export function createOrchestrator({stateDir,fetchSnapshot,authorize,dispatch,verifyPublication,
                                  choose=decideQueue}={}){
  must(typeof stateDir==='string'&&path.isAbsolute(stateDir),'ABSOLUTE_STATE_DIR_REQUIRED');
  must([fetchSnapshot,authorize,dispatch,verifyPublication,choose].every(x=>typeof x==='function'),
    'REQUIRED_PORT_MISSING');
  return {
    async iteration({execute=false}={}){
      // Do not hide unknown results as an ordinary empty-queue event.
      const lock=execute?await acquire(stateDir):null;
      if(execute&&!lock)return {mode:'WAIT_LOCKED',reason:'ANOTHER_ITERATION_OR_STALE_LOCK'};
      let releaseAllowed=true;
      try{
        const legacy=await readLegacyFiles(stateDir);
        const verified=inspectLegacy(legacy);
        if(!verified.safe)return failure(verified.reason);
        const operation=existingOp(await readBoundedJson(path.join(stateDir,journalName)));
        if(operation)return failure('EXISTING_OR_UNCERTAIN_OPERATION');
        const snapshot=await fetchSnapshot();
        must(snapshot&&SHA.test(snapshot.mainSha),'LIVE_MAIN_SHA_NOT_VERIFIED');
        const queue=choose(snapshot);
        const ticket=sourceCandidate(queue);
        if(!ticket)return {mode:'OBSERVE_ONLY',stage:queue.stage,reason:queue.decision,job:null};
        if(!execute)return {mode:'SOURCE_PLAN_AVAILABLE',stage:queue.stage,job:ticket.job,
                            reason:'READ_ONLY_SOURCE_PLAN'};
        const work=WORK_ORDERS.find(x=>x.id===ticket.job);
        must(work?.kind==='prepare-source'&&work.stage===queue.stage&&
             Array.isArray(ticket.paths)&&JSON.stringify(work.paths)===JSON.stringify(ticket.paths),
             'SOURCE_TICKET_UNVERIFIED');
        const envelope={job:ticket.job,kind:'prepare-source',mainSha:snapshot.mainSha,
          stage:queue.stage,issue:queue.issue,paths:[...ticket.paths]};
        const grant=await authorize(Object.freeze(envelope));
        if(!validCap(grant,envelope))return {mode:'WAIT_AUTHORIZATION',job:ticket.job,
          reason:'WORK_ORDER_CAPABILITY_UNCONFIRMED'};
        const operationId=randomUUID();
        const start={version:1,operation:{id:operationId,status:'STARTED',
          job:ticket.job,stage:queue.stage,mainSha:snapshot.mainSha,
          createdAt:new Date().toISOString()}};
        releaseAllowed=false;
        await atomicWriteJson(path.join(stateDir,journalName),start);
        releaseAllowed=true;
        let publicationIdentity={};
        try{
          const outcome=await dispatch(Object.freeze(envelope));
          must(outcome&&Number.isSafeInteger(outcome.publishedPr)&&outcome.publishedPr>0&&
               SHA.test(outcome.head||''),'PUBLISHED_RESULT_INVALID');
          publicationIdentity={publishedPr:outcome.publishedPr,head:outcome.head};
          const verified=await verifyPublication({job:ticket.job,pr:outcome.publishedPr,
            head:outcome.head,mainSha:snapshot.mainSha});
          must(verified===true,'PUBLISHED_PR_NOT_INDEPENDENTLY_VERIFIED');
          releaseAllowed=false;
          await atomicWriteJson(path.join(stateDir,journalName),{
            version:1,operation:{...start.operation,status:'PUBLISHED',
              publishedPr:outcome.publishedPr,head:outcome.head,finishedAt:new Date().toISOString()}});
          releaseAllowed=true;
          return {mode:'PUBLISHED',job:ticket.job,prNumber:outcome.publishedPr,head:outcome.head};
        }catch{
          // If this persistence fails, STARTED remains durable and blocks replay.
          releaseAllowed=false;
          await atomicWriteJson(path.join(stateDir,journalName),{
            version:1,operation:{...start.operation,...publicationIdentity,status:'FAILED_LOCKED',
              error:'DISPATCH_OR_VERIFICATION_FAILED',finishedAt:new Date().toISOString()}});
          releaseAllowed=true;
          return {mode:'FAILED_LOCKED',job:ticket.job,reason:'RECONCILIATION_REQUIRED'};
        }
      }finally{
        if(lock){
          try{
            if(releaseAllowed)await release(lock);
            else await lock.handle.close(); // Keep the stop marker on uncertain write.
          }catch{
            // Cleanup failure must not replace the already computed result.
            // Recreate a stop marker if unlink happened before cleanup failed.
            await lock.handle.close().catch(()=>{});
            try{
              const marker=await fs.open(lock.filename,'wx',0o600);
              try{
                await marker.writeFile('LOCK_RELEASE_FAILED\n');
                await marker.sync();
              }finally{await marker.close().catch(()=>{});}
            }catch{
              // EEXIST means an existing lock already blocks replay; for other
              // failures the persistent operation journal remains authoritative.
            }
          }
        }
      }
    }
  };
}
