import fs from 'node:fs/promises';
import path from 'node:path';
import {decideQueue,WORK_ORDERS,ENGINE_PILOT,BEGET_TASKS} from '../ASI-STRIGUNOV4-MULTIJOB-20261020.mjs';
import {assertLiveAdmission} from './host-authority.mjs';
import {inspectLegacy,readLegacyFiles} from '../ASI-STRIGUNOV4-ORCHESTRATOR-CANDIDATE-20261020.mjs';
import {existingState,atomicJson,regular,digest,must,LIVE_ROOT,inspectStandingTransaction} from './state.mjs';
import {createGitHubPublisher,bindTask} from './github-publisher.mjs';
import {prepareNativeFiveLaneSource} from './beget-native-five-lane-source.mjs';
import {isNativeSourceModification} from '../source-publisher-handoff.mjs';
import {bounded} from './publisher-transport.mjs';
import {createGlobalDispatcher} from '../../global-dispatcher/dispatcher.mjs';
import {createStrigunovAdapter,decomposeProductGoal,hash} from '../../global-dispatcher/product-adapters.mjs';
import {verifyOwnerStageDecision,authorizeStageTask,stagePolicyHash} from './stage-authority.mjs';

/** Host supplies an immutable approved catalog and signed authority ports. Issue/PR
 * text never supplies a shell command, capability, path allowlist or task catalog.
 * Reuses decideQueue, preparation/CI/review adapters and the shared durable lock.
 * This candidate deliberately retains the isolated-root restriction until a live
 * caller and migration/admission policy are independently accepted.
 */
