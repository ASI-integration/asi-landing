import 'server-only';

import {
  checkConclusion, parseAsIStatusReport, type EngineLiveStatus, type EnginePrStatus,
} from './live-contract';

const PRIVATE_REPO = 'ASI-integration/asi-os-runtime';
const APP_REPO = 'ASI-integration/asi-landing';
const REPORT_ISSUE = 183;
const API = 'https://api.github.com/repos/';
const RECHECK_MS = 20_000;
const STALE_REPORT_MS = 12 * 60_000;
const REQUIRED = ['release_governance', 'source_validation'] as const;

type Issue = { number: number; comments: number };
type IssueComment = {
  id: number; body: string; created_at: string;
  user?: { login?: string };
};
type Pull = { number: number; state: string; draft: boolean; head?: { sha?: string } };
type Check = { name: string; status: string; conclusion: string | null };

let cached: { at: number; value: EngineLiveStatus } | null = null;

function empty(reason: string): EngineLiveStatus {
  return {
    available: false, reason, fetchedAt: new Date().toISOString(), lastReportAt: null,
    reportUrl: null, stale: true, workers: [], modelReservations: null,
    modelLimit: null, githubReservations: null, githubLimit: null,
    prs: [], source: 'private-github-report',
  };
}

async function github<T>(path: string, token: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(API + path, {
      method: 'GET', cache: 'no-store', signal: controller.signal,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: 'Bearer ' + token,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!response.ok) throw new Error('GitHub read unavailable');
    return await response.json() as T;
  } finally {
    clearTimeout(timer);
  }
}

async function prStatus(
  input: { taskId: string; number: number; url: string },
  token: string,
): Promise<EnginePrStatus> {
  const fallback: EnginePrStatus = {
    ...input, head: null, isDraft: null, ci: 'unknown',
    releaseGovernance: 'unknown', sourceValidation: 'unknown',
  };
  try {
    const pr = await github<Pull>(APP_REPO + '/pulls/' + input.number, token);
    if (pr.number !== input.number || pr.state !== 'open' ||
        typeof pr.head?.sha !== 'string' || !/^[0-9a-f]{40}$/.test(pr.head.sha)) return fallback;

    const sha = pr.head.sha;
    const checks = await github<{ check_runs: Check[] }>(
      APP_REPO + '/commits/' + sha + '/check-runs?per_page=100', token,
    );
    if (!Array.isArray(checks.check_runs)) return fallback;
    const statuses = new Map<string, EnginePrStatus['ci']>();
    for (const check of checks.check_runs) {
      if (!check || typeof check.name !== 'string') continue;
      statuses.set(check.name, checkConclusion(check.conclusion, check.status));
    }
    const releaseGovernance = statuses.get(REQUIRED[0]) ?? 'unknown';
    const sourceValidation = statuses.get(REQUIRED[1]) ?? 'unknown';
    const values = Array.from(statuses.values());
    const ci = releaseGovernance === 'failed' || sourceValidation === 'failed' ||
        values.includes('failed') ? 'failed'
      : releaseGovernance === 'passed' && sourceValidation === 'passed' &&
        values.length > 0 && values.every(v => v === 'passed') ? 'passed'
      : values.includes('pending') ? 'pending' : 'unknown';
    return {
      ...input, head: sha, isDraft: pr.draft,
      ci, releaseGovernance, sourceValidation,
    };
  } catch {
    return fallback;
  }
}

/** Near-live, owner-only, read-only poll of the Engine's private GitHub issue.
 * Source reports are emitted at task transitions and periodically while idle.
 * A missing report, token, or failed network call NEVER yields green. */
export async function getAsiEngineLiveStatus(): Promise<EngineLiveStatus> {
  if (cached && Date.now() - cached.at < RECHECK_MS) return cached.value;
  const token = (process.env.ASI_ENGINE_GITHUB_READ_TOKEN ||
                 process.env.GITHUB_TOKEN || '').trim();
  if (!token) return empty('GitHub read-only token is not configured on the website server.');

  try {
    const issue = await github<Issue>(PRIVATE_REPO + '/issues/' + REPORT_ISSUE, token);
    if (issue.number !== REPORT_ISSUE || !Number.isInteger(issue.comments) || issue.comments < 1) {
      return empty('No verified Engine reports yet.');
    }
    const page = Math.max(1, Math.ceil(issue.comments / 100));
    const comments = await github<IssueComment[]>(
      PRIVATE_REPO + '/issues/' + REPORT_ISSUE + '/comments?per_page=100&page=' + page,
      token,
    );
    if (!Array.isArray(comments)) throw new Error('Invalid report response');

    const candidates = [...comments].sort((a, b) => b.id - a.id);
    const latest = candidates.map(item => ({
      item, parsed: item.user?.login === 'ASI-integration'
        ? parseAsIStatusReport(item.body) : null,
    })).find(x => x.parsed !== null);
    if (!latest?.parsed) return empty('No recognized five-worker status report in the latest page.');

    const reportTime = Date.parse(latest.item.created_at);
    if (!Number.isFinite(reportTime)) return empty('Engine report has no trustworthy timestamp.');
    const stale = Date.now() - reportTime > STALE_REPORT_MS || Date.now() - reportTime < -60_000;
    const prs = await Promise.all(latest.parsed.prLinks.slice(0, 10).map(p => prStatus(p, token)));
    const result: EngineLiveStatus = {
      available: true,
      reason: stale ? 'The last Engine report is old. Current worker liveness is unverified.' : null,
      fetchedAt: new Date().toISOString(),
      lastReportAt: latest.item.created_at,
      reportUrl: 'https://github.com/' + PRIVATE_REPO + '/issues/' +
        REPORT_ISSUE + '#issuecomment-' + latest.item.id,
      stale, workers: latest.parsed.workers,
      modelReservations: latest.parsed.modelReservations,
      modelLimit: latest.parsed.modelLimit,
      githubReservations: latest.parsed.githubReservations,
      githubLimit: latest.parsed.githubLimit,
      prs, source: 'private-github-report',
    };
    cached = { at: Date.now(), value: result };
    return result;
  } catch {
    // Fail closed, never fall back to historic 'RUNNING' with today's timestamp.
    return empty('Cannot read the private ASI Engine report or verify GitHub access.');
  }
}
