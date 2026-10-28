import { must } from './state.mjs';

/** Structured workflow execution records (runs/jobs/steps), NOT regex over raw logs.
 * policies is host-owned: [{name:'validate',workflowId:123}, ...]. Never derive it from PR text.
 */
export function validateCiPolicy(task, policies) {
  must(Array.isArray(policies) && policies.length > 0 && policies.length <= 20 &&
    new Set(policies.map(p => p.name)).size === policies.length &&
    policies.every(p => /^[a-zA-Z0-9_-]+$/.test(p.name) && Number.isSafeInteger(p.workflowId) && p.workflowId > 0), 'CI_POLICY_REQUIRED');
  // Explicit opt-in for ASI's separately protected governance workflow only.
  // Never reinterpret a base-SHA pull_request_target result as a head-SHA result.
  const eventFor=p=>p.event??'pull_request';
  must(policies.every(p=>eventFor(p)==='pull_request'||eventFor(p)==='pull_request_target'&&
    p.name==='release_governance'&&p.workflowId===390653294&&task.repo==='ASI-integration/asi-landing'&&
    /^[a-f0-9]{40}$/.test(task.baseSha??'')),'CI_EVENT_NOT_ADMITTED');
  return eventFor;
}
export async function inspectCI(github, task, policies) {
  must(Number.isSafeInteger(task.pr) && task.pr > 0, 'CI_REQUIRES_PR');
  const eventFor=validateCiPolicy(task,policies);
  const events=[...new Set(policies.map(eventFor))];
  // A target workflow may be exposed in base or PR-head context. For an empty
  // pull_requests list, require a separate fresh pinned PR identity readback.
  const verifyTargetPr=async()=>{
    const p=await github.get(`pulls/${task.pr}`);
    must(p?.number===task.pr&&p.state==='open'&&p.merged===false&&
      p.head?.sha===task.sha&&p.head.ref===task.branch&&p.head.repo?.full_name===task.repo&&
      p.base?.sha===task.baseSha&&p.base.ref==='main'&&p.base.repo?.full_name===task.repo,
      'TARGET_PR_IDENTITY_CHANGED');
  };
  if(events.includes('pull_request_target'))await verifyTargetPr();
  const readRuns=async()=>{
    const out=[];
    for(const event of events){
      const shas=event==='pull_request_target'?[...new Set([task.baseSha,task.sha])]:[task.sha];
      for(const expectedSha of shas){
        const list=await github.pages(`actions/runs?head_sha=${expectedSha}&event=${event}`,'workflow_runs');
        must(list.every(r=>r.head_sha===expectedSha&&r.event===event),'RUN_SHA_MISMATCH');out.push(...list);
      }
    }
    must(new Set(out.map(r=>r.id)).size===out.length,'CROSS_EVENT_RUN_DUPLICATE');return out;
  };
  const runs = await readRuns();
  const targetAssociation=r=>{
    const onHead=r.head_sha===task.sha&&r.head_branch===task.branch;
    const onBase=r.head_sha===task.baseSha&&r.head_branch==='main';
    const link=Array.isArray(r.pull_requests)&&r.pull_requests.length===1&&
      r.pull_requests[0].number===task.pr&&r.pull_requests[0].head?.sha===task.sha&&
      r.pull_requests[0].head.ref===task.branch&&r.pull_requests[0].base?.sha===task.baseSha&&
      r.pull_requests[0].base.ref==='main';
    return onBase?link:onHead&&(link||Array.isArray(r.pull_requests)&&r.pull_requests.length===0);
  };
  const evidence = []; let waiting = false, failed = false;
  for (const policy of policies) {
    // GitHub may return an empty pull_requests array for a verified PR run.
    // Require trusted workflow, branch and origin even without that association.
    const candidates = runs.filter(r => r.workflow_id === policy.workflowId && r.event===eventFor(policy) &&
      r.repository?.full_name===task.repo&&r.head_repository?.full_name===task.repo&&
      (eventFor(policy)==='pull_request_target'?targetAssociation(r):
        r.head_branch===task.branch&&
        (r.pull_requests==null||Array.isArray(r.pull_requests)&&
          (r.pull_requests.length===0||r.pull_requests.some(p=>p.number===task.pr&&
            (p.head===undefined||p.head.sha===task.sha&&p.head.ref===task.branch))))));
    const run = candidates.sort((a,b) => b.id - a.id)[0];
    if (!run) { waiting = true; evidence.push({ name: policy.name, state: 'missing' }); continue; }
    must(Number.isSafeInteger(run.run_attempt) && run.run_attempt > 0, 'ATTEMPT_REQUIRED');
    if (run.status !== 'completed') { waiting = true; evidence.push({ name: policy.name, state: 'pending', run: run.id }); continue; }
    const jobs = await github.pages(`actions/runs/${run.id}/attempts/${run.run_attempt}/jobs`, 'jobs');
    const expectedSha=run.head_sha;
    must(jobs.every(j => j.run_id === run.id && j.head_sha === expectedSha), 'JOB_SHA_MISMATCH');
    const named = jobs.filter(j => j.name === policy.name);
    must(named.length === 1, 'JOB_MISSING_OR_AMBIGUOUS');
    const job = named[0];
    must(Array.isArray(job.steps) && job.steps.length > 0, 'STEP_RECORDS_MISSING');
    const success = run.conclusion === 'success' && job.status === 'completed' && job.conclusion === 'success' &&
      job.steps.every(s => s.status === 'completed' && ['success','skipped'].includes(s.conclusion));
    if (!success) failed = true;
    // Do not copy workflow-controlled names, raw logs, annotations or secret-bearing output.
    evidence.push({ name: policy.name, state: success ? 'success' : 'failure', run: run.id,
      attempt: run.run_attempt, job: job.id, steps: job.steps.map(s => ({ number:s.number, conclusion:s.conclusion })) });
    const current = await github.get(`actions/runs/${run.id}`);
    must(current.head_sha === expectedSha && current.run_attempt === run.run_attempt &&
      current.status === run.status && current.conclusion === run.conclusion, 'RUN_CHANGED_DURING_READ');
  }
  // Re-read list to detect a newer run while its predecessor was being examined.
  const again = await readRuns();
   const signature = list => JSON.stringify(list.map(r => [r.id,r.workflow_id,r.head_sha,
     r.head_branch,r.event,r.repository?.full_name,r.head_repository?.full_name,
     Array.isArray(r.pull_requests)?r.pull_requests.map(p=>[p.number,p.head?.sha,p.head?.ref,p.base?.sha,p.base?.ref]):null,
     r.run_attempt,r.status,r.conclusion]).sort((a,b)=>a[0]-b[0]));
  must(signature(runs) === signature(again), 'CI_CHANGED_DURING_READ');
  if(events.includes('pull_request_target'))await verifyTargetPr();
  return { status: failed ? 'FAILED' : waiting ? 'WAITING' : 'PASS', head: task.sha,
    checks: Object.fromEntries(evidence.map(e => [e.name,e.state])), evidence };
}
export function readCI({ store, github, task, policies }) {
  return store.execute('ci-reader', task, github, () => inspectCI(github,task,policies));
}