export async function createPublicationLoop({root,legacyStateDir,catalog,fetchSnapshot,remote,reader,
  authorize,runChecks,independentReview,ciPolicies,clock=Date.now,timeoutMs=10000,intervalMs=180000,
  liveAdmission,enginePilot=false,closedLoop,publishedReview,fencingWitness,transactionPorts}={}){
  must(intervalMs>=180000&&Number.isSafeInteger(intervalMs)&&Array.isArray(catalog)&&catalog.length>0&&catalog.length<=20&&
    new Set(catalog.map(t=>t.id)).size===catalog.length&&new Set(catalog.map(t=>t.branch)).size===catalog.length,'CATALOG_OR_INTERVAL_INVALID');
  const tasks=structuredClone(catalog),store=await existingState(root,{liveAdmission});
  must(transactionPorts===undefined||typeof transactionPorts==='function','TRANSACTION_PORTS_REQUIRED');
  // Candidate seam only: existing protected host construction remains on v0.
  // A future protected adoption must pin this factory and all its transports.
  if(transactionPorts)must(!liveAdmission,'TRANSACTION_PORTS_NOT_ADOPTED');
  // The standing preview does not meter closed-loop owner-comment/review ports.
  // Reject that unadopted combination; the existing host path is unchanged.
  if(transactionPorts)must(!closedLoop,'STANDING_CLOSED_LOOP_NOT_ADOPTED');
  // The same Engine lock, catalog, Publisher and receipts own the whole cycle.
  // Optional integration does not migrate live state or generalize G1 authority.
  let dispatcher,policy,goalGraph,continuing=false,completedIds=[];
  if(closedLoop){
    closedLoop=Object.freeze({...closedLoop,policy:structuredClone(closedLoop.policy),
      ...(closedLoop.planning===undefined?{}:{planning:structuredClone(closedLoop.planning)})});
    // No override means the existing strict CodeRabbit reader, not skipped review.
    // An alternative review port still needs its exact native capability binding.
    must(publishedReview===undefined||typeof publishedReview.verify==='function','EXPLICIT_REVIEW_POLICY_REQUIRED');
    must(typeof closedLoop.readTrustedComments==='function'&&Number.isSafeInteger(closedLoop.maxTicks)&&
      closedLoop.maxTicks>=1&&closedLoop.maxTicks<=2016,'CLOSED_LOOP_LIMITS');
    policy=structuredClone(closedLoop.policy);
    must(!closedLoop.continuous||policy.schema==='asi.stage-authority.beget.v1','CONTINUOUS_POLICY_REQUIRED');
    must(policy?.tasks?.length===tasks.length&&tasks.every(t=>policy.tasks.some(p=>p.id===t.id&&
      p.workOrderId===t.workOrderId&&p.branch===t.branch&&p.baseSha===t.sha&&
      JSON.stringify(p.paths)===JSON.stringify(t.changes.map(c=>c.path)))),'POLICY_CATALOG_BINDING');
    const native=createStrigunovAdapter({enginePilot,begetTasks:policy.schema==='asi.stage-authority.beget.v1'});
    // Optional structured planning uses this SAME finite signed catalog and
    // native authority chain. It cannot add a task, path, writer or permission.
    const compileGoal=()=>{
      const p=closedLoop.planning;
      must(policy.schema==='asi.stage-authority.beget.v1'&&p&&
        Object.keys(p).sort().join(',')==='contract,goal,workOrders','PLANNING_SCOPE');
      const graph=decomposeProductGoal(p.contract,p.goal,p.workOrders,{now:clock()});
      must(graph.product==='strigunov4'&&graph.repository===policy.repository&&graph.head===policy.baseSha&&
        graph.notBefore===policy.notBefore&&graph.expiresAt===policy.expiresAt&&
        graph.budget.maxTasks===tasks.length&&graph.nodes.length===tasks.length&&
        new Set(tasks.map(t=>t.workOrderId)).size===tasks.length&&graph.nodes.every(n=>{
          const task=tasks.find(t=>t.workOrderId===n.id);
          return task&&n.stage===policy.stage.toLowerCase()&&n.operation==='prepare-source'&&
            n.tool==='existing-runner-bridge'&&hash(n.paths)===hash(task.changes.map(c=>c.path).sort());
        }),'PLANNING_CATALOG_BINDING');
      return graph;
    };
    const initialGraph=closedLoop.planning===undefined?undefined:compileGoal();
    goalGraph=initialGraph;
    const adapter={...native,
      ...(initialGraph?{goalPlanning:true,maxConcurrentPlans:1}:{}),
      contractHash:hash({native:native.contractHash,catalog:bindTask(tasks),policy:stagePolicyHash(policy),
        ...(initialGraph?{planHash:initialGraph.planHash}:{})}),
      evaluate(snapshot){
        const graph=initialGraph?compileGoal():undefined;
        must(!graph||graph.planHash===initialGraph.planHash,'PLANNING_CHANGED');
        const r=native.evaluate(snapshot);
        const candidates=continuing?[]:r.candidates.filter(c=>tasks.some(t=>t.workOrderId===c.id))
          .filter(c=>!graph||graph.nodes.find(n=>n.id===c.id)?.dependsOn.every(id=>
            completedIds.includes(tasks.find(t=>t.workOrderId===id)?.id)))
          .map(c=>graph?{...c,priority:graph.nodes.find(n=>n.id===c.id).priority}:c);
        return {...r,...(graph?{goalGraph:graph}:{}),
          status:continuing&&r.status==='READY'?'WAITING':r.status,candidates};
      }};
    dispatcher=createGlobalDispatcher({stateDir:closedLoop.stateDir,adapters:[adapter]});
  }
  async function admission(task){
    if(!closedLoop)return;
    const capability=await verifyOwnerStageDecision(policy,{readTrustedComments:closedLoop.readTrustedComments,now:clock()});
    if(task)authorizeStageTask(policy,capability,policy.tasks.find(t=>t.id===task.id),{completedIds,now:clock()});
  }
  const beget=policy?.schema==='asi.stage-authority.beget.v1';
  must(!beget||typeof fencingWitness==='function','FENCING_REQUIRED');
  const legacy=beget?null:await fs.realpath(legacyStateDir);
  if(!beget)must(legacy!==store.root&&!legacy.startsWith(store.root+path.sep)&&!store.root.startsWith(legacy+path.sep),'LEGACY_NOT_ISOLATED');
  if(!beget&&(legacy===LIVE_ROOT||legacy.startsWith(LIVE_ROOT+'/')))assertLiveAdmission(liveAdmission,store.root,legacy);
  async function witness(){
    if(beget)return fencingWitness();
    try{await fs.lstat(path.join(legacy,'orchestrator-iteration.lock'));throw Error('LEGACY_LOCK_PENDING');}
    catch(e){if(e.code!=='ENOENT')throw e;}
    const state=await readLegacyFiles(legacy);must(inspectLegacy(state).safe,'LEGACY_BLOCKED');const hashes={};
    for(const n of ['receipts.json','heartbeat.json','autopilot-ledger.json','orchestrator-state.json']){
      try{const f=path.join(legacy,n);await regular(f);hashes[n]=digest(await fs.readFile(f));}
      catch(e){if(e.code==='ENOENT')hashes[n]=null;else throw e;}}
    must(hashes['orchestrator-state.json']===null,'LEGACY_OPERATION_PENDING');return hashes;}
  return Object.freeze({async poll({execute=false}={}){
    if(execute!==true)return {mode:'OBSERVE_ONLY',reason:'PUBLICATION_DISABLED',execute:false};
    let chosen,priorWitness,activeSnapshot,activeTask,activeTransaction,publisher,ports;
    let reason='NO_APPROVED_PUBLICATION_TASK';
    const verifyAdmission=async({signal})=>{await admission(activeTask);
      must(JSON.stringify(await ports.fetchSnapshot({signal,transaction:activeTransaction}))===activeSnapshot,'QUEUE_ADMISSION_CHANGED');};
    const result=await store.execute('github-publisher',async({ledger,receipts,transaction})=>{
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
        if(!closedLoop.continuous&&(last?.count??0)>=closedLoop.maxTicks){reason='POLL_BUDGET_EXHAUSTED';return null;}
      }
      await atomicJson(pollFile,{at:now,...(closedLoop?{count:(last?.count??0)+(closedLoop.continuous?0:1),limit:closedLoop.maxTicks,policySha256:stagePolicyHash(policy)}:{})});
      activeTransaction=transaction;
      // Build the reader, mutation transport and snapshot closure once, AFTER
      // the existing durable brake, BEFORE the first admission request. The
      // same ports survive preflight, STARTED and postflight under this lease.
      const supplied=transactionPorts?await bounded(signal=>transactionPorts(Object.freeze({store,transaction,signal})),timeoutMs):{fetchSnapshot,remote,reader};
      inspectStandingTransaction(transaction);
      const captured={};
      for(const name of ['fetchSnapshot','remote','reader']){
        const d=supplied&&Object.getOwnPropertyDescriptor(supplied,name);
        must(d&&Object.hasOwn(d,'value'),'TRANSACTION_PORTS_INVALID');captured[name]=d.value;
      }
      must(typeof captured.fetchSnapshot==='function'&&captured.remote&&captured.reader,'TRANSACTION_PORTS_INVALID');
      if(transactionPorts){
        for(const name of ['observeLifecycle','inspectGate']){
          const observer=Object.getOwnPropertyDescriptor(supplied,name);
          if(observer){must(Object.hasOwn(observer,'value')&&typeof observer.value==='function','PUBLICATION_OBSERVER_INVALID');
            captured[name]=observer.value;}
        }
      }
      if(transactionPorts)for(const [name,methods] of [
        ['remote',['get','createTree','createCommit','createBranch','createDraft']],
        ['reader',['get','pages','verifyTask','threads']],
      ]){
        const port=captured[name];must(Object.isFrozen(port),'TRANSACTION_PORTS_MUTABLE');
        for(const method of methods){const d=Object.getOwnPropertyDescriptor(port,method);
          must(d&&Object.hasOwn(d,'value')&&typeof d.value==='function','TRANSACTION_PORTS_INVALID');}
      }
      ports=Object.freeze(captured);
      publisher=createGitHubPublisher({store,remote:ports.remote,reader:ports.reader,authorize,runChecks,independentReview,verifyAdmission,ciPolicies,publishedReview,clock,timeoutMs,
        transaction,observeLifecycle:ports.observeLifecycle,inspectGate:ports.inspectGate});
      priorWitness=await witness();
      const snapshot=await bounded(signal=>ports.fetchSnapshot({signal,transaction}),timeoutMs),queue=decideQueue(snapshot,{enginePilot,begetTasks:policy?.schema==='asi.stage-authority.beget.v1'});
      activeSnapshot=JSON.stringify(snapshot);
      must(queue.stage===(policy?.stage??'S4-G1')&&queue.decision!=='BLOCKED_NEEDS_RECONCILIATION','RELEASE_STAGE_BLOCKED');
      await bounded(()=>admission(),timeoutMs);
      const completed={},remaining=[];completedIds=[];
      for(const t of tasks){
        must(t.kind==='github-publisher'&&t.stage===(policy?.stage??'S4-G1')&&t.sha===snapshot.mainSha,'TASK_STAGE_OR_SHA_CHANGED');
        const work=[...WORK_ORDERS,...(enginePilot?[ENGINE_PILOT]:[]),...(policy?.schema==='asi.stage-authority.beget.v1'?BEGET_TASKS:[])].find(w=>w.id===t.workOrderId),decision=queue.jobs.find(w=>w.job===t.workOrderId);
        must(work?.kind==='prepare-source'&&work.stage===t.stage&&t.changes?.every(c=>work.paths.includes(c.path)),'WORK_ORDER_SCOPE');
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
        if(closedLoop.continuous&&remaining.length&&(last?.count??0)>=closedLoop.maxTicks){
          reason='WORK_POLL_BUDGET_EXHAUSTED';return null;
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
        if(goalGraph)must(goalGraph.nodes.find(n=>n.id===chosen.workOrderId)?.dependsOn.every(id=>
          completedIds.includes(tasks.find(t=>t.workOrderId===id)?.id)),'PLANNING_DEPENDENCY_NOT_READY');
        must(queue.jobs.find(w=>w.job===chosen.workOrderId)?.status==='SOURCE_PREPARATION_READY','DEPENDENCY_NOT_READY');
        if(closedLoop.continuous){
          if((last?.count??0)>=closedLoop.maxTicks){reason='WORK_POLL_BUDGET_EXHAUSTED';return null;}
          await atomicJson(pollFile,{at:now,count:(last?.count??0)+1,limit:closedLoop.maxTicks,policySha256:stagePolicyHash(policy)});
        }
        await bounded(()=>admission(chosen),timeoutMs);activeTask=chosen;return chosen;
      }
      return null;
    },{async verifyTask(task){must(task===chosen,'TASK_SUBSTITUTED');const m=await bounded(()=>ports.remote.get('branches/main'),timeoutMs);
      must(m.protected===true&&m.commit?.sha===task.sha,'MAIN_CHANGED');return {baseSha:task.sha,taskBinding:bindTask(task)};}},async()=>{
      const value=await publisher.run(chosen,{execute:true});
      must(JSON.stringify(priorWitness)===JSON.stringify(await witness()),'LEGACY_CHANGED');return value;
    });
    if(result.mode==='WAITING'&&result.reason==='NO_NEXT_ISOLATED_JOB')return {...result,reason};
    return result;
  }});
}


