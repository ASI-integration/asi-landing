import 'server-only';

import { getMissionControlDashboard } from '@/lib/mission-control/store';
import { ENGINE_MILESTONES, ENGINE_STEPS, ENGINE_ROADMAP_SNAPSHOT, type EngineProgressStatus } from './roadmap';

const OWNER_REPO = 'ASI-integration/asi-os-runtime';
const PR_NUMBER = 165;
const GITHUB = 'https://api.github.com';
const CI_NAMES = [
  'Runtime security and staging bridge (ubuntu-latest)',
  'Runtime security and staging bridge (windows-latest)',
  'Windows artifact and mock-control acceptance',
] as const;
type JobState = 'success' | 'failed' | 'pending' | 'missing';
export type EngineCi = {
  available: boolean;
  reason: string | null;
  sha: string | null;
  prUrl: string;
  runUrl: string | null;
  runId: number | null;
  checkedAt: string;
  jobs: Record<'ubuntu' | 'windows' | 'artifact', JobState>;
};
type GitHubJob = { name?: unknown; status?: unknown; conclusion?: unknown };
type GitHubRun = {
  id?: unknown; name?: unknown; event?: unknown;
  head_sha?: unknown; status?: unknown; conclusion?: unknown;
};
const blankJobs = (): EngineCi['jobs'] => ({ ubuntu: 'missing', windows: 'missing', artifact: 'missing' });
const validSha = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f]{40}$/.test(s);
function stateForJob(job: GitHubJob | undefined): JobState {
  if (!job) return 'missing';
  if (job.status !== 'completed') return 'pending';
  return job.conclusion === 'success' ? 'success' : 'failed';
}

async function githubGet<T>(path: string, token: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(GITHUB + path, {
      method: 'GET',
      headers: {
        'accept': 'application/vnd.github+json',
        'authorization': `Bearer ${token}`,
        'x-github-api-version': '2022-11-28',
      },
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!response.ok) throw new Error('GitHub source unavailable');
    return await response.json() as T;
  } finally {
    clearTimeout(timeout);
  }
}

let cached: { at: number; value: EngineCi } | null = null;
/** Server-only bounded polling. Never mark a step PASS from an old CI SHA. */
export async function getEngineCi(): Promise<EngineCi> {
  if (cached && Date.now() - cached.at < 15000) return cached.value;
  const checkedAt = new Date().toISOString();
  const fallback: EngineCi = {
    available: false, reason: 'Источник GitHub пока недоступен.',
    sha: null, prUrl: `https://github.com/${OWNER_REPO}/pull/${PR_NUMBER}`,
    runUrl: null, runId: null, checkedAt, jobs: blankJobs(),
  };
  const token = process.env.GITHUB_TOKEN?.trim();
  if (!token) return { ...fallback, reason: 'Не подключён серверный GITHUB_TOKEN для GitHub CI.' };
  try {
    const pr = await githubGet<{ state?: string; head?: { sha?: unknown; repo?: { full_name?: unknown } } }>(
      `/repos/${OWNER_REPO}/pulls/${PR_NUMBER}`, token);
    if (pr.state !== 'open' || pr.head?.repo?.full_name !== OWNER_REPO || !validSha(pr.head?.sha))
      throw new Error('Unexpected PR head or repository');
    const sha = pr.head.sha;
    const response = await githubGet<{ workflow_runs?: GitHubRun[] }>(
      `/repos/${OWNER_REPO}/actions/runs?head_sha=${sha}&event=pull_request&per_page=20`, token);
    const runs = Array.isArray(response.workflow_runs) ? response.workflow_runs : [];
    const run = runs.find((r) => r.head_sha === sha && r.name === 'CI' && r.event === 'pull_request' && typeof r.id === 'number');
    if (!run) {
      const result: EngineCi = { ...fallback, available: true,
        reason: 'На текущем SHA ещё нет подтверждённого запуска CI.', sha };
      cached = { at: Date.now(), value: result };
      return result;
    }
    const runId = run.id as number;
    const jobResponse = await githubGet<{ jobs?: GitHubJob[] }>(
      `/repos/${OWNER_REPO}/actions/runs/${runId}/jobs?per_page=100`, token);
    const found = Array.isArray(jobResponse.jobs) ? jobResponse.jobs : [];
    const jobs = Object.fromEntries(CI_NAMES.map((name, index) => [
      (['ubuntu','windows','artifact'] as const)[index],
      stateForJob(found.find((job) => job.name === name)),
    ])) as EngineCi['jobs'];
    const result: EngineCi = {
      available: true, reason: null, sha,
      prUrl: fallback.prUrl,
      runUrl: `https://github.com/${OWNER_REPO}/actions/runs/${runId}`,
      runId, checkedAt, jobs,
    };
    cached = { at: Date.now(), value: result };
    return result;
  } catch {
    // Never turn a GitHub network/auth/config failure into PASS.
    return fallback;
  }
}
function mapJob(state: JobState): EngineProgressStatus {
  return state === 'success' ? 'done' : state === 'failed' ? 'blocked'
    : state === 'pending' ? 'in_progress' : 'unknown';
}
export function liveOverrides(ci: EngineCi): Record<string, EngineProgressStatus> {
  const j = ci.jobs;
  const all = Object.values(j);
  const combined: EngineProgressStatus = !ci.available || !ci.runId || all.includes('missing')
    ? 'unknown'
    : all.every(x => x === 'success') ? 'done'
    : all.includes('failed') ? 'blocked'
    : 'in_progress';
  return {
    '2.1': ci.available && ci.runId ? mapJob(j.ubuntu) : 'unknown',
    '2.2': ci.available && ci.runId ? mapJob(j.windows) : 'unknown',
    '2.3': ci.available && ci.runId ? mapJob(j.artifact) : 'unknown',
    '2.4': combined,
  };
}

export async function getEngineProgressSnapshot() {
  const [ci, statuses] = await Promise.all([getEngineCi(), getMissionControlDashboard()]);
  const overrides = liveOverrides(ci);
  const steps = ENGINE_STEPS.map((step) => ({
    ...step,
    status: overrides[step.id] ?? step.initialStatus,
    source: Object.prototype.hasOwnProperty.call(overrides,step.id) ? 'github' : 'snapshot',
    evidenceUrl: Object.prototype.hasOwnProperty.call(overrides,step.id) ? ci.runUrl : null,
  }));
  const milestones = ENGINE_MILESTONES.map(milestone => {
    const own = steps.filter(x => x.milestoneId === milestone.id);
    const completed = own.filter(x => x.status === 'done').length;
    const status: EngineProgressStatus = own.every(x => x.status === 'done')
      ? 'done' : own.some(x => x.status === 'blocked') ? 'blocked'
      : own.some(x => x.status === 'in_progress') ? 'in_progress'
      : own.some(x => x.status === 'unknown') ? 'unknown' : 'not_started';
    return { ...milestone, completed, total: own.length, status };
  });
  return {
    schemaVersion: 'asi.owner.engine-progress.v1',
    snapshotDate: ENGINE_ROADMAP_SNAPSHOT,
    fetchedAt: new Date().toISOString(),
    milestones, steps, ci,
    activity: statuses.find(x => x.projectId === 'asi') ?? null,
  };
}
