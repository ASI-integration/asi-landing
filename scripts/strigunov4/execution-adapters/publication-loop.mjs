import fs from 'node:fs/promises';
import path from 'node:path';
import {decideQueue,WORK_ORDERS} from '../ASI-STRIGUNOV4-MULTIJOB-20261020.mjs';
import {inspectLegacy,readLegacyFiles} from '../ASI-STRIGUNOV4-ORCHESTRATOR-CANDIDATE-20261020.mjs';
import {existingState,atomicJson,regular,digest,must,LIVE_ROOT} from './state.mjs';
import {createGitHubPublisher,bindTask} from './github-publisher.mjs';
import {bounded} from './publisher-transport.mjs';

/** Host supplies an immutable approved catalog and signed authority ports. Issue/PR
 * text never supplies a shell command, capability, path allowlist or task catalog.
 * Reuses decideQueue, preparation/CI/review adapters and the shared durable lock.
 * This candidate deliberately retains the isolated-root restriction until a live
 * caller and migration/admission policy are independently accepted.
 */
export async function createPublicationLoop({root,legacyStateDir,catalog,fetchSnapshot,remote,reader,
  authorize,runChecks,independentReview,ciPolicies,clock=Date.now,timeoutMs=10000,intervalMs=180000}={}){
  must(intervalMs>=180000&&Number.isSafeInteger(intervalMs)&&Array.isArray(catalog)&&catalog.length>0&&catalog.length<=20&&
    new Set(catalog.map(t=>t.id)).size===catalog.length&&new Set(catalog.map(t=>t.branch)).size===catalog.length,'CATALOG_OR_INTERVAL_INVALID');
  const tasks=structuredClone(catalog),store=await existingState(root);
  const legacy=await fs.realpath(legacyStateDir);
  must(legacy!==store.root&&!legacy.startsWith(store.root+path.sep)&&!store.root.startsWith(legacy+path.sep)&&
    legacy!==LIVE_ROOT&&!legacy.startsWith(LIVE_ROOT+'/'),'LEGACY_NOT_ISOLATED');
  const publisher=createGitHubPublisher({store,remote,reader,authorize,runChecks,independentReview,ciPolicies,clock,timeoutMs});
  async function witness(){const state=await readLegacyFiles(legacy);must(inspectLegacy(state).safe,'LEGACY_BLOCKED');const hashes={};
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
      try{await regular(pollFile);last=JSON.parse(await fs.readFile(pollFile,'utf8'));}
      catch(e){if(e.code!=='ENOENT')throw e;}
      if(last){must(Number.isSafeInteger(last.at)&&now>=last.at,'CLOCK_REGRESSION');
        if(now-last.at<intervalMs){reason='POLL_RATE_LIMITED';return null;}}
      await atomicJson(pollFile,{at:now});
      priorWitness=await witness();
      const snapshot=await bounded(signal=>fetchSnapshot({signal}),timeoutMs),queue=decideQueue(snapshot);
      must(queue.stage==='S4-G1'&&queue.decision!=='BLOCKED_NEEDS_RECONCILIATION','RELEASE_STAGE_BLOCKED');
      for(const t of tasks){
        must(t.kind==='github-publisher'&&t.stage==='S4-G1'&&t.sha===snapshot.mainSha,'TASK_STAGE_OR_SHA_CHANGED');
        const work=WORK_ORDERS.find(w=>w.id===t.workOrderId),decision=queue.jobs.find(w=>w.job===t.workOrderId);
        must(work?.kind==='prepare-source'&&work.stage==='S4-G1'&&t.changes?.every(c=>work.paths.includes(c.path)),'WORK_ORDER_SCOPE');
        const old=receipts.completed.filter(r=>r.id===t.id),entry=ledger.jobs[t.id];
        if(old.length||entry){
          must(old.length===1&&old[0].status==='PASS'&&old[0].kind==='github-publisher'&&old[0].sha===t.sha&&old[0].pr===null&&
            entry?.mode==='PUBLISHED'&&entry.kind==='github-publisher'&&entry.sha===t.sha&&entry.pr===null&&
            entry.report===old[0].report&&entry.reportSha256===old[0].reportSha256,'JOB_IDENTITY_COLLISION');
          must(typeof entry.report==='string'&&path.basename(entry.report)===entry.report,'REPORT_PATH');
          const f=path.join(store.root,'reports',entry.report);await regular(f);const raw=await fs.readFile(f,'utf8');
          const report=JSON.parse(raw);must(digest(raw)===entry.reportSha256&&report.result?.artifactType==='GITHUB_PR_VERIFIED'&&
            report.result.taskBinding===bindTask(t),'REMOTE_RECEIPT_UNVERIFIED');continue;
        }
        // First uncompleted approved job blocks all later jobs; no priority bypass.
        must(decision?.status==='SOURCE_PREPARATION_READY','DEPENDENCY_NOT_READY');chosen=t;return t;
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