/**
 * Native five-lane mode of the SAME Publisher and state.execute transaction.
 * It is constructed ONLY by an independently verified, signed Beget host
 * authority. An unsigned/legacy two-witness catalog is never promoted.
 * This function creates no worker, scheduler, queue, credential or ledger.
 */
/** Pre-AI fail-closed base check. The current owner-signed parent and child
 * explicitly bind ONE protected main commit. On advancement do not consume
 * model credits, create a branch or pretend 365-day coverage follows a new
 * SHA automatically. A future separately reviewed signed base-transition
 * contract is required; an issue comment is not one.
 */
export function inspectFiveLaneProtectedBase({main,catalog,baseSha}={}){
  try{
    const ok=/^[a-f0-9]{40}$/.test(baseSha??'')&&
      main?.protected===true&&main.commit?.sha===baseSha&&
      Array.isArray(catalog)&&catalog.length===5&&
      new Set(catalog.map(t=>t.id)).size===5&&
      catalog.every(t=>t.baseSha===baseSha&&t.repo==='ASI-integration/asi-landing'&&
        t.kind==='source-proposal');
    return Object.freeze({status:ok?'BASE_PINNED':'BLOCKED',
      authorized:false,reason:ok?'SIGNED_EXACT_BASE':'SIGNED_PARENT_BASE_TRANSITION_REQUIRED'});
  }catch{
    return Object.freeze({status:'BLOCKED',authorized:false,
      reason:'SIGNED_PARENT_BASE_TRANSITION_REQUIRED'});
  }
}

