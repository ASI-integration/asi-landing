// One serial, isolated acceptance pipeline. No live writer, publisher or execute:true port.
import fs from 'node:fs/promises';
import path from 'node:path';
import {decideQueue,WORK_ORDERS} from '../ASI-STRIGUNOV4-MULTIJOB-20261020.mjs';
import {inspectLegacy,readLegacyFiles} from '../ASI-STRIGUNOV4-ORCHESTRATOR-CANDIDATE-20261020.mjs';
import {existingState,digest,must,regular} from './state.mjs';
import {inspectCI} from './ci-reader.mjs';
import {inspectCodeRabbit} from './coderabbit-analyzer.mjs';
import {prepareDelta} from './change-preparer.mjs';

async function legacySnapshot(dir){
  const legacy=await readLegacyFiles(dir);
  must(inspectLegacy(legacy).safe,'LEGACY_RECONCILIATION_REQUIRED');
  // Do not import, clear or rewrite legacy ledgers. Preserve a byte-level witness.
  const bytes={};
  for(const name of ['receipts.json','heartbeat.json','autopilot-ledger.json','orchestrator-state.json']){
    const file=path.join(dir,name);
    try{await regular(file);bytes[name]=digest(await fs.readFile(file));}
    catch(e){if(e.code==='ENOENT')bytes[name]=null;else throw e;}
  }
  must(bytes['orchestrator-state.json']===null,'EXISTING_OR_UNCERTAIN_OPERATION');
  return {legacy,bytes};
}
const identity=s=>JSON.stringify({mainSha:s.mainSha,contract:s.contract,issues:s.issues,prs:s.prs,project:s.project,ledger:s.ledger});

/** Separate explicit isolated root. Uses the three adapter implementations without
 * their separate transaction wrappers: one lock covers select -> observe -> prepare -> receipt.
 * No callback capable of publishing or executing a queue action is accepted.
 */
export async function createIsolatedAcceptanceLoop({root,legacyStateDir,fetchSnapshot,github,
  ciPolicies,preparePlans,authorizePreparation,isolated=false}={}){
  must(isolated===true&&typeof fetchSnapshot==='function'&&typeof authorizePreparation==='function',
    'ISOLATED_PORTS_REQUIRED');
  const store=await existingState(root);
  const isolatedRoot=await fs.realpath(store.root);
  const legacyDir=await fs.realpath(legacyStateDir);
  // Canonical paths prevent symbolic-link aliases bypassing separation.
  must(legacyDir!==isolatedRoot&&!legacyDir.startsWith(isolatedRoot+path.sep),
    'LEGACY_MUST_BE_SEPARATE');
  must(legacyDir!=='/home/project_ayfaar/asi-strigunov-agent'&&!legacyDir.startsWith('/home/project_ayfaar/asi-strigunov-agent/'),'LIVE_LEGACY_FORBIDDEN');
  return Object.freeze({
    async poll({execute=false}={}){
      let selected,task,snapshot,witness;
      return store.execute('isolated-pipeline',async({ledger,receipts})=>{
        must(execute===false,'EXECUTION_FORBIDDEN');
        witness=await legacySnapshot(legacyDir);
        snapshot=await fetchSnapshot();
        const queue=decideQueue(snapshot);
        must(queue.stage==='S4-G1'&&queue.decision!=='BLOCKED_NEEDS_RECONCILIATION','QUEUE_BLOCKED');
        const jobs=WORK_ORDERS.filter(j=>j.stage==='S4-G1'&&j.kind!=='physical-gate');
        for(const job of jobs){
          const pin=job.kind==='review-pr'?job.head:snapshot.mainSha;
          const prior=receipts.completed.filter(r=>r.id===job.id);
          const expectedPr=job.kind==='review-pr'?job.pr:null;
          const entry=ledger.jobs[job.id];
          if(prior.length||entry){
            must(prior.length===1&&prior[0].status==='PASS'&&prior[0].kind==='isolated-pipeline'&&
              entry?.kind==='isolated-pipeline'&&prior[0].sha===pin&&prior[0].pr===expectedPr&&entry?.pr===expectedPr&&
              entry?.mode==='PUBLISHED'&&entry.artifactType==='LOCAL_REPORT_ONLY'&&entry.sha===pin&&
              entry.report===prior[0].report&&entry.reportSha256===prior[0].reportSha256,'JOB_RECONCILIATION');
            const report=path.join(store.root,'reports',entry.report);
            must(path.dirname(report)===path.join(store.root,'reports'),'REPORT_PATH_INVALID');
            await regular(report);must(digest(await fs.readFile(report))===entry.reportSha256,'REPORT_CHANGED');
          }
        }
        selected=jobs.find(j=>!ledger.jobs[j.id]);
        if(!selected)return null;
        must(!witness.legacy.receipts.completed.some(r=>r.id===selected.id),'LEGACY_JOB_ALREADY_RECORDED');
        const decision=queue.jobs.find(j=>j.job===selected.id);
        if(selected.kind==='prepare-source')must(decision?.status==='SOURCE_PREPARATION_READY','PREPARATION_NOT_ADMITTED');
        const pr=selected.kind==='review-pr'?selected.pr:null;
        const plan=preparePlans?.[selected.id];
        task={id:selected.id,stage:'S4-G1',repo:'ASI-integration/asi-landing',pr,
          sha:pr?selected.head:snapshot.mainSha,branch:pr?snapshot.prs[pr]?.branch:plan?.branch};
        return task;
      },github,async()=>{
        const observed=[];
        const reviewJobs=selected.kind==='review-pr'?[selected]:
          (selected.dependsOn??[]).map(id=>WORK_ORDERS.find(j=>j.id===id));
        for(const job of reviewJobs){
          must(job?.kind==='review-pr','REVIEW_DEPENDENCY_INVALID');
          const pin={id:job.id,stage:'S4-G1',repo:'ASI-integration/asi-landing',pr:job.pr,
            sha:job.head,branch:snapshot.prs[job.pr]?.branch};
          const before=await github.verifyTask(pin);
          const ci=await inspectCI(github,pin,ciPolicies);
          if(ci.status!=='PASS')return {status:ci.status,phase:'CI',head:pin.sha};
          const review=await inspectCodeRabbit(github,pin);
          if(review.status!=='PASS')return {status:review.status,phase:'REVIEW',head:pin.sha};
          must(JSON.stringify(before)===JSON.stringify(await github.verifyTask(pin)),'DEPENDENCY_SHA_CHANGED');
          observed.push({pr:pin.pr,head:pin.sha,ci,review});
        }
        let prepared=null;
        if(selected.kind==='prepare-source'){
          const plan=preparePlans[selected.id];
          must(plan&&Array.isArray(plan.changes)&&plan.changes.every(c=>selected.paths.includes(c.path)),
            'PREPARATION_SCOPE');
          const admission=await authorizePreparation(Object.freeze({...task,paths:[...selected.paths]}));
          must(admission&&Array.isArray(admission.paths)&&admission.paths.every(p=>selected.paths.includes(p)),
            'ADMISSION_SCOPE');
          prepared=await prepareDelta(store,task,{admission,changes:plan.changes});
        }
        must(identity(snapshot)===identity(await fetchSnapshot()),'SNAPSHOT_CHANGED');
        must(JSON.stringify(witness.bytes)===JSON.stringify((await legacySnapshot(legacyDir)).bytes),'LEGACY_CHANGED');
        return {status:'PASS',head:task.sha,execute:false,observed,prepared,physicalAcceptance:false};
      });
    }
  });
}
