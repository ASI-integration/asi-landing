import fs from 'node:fs/promises';
import path from 'node:path';
import {decideQueue,WORK_ORDERS,ENGINE_PILOT} from '../ASI-STRIGUNOV4-MULTIJOB-20261020.mjs';
import {assertLiveAdmission} from './host-authority.mjs';
import {inspectLegacy,readLegacyFiles} from '../ASI-STRIGUNOV4-ORCHESTRATOR-CANDIDATE-20261020.mjs';
import {existingState,atomicJson,regular,digest,must,LIVE_ROOT} from './state.mjs';
import {createGitHubPublisher,bindTask} from './github-publisher.mjs';
import {bounded} from './publisher-transport.mjs';
import {createGlobalDispatcher} from '../../global-dispatcher/dispatcher.mjs';
import {createStrigunovAdapter,hash} from '../../global-dispatcher/product-adapters.mjs';
import {verifyOwnerStageDecision,authorizeStageTask,stagePolicyHash} from './stage-authority.mjs';

/** Host supplies an immutable approved catalog and signed authority ports. Issue/PR
 * text never supplies a shell command, capability, path allowlist or task catalog.
 * Reuses decideQueue, preparation/CI/review adapters and the shared durable lock.
 * This candidate deliberately retains the isolated-root restriction until a live
 * caller and migration/admission policy are independently accepted.
 */