export async function createNativeFiveLanePublicationLoop({
  authority,makeTransactionPorts,clock=Date.now,timeoutMs=30000
}={}) {
  must(authority?.payload?.schema==='asi.engine-beget-five-lane-activation.v1' &&
    typeof authority.revalidate==='function'&&
    typeof authority.fencingWitness==='function'&&
    typeof authority.authorizePublisher==='function'&&
    typeof makeTransactionPorts==='function'&&
    authority.catalog?.length===5 &&
    Number.isSafeInteger(timeoutMs)&&timeoutMs>=5000&&timeoutMs<=60000,
    'NATIVE_FIVE_LANE_HOST_AUTHORITY_REQUIRED');
  // This is a WeakMap-backed signed admission minted by the original authority
  // loader. A caller-provided object with identical fields cannot reach live state.
  assertLiveAdmission(authority.admission,authority.payload.root);
  const store=await existingState(authority.payload.root,{liveAdmission:authority.admission});
  const catalog=structuredClone(authority.catalog);
  const catalogHash=digest(JSON.stringify(catalog));
  const expectedHash=authority.catalogDigest;
  must(expectedHash===catalogHash,'NATIVE_SIGNED_CATALOG_CHANGED');
  return Object.freeze({async poll({execute=false}={}){
    if(execute!==true)return {mode:'OBSERVE_ONLY',reason:'PUBLICATION_DISABLED'};
    let chosen=null,ports=null,sourceStatus=null,activeTransaction=null,
      activeLedger=null;
    try{
      await authority.revalidate();
      await authority.fencingWitness();
      const result=await store.execute('github-publisher',async ({ledger,receipts,transaction})=>{
        await authority.revalidate();
        must(await authority.checkRevocationCheckpoint({
          store,ledger,transaction})===true,
          'NATIVE_SIGNED_REVOCATION_CHECKPOINT_REQUIRED');
        must(await authority.verifyChildHistory(ledger)===true,
          'NATIVE_SIGNED_PARENT_HISTORY_REQUIRED');
        must(digest(JSON.stringify(authority.catalog))===expectedHash,
          'NATIVE_SIGNED_CATALOG_CHANGED');
        // No second queue or lock: the old journal remains the source of truth.
        // Source intake, model proposal and Publisher handoff happen during the
        // original native admission phase; no model request without its budget.
        activeTransaction=transaction;activeLedger=ledger;
        ports=await bounded(signal=>makeTransactionPorts(Object.freeze({
          store,ledger,transaction,signal,catalog})),timeoutMs);
        must(Object.isFrozen(ports)&&typeof ports.produce==='function'&&
          typeof ports.revalidate==='function'&&
          ports.remote&&ports.reader&&
          typeof ports.runChecks==='function'&&
          typeof ports.independentReview==='function'&&
          typeof ports.bindTask==='function',
          'SIGNED_NATIVE_TRANSACTION_PORTS_REQUIRED');
        // Must happen before source generation or its irreversible paid
        // reservation, not only in verifyTask after the model has run.
        const main=await bounded(()=>ports.reader.get('branches/main'),timeoutMs);
        must(inspectFiveLaneProtectedBase({main,catalog,
          baseSha:authority.payload.baseSha}).status==='BASE_PINNED',
          'NATIVE_SIGNED_BASE_MOVED_BEFORE_MODEL');
        const old=Object.hasOwn(ledger,'nativeFiveLaneTask')?
          ledger.nativeFiveLaneTask:null;
        if(old!==null){
          must(old&&old.version===1&&
            ['PENDING','DONE'].includes(old.status)&&
            old.catalogDigest===expectedHash&&
            old.task&&isNativeSourceModification(old.task)&&
            digest(JSON.stringify(old.task))===old.taskDigest,
            'NATIVE_PENDING_SOURCE_LEDGER_INVALID');
        }
        if(old?.status==='PENDING'){
          // The previous model call has already consumed its budget. Resume
          // the same bound bytes through the original Publisher INTENT journal,
          // never issue a second model request or silently change the branch.
          chosen=structuredClone(old.task);
        }else{
          const proposal=await bounded(()=>prepareNativeFiveLaneSource({
            store,ledger,transaction,signedCatalog:catalog,nowMs:clock(),
            goalGraph:authority.goalGraph,assessments:authority.assessments,
            history:ledger.intentHistory??[],produce:ports.produce,
            revalidate:ports.revalidate
          }),timeoutMs);
          if(proposal.status!=='SOURCE_PREPARER_CANDIDATE'){
            sourceStatus=proposal.reason;
            return null; // WAITING, never a speculative GitHub write.
          }
          chosen=proposal.task;
        }
        must(await ports.bindTask(chosen)===true,'NATIVE_SIGNED_PORT_TASK_BINDING');
        must(isNativeSourceModification(chosen)&&
          chosen.sha===authority.payload.baseSha&&
          chosen.repo===authority.payload.repo &&
          catalog.some(x=>x.id===chosen.id&&x.laneId===chosen.laneId&&
            x.baseSha===chosen.sha&&
            chosen.changes.every((change,i)=>x.files[i]?.path===change.path&&
              x.files[i].beforeSha256===change.beforeSha256)),
          'NATIVE_SOURCE_PUBLISHER_SCOPE_CHANGED');
        if(old?.status!=='PENDING'){
          // Persist the single exact model result BEFORE the first external
          // publication effect. Same original fsynced ledger, no new queue.
          const record={version:1,status:'PENDING',catalogDigest:expectedHash,
            taskDigest:digest(JSON.stringify(chosen)),task:structuredClone(chosen)};
          await atomicJson(store.file('autopilot-ledger.json'),
            {...ledger,nativeFiveLaneTask:record});
          ledger.nativeFiveLaneTask=record;
        }
        // A signed bounded owner grant is verified in authorizePublisher()
        // again at each protected effect. This does not treat the source
        // candidate's "authorized:false" as a grant.
        return chosen;
      },{async verifyTask(task){
        must(task===chosen,'NATIVE_TASK_SUBSTITUTED');
        await authority.revalidate();
        const main=await bounded(()=>ports.reader.get('branches/main'),timeoutMs);
        must(main.protected===true&&main.commit?.sha===task.sha,
          'NATIVE_MAIN_OR_PROTECTED_BASE_CHANGED');
        return {baseSha:task.sha,taskBinding:bindTask(task)};
      }},async()=>{
        const publisher=createGitHubPublisher({
          store,remote:ports.remote,reader:ports.reader,transaction:activeTransaction,
          authorize:request=>authority.authorizePublisher(request,chosen),
          runChecks:ports.runChecks,independentReview:ports.independentReview,
          verifyAdmission:async()=>{
            await authority.revalidate();await authority.fencingWitness();
            must(digest(JSON.stringify(authority.catalog))===expectedHash,
              'NATIVE_SIGNED_CATALOG_CHANGED');
          },
          ciPolicies:authority.payload.ciPolicies,
          publishedReview:ports.publishedReview,clock,timeoutMs
        });
        const outcome=await publisher.run(chosen,{execute:true});
        if(outcome?.status==='PASS'){
          // Keep the PR receipt as the authoritative result. Only then advance
          // the selected lane; an uncertain PR/CI outcome never moves it.
          const old=activeLedger.nativeFiveLaneTask;
          must(old?.status==='PENDING'&&
            old.taskDigest===digest(JSON.stringify(chosen))&&
            activeLedger.ownerLaneJournal?.lanes?.[chosen.laneId],
            'NATIVE_LANE_COMPLETION_UNVERIFIED');
          const state=activeLedger.ownerLaneJournal.lanes[chosen.laneId];
          must(state.taskId===chosen.id&&state.taskSha===chosen.sha,
            'NATIVE_LANE_JOURNAL_MISMATCH');
          const updated={...activeLedger,
            nativeFiveLaneTask:{...old,status:'DONE',
              pr:outcome.pr,head:outcome.head},
            ownerLaneJournal:{...activeLedger.ownerLaneJournal,
              lanes:{...activeLedger.ownerLaneJournal.lanes,
                [chosen.laneId]:{...state,mode:'DONE',lastServedAtMs:clock()}}}};
          await atomicJson(store.file('autopilot-ledger.json'),updated);
          activeLedger.nativeFiveLaneTask=updated.nativeFiveLaneTask;
          activeLedger.ownerLaneJournal=updated.ownerLaneJournal;
        }
        return outcome;
      });
      return Object.freeze({mode:result.mode,
        reason:sourceStatus??result.reason??null,
        pr:result.pr??null,head:result.head??null});
    }catch{
      return Object.freeze({mode:'BLOCKED',
        reason:'SIGNED_NATIVE_FIVE_LANE_RUNTIME_UNVERIFIED',
        pr:null,head:null});
    }
  }});
}
