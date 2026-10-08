#!/usr/bin/env node
// Read-only Booking Ops scheduler diagnostics: no workflow dispatch or approvals.
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORKFLOW = 'booking-ops-auto-send.yml';
const DEFAULT_REPO = 'ASI-integration/asi-landing';

export function classifySchedulerRuns({
  runs = [], pendingByRun = {}, mainSha = '', productionSha = '',
  productionHealthy = null, now = Date.now(),
} = {}) {
  const scheduled = (Array.isArray(runs) ? runs : [])
    .filter((run) => run?.event === 'schedule')
    .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
  const latest = scheduled[0] ?? null;
  const pending = latest ? pendingByRun[String(latest.databaseId)] : undefined;
  const approvalRequired = Array.isArray(pending) && pending.some(
    (entry) => Boolean(entry?.environment?.name),
  );
  let state = 'no_scheduled_runs';
  if (latest) {
    if (latest.status === 'waiting') {
      state = approvalRequired ? 'awaiting_environment_approval' : 'waiting_unverified';
    } else if (latest.status === 'queued' || latest.status === 'pending') {
      state = 'queued';
    } else if (latest.status === 'in_progress') {
      state = 'running';
    } else if (latest.status === 'completed') {
      state = latest.conclusion === 'success' ? 'workflow_success_delivery_unverified'
        : latest.conclusion === 'cancelled' ? 'cancelled' : 'workflow_failed_or_incomplete';
    } else {
      state = 'unknown';
    }
  }
  const parsedTime = Date.parse(latest?.createdAt || '');
  const ageMinutes = Number.isFinite(parsedTime)
    ? Math.max(0, Math.floor((now - parsedTime) / 60000)) : null;
  const versionMismatch = Boolean(mainSha && productionSha && mainSha !== productionSha);
  return {
    readOnly: true,
    workflow: WORKFLOW,
    state,
    scheduledRunsChecked: scheduled.length,
    waitingRuns: scheduled.filter((run) => run.status === 'waiting').length,
    cancelledRuns: scheduled.filter((run) => run.conclusion === 'cancelled').length,
    latest: latest ? {
      id: latest.databaseId,
      status: latest.status,
      conclusion: latest.conclusion || null,
      sha: latest.headSha || null,
      url: latest.url || null,
      ageMinutes,
      protectedEnvironmentApproval: approvalRequired,
    } : null,
    mainSha: mainSha || null,
    productionSha: productionSha || null,
    productionHealthy,
    versionMismatch,
    deliveryConfirmed: false,
    action: state === 'awaiting_environment_approval'
      ? 'Review scheduler environment design; do not auto-approve Production'
      : state === 'workflow_success_delivery_unverified'
        ? 'Inspect protected runner counters before claiming messages were sent'
        : 'Inspect latest GitHub workflow before changing scheduler settings',
  };
}

function ghJson(args) {
  const processResult = spawnSync('gh', args, {
    encoding: 'utf8', timeout: 20000, windowsHide: true, maxBuffer: 1024 * 1024,
  });
  if (processResult.error || processResult.status !== 0) {
    throw new Error('GitHub read-only query failed; check gh authentication/connectivity');
  }
  return JSON.parse(processResult.stdout);
}

async function publicJson(url) {
  const result = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!result.ok) throw new Error(`public API HTTP ${result.status}`);
  return result.json();
}

export async function inspectScheduler({
  repo = DEFAULT_REPO, gh = ghJson, getPublic = publicJson, now = Date.now(),
} = {}) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw new Error('Invalid repo selector');
  const runs = gh([
    'run', 'list', '--repo', repo, '--workflow', WORKFLOW, '--limit', '15',
    '--json', 'databaseId,event,status,conclusion,headSha,createdAt,url',
  ]);
  const waiting = runs.filter((r) => r.event === 'schedule' && r.status === 'waiting')
    .slice(0, 3);
  const pendingByRun = {};
  for (const run of waiting) {
    try {
      pendingByRun[String(run.databaseId)] = gh([
        'api', `repos/${repo}/actions/runs/${run.databaseId}/pending_deployments`,
      ]);
    } catch {
      // A missing approval response is unknown, never evidence of no approval gate.
      pendingByRun[String(run.databaseId)] = null;
    }
  }
  let mainSha = '';
  let productionSha = '';
  let productionHealthy = null;
  try {
    mainSha = String(gh(['api', `repos/${repo}/commits/main`])?.sha ?? '');
  } catch { /* Main revision remains unknown. */ }
  try {
    const [health, version] = await Promise.all([
      getPublic('https://asi-global.ru/api/health'),
      getPublic('https://asi-global.ru/api/version'),
    ]);
    productionHealthy = health?.ok === true;
    productionSha = String(version?.sha ?? '');
  } catch { /* Production state remains unknown, never implied healthy. */ }
  return classifySchedulerRuns({
    runs, pendingByRun, mainSha, productionSha, productionHealthy, now,
  });
}

const direct = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (direct) {
  inspectScheduler()
    .then((result) => process.stdout.write(JSON.stringify(result, null, 2) + '\n'))
    .catch((error) => {
      process.stderr.write(JSON.stringify({
        readOnly: true, state: 'diagnostic_unavailable', error: error.message,
      }) + '\n');
      process.exitCode = 2;
    });
}
