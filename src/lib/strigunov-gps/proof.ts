/** Strict proof for the only physical acceptance workflow currently permitted in the canonical release. */
const REPO = 'ASI-integration/asi-landing';
const WORKFLOW = '.github/workflows/strigunov4-c4-unit-apply.yml';
const JOB = 'protected_c4_unit_apply';
const OWNER_ID = 207600140;

type Stage = {id: string; status: string; acceptanceSha?: string; proof: unknown[]};
type Run = {
  repository?: {full_name?: string}; status?: string; conclusion?: string;
  head_sha?: string; head_branch?: string; path?: string; event?: string; run_attempt?: number;
};
type Approval = {
  user?: {id?: number}; state?: string;
  environments?: Array<{name?: string; can_admins_bypass?: boolean}>;
};
type Jobs = {
  total_count?: number;
  jobs?: Array<{name?: string; status?: string; conclusion?: string}>;
};

/** GitHub CI status alone is never physical proof. This validates the separate protected run. */
export function verifiedG1Run(stage: Stage, proofUrl: string, run: Run, approvals: Approval[], jobs: Jobs): boolean {
  return stage.id === 'S4-G1'
    && stage.status === 'ACCEPTED'
    && typeof stage.acceptanceSha === 'string'
    && /^[0-9a-f]{40}$/.test(stage.acceptanceSha)
    && Array.isArray(stage.proof)
    && stage.proof.includes(proofUrl)
    && /^https:\/\/github\.com\/ASI-integration\/asi-landing\/actions\/runs\/[1-9][0-9]*$/.test(proofUrl)
    && run.repository?.full_name === REPO
    && run.status === 'completed'
    && run.conclusion === 'success'
    && run.head_sha === stage.acceptanceSha
    && run.head_branch === 'main'
    && run.path === WORKFLOW
    && run.event === 'workflow_dispatch'
    && run.run_attempt === 1
    && Array.isArray(approvals)
    && approvals.some(a =>
      a.user?.id === OWNER_ID && a.state === 'approved' &&
      a.environments?.some(env => env.name === 'staging' && env.can_admins_bypass === false))
    && Array.isArray(jobs.jobs)
    && Number.isSafeInteger(jobs.total_count)
    && jobs.total_count === jobs.jobs.length
    && jobs.total_count <= 100
    && jobs.jobs.some(j => j.name === JOB && j.status === 'completed' && j.conclusion === 'success');
}