export async function createPublicationLoop({root,legacyStateDir,catalog,fetchSnapshot,remote,reader,
  authorize,runChecks,independentReview,ciPolicies,clock=Date.now,timeoutMs=10000,intervalMs=180000,
  liveAdmission,enginePilot=false,closedLoop,publishedReview}={}){
  must(intervalMs>=180000&&Number.isSafeInteger(intervalMs)&&Array.isArray(catalog)&&catalog.length>0&&catalog.length<=20&&
    new Set(catalog.map(t=>t.id)).size===catalog.length&&new Set(catalog.map(t=>t.branch)).size===catalog.length,'CATALOG_OR_INTERVAL_INVALID');
  const tasks=structuredClone(catalog),store=await existingState(root,{liveAdmission});
  // The same Engine lock, catalog, Publisher and receipts own the whole cycle.
  // Optional integration does not migrate live state or generalize G1 authority.
  let dispatcher,policy,continuing=false,completedIds=[];
  if(closedLoop){
    closedLoop=Object.freeze({...closedLoop,policy:structuredClone(closedLoop.policy)});
    // No override means the existing strict CodeRabbit reader, not skipped review.
    // An alternative review port still needs its exact native capability binding.
    must(publishedReview===undefined||typeof publishedReview.verify==='function','EXPLICIT_REVIEW_POLICY_REQUIRED');
    must(typeof closedLoop.readTrustedComments==='function'&&Number.isSafeInteger(closedLoop.maxTicks)&&
      closedLoop.maxTicks>=1&&closedLoop.maxTicks<=100,'CLOSED_LOOP_LIMITS');
    policy=structuredClone(closedLoop.policy);
    must(policy?.tasks?.length===tasks.length&&tasks.every(t=>policy.tasks.some(p=>p.id===t.id&&
      p.workOrderId===t.workOrderId&&p.branch===t.branch&&p.baseSha===t.sha&&
      JSON.stringify(p.paths)===JSON.stringify(t.changes.map(c=>c.path)))),'POLICY_CATALOG_BINDING');
    const native=createStrigunovAdapter({enginePilot});
    const adapter={...native,contractHash:hash({native:native.contractHash,catalog:bindTask(tasks),policy:stagePolicyHash(policy)}),
      evaluate(snapshot){const r=native.evaluate(snapshot);return {...r,status:continuing&&r.status==='READY'?'WAITING':r.status,candidates:continuing?[]:r.candidates.filter(c=>tasks.some(t=>t.workOrderId===c.id))};}};
    dispatcher=createGlobalDispatcher({stateDir:closedLoop.stateDir,adapters:[adapter]});
  }
  async function admission(task){
    if(!closedLoop)return;
    const capability=await verifyOwnerStageDecision(policy,{readTrustedComments:closedLoop.readTrustedComments,now:clock()});
    if(task)authorizeStageTask(policy,capability,policy.tasks.find(t=>t.id===task.id),{completedIds,now:clock()});
  }
  const legacy=await fs.realpath(legacyStateDir);
  must(legacy!==store.root&&!legacy.startsWith(store.root+path.sep)&&!store.root.startsWith(legacy+path.sep),'LEGACY_NOT_ISOLATED');
  if(legacy===LIVE_ROOT||legacy.startsWith(LIVE_ROOT+'/'))assertLiveAdmission(liveAdmission,store.root,legacy);
  let activeSnapshot,activeTask;
  const verifyAdmission=async({signal})=>{await admission(activeTask);must(JSON.stringify(await fetchSnapshot({signal}))===activeSnapshot,'QUEUE_ADMISSION_CHANGED');};
  const publisher=createGitHubPublisher({store,remote,reader,authorize,runChecks,independentReview,verifyAdmission,ciPolicies,publishedReview,clock,timeoutMs});
  async function witness(){
    try{await fs.lstat(path.join(legacy,'orchestrator-iteration.lock'));throw Error('LEGACY_LOCK_PENDING');}
    catch(e){if(e.code!=='ENOENT')throw e;}
    const state=await readLegacyFiles(legacy);must(inspectLegacy(state).safe,'LEGACY_BLOCKED');const hashes={};
    for(const n of ['receipts.json','heartbeat.json','autopilot-ledger.json','orchestrator-state.json']){
      try{const f=path.join(legacy,n);await regular(f);hashes[n]=digest(await fs.readFile(f));}
      catch(e){if(e.code==='ENOENT')hashes[n]=null;else throw e;}}
    must(hashes['orchestrator-state.json']===null,'LEGACY_OPERATION_PENDING');return hashes;}
  return Object.freeze({async poll({execute=false}={}){
    if(execute!==true)return {mode:'OBSERVE_ONLY',reason:'PUBLICATION_DISABLED',execute:false};
    let chosen,priorWitness,reason='NO_APPROVED_PUBLICATION_TASK';
    const result=await store.execute('github-publisher',async({ledger,receipts})=>{
      const now=clock();must(Number.isSafeInteger(now)&&now>=0,'CLOCK_INVALID');
      let last=null;const pollFile=store.file('publisher-poll.json');
      try{must((await regular(pollFile)).size<1000,'POLL_STATE_SIZE');last=JSON.parse(await fs.readFile(pollFile,'utf8'));
        must(last!==null&&typeof last==='object'&&!Array.isArray(last)&&Number.isSafeInteger(last.at),'POLL_STATE_INVALID');}
      catch(e){if(e.code!=='ENOENT')throw e;}
      if(last){must(Number.isSafeInteger(last.at)&&now>=last.at,'CLOCK_REGRESSION');
        if(now-last.at<intervalMs){reason='POLL_RATE_LIMITED';return null;}}
      if(closedLoop){
        must(!last||Number.isSafeInteger(last.count)&&last.count>=0&&last.limit===closedLoop.maxTicks&&
          last.policySha256===stagePolicyHash(policy),'POLL_BUDGET_STATE');
        if((last?.count??0)>=closedLoop.maxTicks){reason='POLL_BUDGET_EXHAUSTED';return null;}
      }
      await atomicJson(pollFile,{at:now,...(closedLoop?{count:(last?.count??0)+1,limit:closedLoop.maxTicks,policySha256:stagePolicyHash(policy)}:{})});
      priorWitness=await witness();
      const snapshot=await bounded(signal=>fetchSnapshot({signal}),timeoutMs),queue=decideQueue(snapshot,{enginePilot});
      activeSnapshot=JSON.stringify(snapshot);
      must(queue.stage==='S4-G1'&&queue.decision!=='BLOCKED_NEEDS_RECONCILIATION','RELEASE_STAGE_BLOCKED');
      await bounded(()=>admission(),timeoutMs);
      const completed={},remaining=[];completedIds=[];
      for(const t of tasks){
        must(t.kind==='github-publisher'&&t.stage==='S4-G1'&&t.sha===snapshot.mainSha,'TASK_STAGE_OR_SHA_CHANGED');
        const work=[...WORK_ORDERS,...(enginePilot?[ENGINE_PILOT]:[])].find(w=>w.id===t.workOrderId),decision=queue.jobs.find(w=>w.job===t.workOrderId);
        must(work?.kind==='prepare-source'&&work.stage==='S4-G1'&&t.changes?.every(c=>work.paths.includes(c.path)),'WORK_ORDER_SCOPE');
        const old=receipts.completed.filter(r=>r.id===t.id),entry=ledger.jobs[t.id];
        if(old.length||entry){
          must(old.length===1&&old[0].status==='PASS'&&old[0].kind==='github-publisher'&&old[0].sha===t.sha&&old[0].pr===null&&
            entry?.mode==='PUBLISHED'&&entry.kind==='github-publisher'&&entry.sha===t.sha&&entry.pr===null&&
            entry.report===old[0].report&&entry.reportSha256===old[0].reportSha256,'JOB_IDENTITY_COLLISION');
          must(typeof entry.report==='string'&&path.basename(entry.report)===entry.report,'REPORT_PATH');
          const f=path.join(store.root,'reports',entry.report);await regular(f);const raw=await fs.readFile(f,'utf8');
          const report=JSON.parse(raw);must(digest(raw)===entry.reportSha256&&report.result?.artifactType==='GITHUB_PR_VERIFIED'&&
            report.result.taskBinding===bindTask(t),'REMOTE_RECEIPT_UNVERIFIED');
          completedIds.push(t.id);completed[t.workOrderId]={publishedPr:report.result.pr,head:report.result.head};continue;
        }
        remaining.push(t);
        if(closedLoop)continue;
        // First uncompleted approved job blocks all later jobs; no priority bypass.
        must(decision?.status==='SOURCE_PREPARATION_READY','DEPENDENCY_NOT_READY');chosen=t;return t;
      }
      if(closedLoop){
        // Feedback derives only from validated Engine receipts, never a self-attested snapshot PASS.
        for(const [id,receipt] of Object.entries(completed)){
          const external=snapshot.ledger?.[id];
          must(external===undefined||external&&Object.keys(external).sort().join(',')==='head,publishedPr'&&
            external.head===receipt.head&&external.publishedPr===receipt.publishedPr,'RECEIPT_SNAPSHOT_CONFLICT');
        }
        const input=structuredClone(snapshot);input.ledger={...input.ledger,...completed};
        const pending=[];
        for(const t of remaining){
          try {const f=store.file(`publication-${t.id}.json`);must((await regular(f)).size<500000,'PUBLICATION_SIZE');
            const record=JSON.parse(await fs.readFile(f,'utf8'));
            must(record.taskBinding===bindTask(t)&&['PUBLISHED_WAITING','VERIFIED'].includes(record.phase),'PUBLICATION_UNKNOWN');
            pending.push(t);
          }catch(e){if(e.code!=='ENOENT')throw e;}
        }
        must(pending.length<=1,'MULTIPLE_PENDING_OPERATIONS');
        // A pending PR is continued first. Do not reserve another task while its CI waits.
        if(pending.length){
          continuing=true;const plan=await dispatcher.plan({strigunov4:input});
          must(!['BLOCKED','FAILED_LOCKED'].includes(plan.status),'PENDING_ROUTING_UNVERIFIED');
          const f=path.join(closedLoop.stateDir,'routing.json');await regular(f);const journal=JSON.parse(await fs.readFile(f,'utf8'));
          must(journal.checksum===hash(journal.state)&&journal.state.products.some(p=>p.id==='strigunov4'&&
            p.planned.some(v=>v.id===pending[0].workOrderId&&v.head===pending[0].sha)),'PENDING_RESERVATION_UNVERIFIED');
          chosen=pending[0];
        }else{
          continuing=false;
          const plan=await dispatcher.plan({strigunov4:input});
          must(!['BLOCKED','FAILED_LOCKED'].includes(plan.status),'DISPATCHER_RECONCILIATION');
          if(!plan.selected){reason='NO_ELIGIBLE_APPROVED_TASK';return null;}
          chosen=remaining.find(t=>t.workOrderId===plan.selected.task.id);
          must(chosen,'DISPATCHER_TASK_NOT_IN_CATALOG');
        }
        must(queue.jobs.find(w=>w.job===chosen.workOrderId)?.status==='SOURCE_PREPARATION_READY','DEPENDENCY_NOT_READY');
        await bounded(()=>admission(chosen),timeoutMs);activeTask=chosen;return chosen;
      }
      return null;
    },{async verifyTask(task){must(task===chosen,'TASK_SUBSTITUTED');const m=await bounded(()=>remote.get('branches/main'),timeoutMs);
      must(m.protected===true&&m.commit?.sha===task.sha,'MAIN_CHANGED');return {baseSha:task.sha,taskBinding:bindTask(task)};}},async()=>{
      const value=await publisher.run(chosen,{execute:true});
      must(JSON.stringify(priorWitness)===JSON.stringify(await witness()),'LEGACY_CHANGED');return value;
    });
    if(result.mode==='WAITING'&&result.reason==='NO_NEXT_ISOLATED_JOB')return {...result,reason};
    return result;
  }});
}
