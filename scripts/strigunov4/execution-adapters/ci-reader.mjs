import { must } from './state.mjs';

/** Structured workflow execution records (runs/jobs/steps), NOT regex over raw logs.
 * policies is host-owned: [{name:'validate',workflowId:123}, ...]. Never derive it from PR text.
 */
export async function inspectCI(github, task, policies) {
  must(Number.isSafeInteger(task.pr) && task.pr > 0, 'CI_REQUIRES_PR');
  must(Array.isArray(policies) && policies.length > 0 && policies.length <= 20 &&
    new Set(policies.map(p => p.name)).size === policies.length &&
    policies.every(p => /^[a-zA-Z0-9_-]+$/.test(p.name) && Number.isSafeInteger(p.workflowId) && p.workflowId > 0), 'CI_POLICY_REQUIRED');
  const runs = await github.pages(`actions/runs?head_sha=${task.sha}&event=pull_request`, 'workflow_runs');
  must(runs.every(r => r.head_sha === task.sha && r.event === 'pull_request'), 'RUN_SHA_MISMATCH');
  const evidence = []; let waiting = false, failed = false;
  for (const policy of policies) {
    // GitHub may return an empty pull_requests array for a verified PR run.
    // Require trusted workflow, branch and origin even without that association.
    const candidates = runs.filter(r => r.workflow_id === policy.workflowId &&
      r.head_branch === task.branch && r.repository?.full_name === task.repo &&
      r.head_repository?.full_name === task.repo &&
      (r.pull_requests == null || Array.isArray(r.pull_requests) &&
        (r.pull_requests.length === 0 || r.pull_requests.some(p => p.number === task.pr))));
    const run = candidates.sort((a,b) => b.id - a.id)[0];
    if (!run) { waiting = true; evidence.push({ name: policy.name, state: 'missing' }); continue; }
    must(Number.isSafeInteger(run.run_attempt) && run.run_attempt > 0, 'ATTEMPT_REQUIRED');
    if (run.status !== 'completed') { waiting = true; evidence.push({ name: policy.name, state: 'pending', run: run.id }); continue; }
    const jobs = await github.pages(`actions/runs/${run.id}/attempts/${run.run_attempt}/jobs`, 'jobs');
    must(jobs.every(j => j.run_id === run.id && j.head_sha === task.sha), 'JOB_SHA_MISMATCH');
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
    must(current.head_sha === task.sha && current.run_attempt === run.run_attempt &&
      current.status === run.status && current.conclusion === run.conclusion, 'RUN_CHANGED_DURING_READ');
  }
  // Re-read list to detect a newer run while its predecessor was being examined.
  const again = await github.pages(`actions/runs?head_sha=${task.sha}&event=pull_request`, 'workflow_runs');
   const signature = list => JSON.stringify(list.map(r => [r.id,r.workflow_id,r.head_sha,
     r.head_branch,r.repository?.full_name,r.head_repository?.full_name,
     r.pull_requests?.map(p=>p.number),r.run_attempt,r.status,r.conclusion]).sort((a,b)=>a[0]-b[0]));
  must(signature(runs) === signature(again), 'CI_CHANGED_DURING_READ');
  return { status: failed ? 'FAILED' : waiting ? 'WAITING' : 'PASS', head: task.sha,
    checks: Object.fromEntries(evidence.map(e => [e.name,e.state])), evidence };
}
export function readCI({ store, github, task, policies }) {
  return store.execute('ci-reader', task, github, () => inspectCI(github,task,policies));
}
